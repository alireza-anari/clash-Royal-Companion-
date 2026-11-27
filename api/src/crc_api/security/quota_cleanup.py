"""Privacy-aware, bounded cleanup for draft private-beta quota counters.

This is intentionally NOT scheduled or run by a production service yet.
An owner-approved maintenance job can call it after DB/retention review.
"""
from __future__ import annotations

from datetime import datetime, timezone
from typing import Any


PRUNE_SQL = """
WITH candidates AS (
    SELECT scope, subject_key, bucket_start
    FROM gateway_quota_windows
    WHERE bucket_start < $1
    ORDER BY bucket_start, scope, subject_key
    LIMIT $2
    FOR UPDATE SKIP LOCKED
), removed AS (
    DELETE FROM gateway_quota_windows AS q
    USING candidates AS c
    WHERE q.scope = c.scope
      AND q.subject_key = c.subject_key
      AND q.bucket_start = c.bucket_start
    RETURNING 1
)
SELECT COUNT(*) FROM removed
"""


async def prune_expired_quota_windows(
    connection: Any,
    *,
    now: datetime | None = None,
    retain_minutes: int = 180,
    batch_size: int = 500,
) -> int:
    """Delete at most `batch_size` fully expired counter rows.

    Defaults retain three hours of *minute buckets*. Do not claim a retention
    guarantee until a scheduled job is installed, run and monitored.
    """
    if not isinstance(retain_minutes, int) or isinstance(retain_minutes, bool):
        raise ValueError("Invalid retention interval.")
    if not (60 <= retain_minutes <= 10080):
        raise ValueError("Retention must be between 60 and 10080 minutes.")
    if not isinstance(batch_size, int) or isinstance(batch_size, bool):
        raise ValueError("Invalid cleanup batch size.")
    if not (1 <= batch_size <= 1000):
        raise ValueError("Cleanup batch size must be between 1 and 1000.")
    moment = now or datetime.now(timezone.utc)
    if moment.tzinfo is None:
        raise ValueError("UTC-aware timestamp required.")
    cutoff_bucket = int(moment.timestamp()) // 60 - retain_minutes
    return int(await connection.fetchval(PRUNE_SQL, cutoff_bucket, batch_size))
