"""Atomic daily budget for optional external AI inference in private beta.

Uses a separate table from the minute-level gateway admission counters.
Rows store only HMACs, never JWTs, emails, player tags, or prompts.
"""
from __future__ import annotations

from datetime import datetime, timezone
from dataclasses import dataclass
import hashlib
import hmac
from typing import Any

SQL_RESERVE_AI = """
INSERT INTO ai_daily_quota_windows (scope, subject_key, day_number, used)
VALUES ($1, $2, $3, 1)
ON CONFLICT (scope, subject_key, day_number)
DO UPDATE SET used = ai_daily_quota_windows.used + 1
WHERE ai_daily_quota_windows.used < $4
RETURNING used
"""


@dataclass(frozen=True)
class AIDailyBudgetExceeded(Exception):
    retry_after_seconds: int


class SharedAIDailyBudget:
    """Conservative cap: at most 18 chat requests globally per UTC day.

    Each request may use at most two free-model providers, so this limits
    external API calls to at most 36/day under this beta gateway's control.
    """

    def __init__(self, hmac_secret: bytes, *, per_member: int = 6, global_budget: int = 18):
        if len(hmac_secret) < 32:
            raise ValueError("AI budget HMAC secret too short")
        if not (1 <= per_member <= global_budget <= 20):
            raise ValueError("AI daily budget bounds invalid")
        self._secret = hmac_secret
        self.per_member = per_member
        self.global_budget = global_budget

    def _digest(self, value: str) -> str:
        return hmac.new(self._secret, value.encode("utf-8"), hashlib.sha256).hexdigest()

    async def reserve(self, connection: Any, subject: str, *, now: datetime | None = None) -> None:
        if not isinstance(subject, str) or not (1 <= len(subject) <= 256):
            raise ValueError("Verified subject required")
        at = now or datetime.now(timezone.utc)
        if at.tzinfo is None:
            raise ValueError("Timezone-aware UTC required")
        now_seconds = int(at.timestamp())
        day = now_seconds // 86400
        retry = 86400 - (now_seconds % 86400)
        async with connection.transaction():
            member = await connection.fetchrow(
                SQL_RESERVE_AI, "member", self._digest("ai-member:" + subject),
                day, self.per_member,
            )
            if member is None:
                raise AIDailyBudgetExceeded(retry)
            global_ = await connection.fetchrow(
                SQL_RESERVE_AI, "global", self._digest("ai-global"),
                day, self.global_budget,
            )
            if global_ is None:
                raise AIDailyBudgetExceeded(retry)
