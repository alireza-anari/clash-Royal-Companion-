"""Shared fixed-window admission budget for a FUTURE private beta.

Caller MUST supply a verified Cloudflare Access subject ID. Used only by the
private beta gateway, not local API. Does not create a database or public ports.
"""
from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
from typing import Any


SQL_RESERVE = """
INSERT INTO gateway_quota_windows(scope, subject_key, bucket_start, used)
VALUES ($1, $2, $3, 1)
ON CONFLICT(scope, subject_key, bucket_start)
DO UPDATE SET used = gateway_quota_windows.used + 1
WHERE gateway_quota_windows.used < $4
RETURNING used
"""


@dataclass(frozen=True)
class QuotaDenied(Exception):
    code: str = "SHARED_QUOTA_EXCEEDED"
    retry_after_seconds: int = 60


class PostgresSharedQuota:
    """Fixed UTC 60-second buckets, atomically shared by all API processes.

    The user/global reservations are in ONE database transaction. A denied
    global quota rolls back the user's provisional reservation. No personal
    identifying values are stored: a keyed SHA256 digest identifies the member.

    This is a fixed window, not a sliding window. An attacker may use capacity
    near both sides of a minute boundary. Conservative quota values are needed.
    """

    def __init__(
        self,
        hmac_secret: bytes,
        *,
        per_member: int = 12,
        global_budget: int = 90,
    ):
        if len(hmac_secret) < 32:
            raise ValueError("Quota HMAC secret must be at least 32 bytes.")
        if not (1 <= per_member <= 10000 and 1 <= global_budget <= 10000):
            raise ValueError("Invalid quota limits.")
        self._secret = hmac_secret
        self.per_member = per_member
        self.global_budget = global_budget

    def _digest(self, subject: str) -> str:
        if not isinstance(subject, str) or not subject or len(subject) > 256:
            raise ValueError("Validated subject must be nonempty and bounded.")
        return hmac.new(self._secret, subject.encode("utf-8"), hashlib.sha256).hexdigest()

    async def reserve(
        self,
        connection: Any,
        verified_subject: str,
        *,
        now: datetime | None = None,
    ) -> dict[str, int]:
        moment = now or datetime.now(timezone.utc)
        if moment.tzinfo is None:
            raise ValueError("Use an aware UTC timestamp.")
        timestamp = int(moment.timestamp())
        bucket = timestamp // 60
        retry = 60 - timestamp % 60
        member_key = self._digest("member:" + verified_subject)
        global_key = self._digest("global")
        async with connection.transaction():
            # Both reservations commit or both roll back. Caller must not catch
            # QuotaDenied inside this transaction's context.
            member = await connection.fetchrow(
                SQL_RESERVE, "member", member_key, bucket, self.per_member
            )
            if member is None:
                raise QuotaDenied("MEMBER_QUOTA_EXCEEDED", retry)
            global_count = await connection.fetchrow(
                SQL_RESERVE, "global", global_key, bucket, self.global_budget
            )
            if global_count is None:
                raise QuotaDenied("GLOBAL_QUOTA_EXCEEDED", retry)
        return {"member_count": int(member["used"]), "global_count": int(global_count["used"])}
