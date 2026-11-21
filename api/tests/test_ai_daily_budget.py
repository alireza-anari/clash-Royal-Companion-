"""Daily OpenRouter spending guard uses atomic PostgreSQL windows."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path

import pytest

from crc_api.ai_daily_budget import SharedAIDailyBudget, AIDailyBudgetExceeded


DSN = os.environ.get("CRC_TEST_POSTGRES_DSN")


def test_strict_daily_limit_configuration():
    key = b"in-memory-verified-quota-secret-123456"
    with pytest.raises(ValueError):
        SharedAIDailyBudget(b"too-short")
    with pytest.raises(ValueError):
        SharedAIDailyBudget(key, per_member=22, global_budget=22)
    budget = SharedAIDailyBudget(key, per_member=1, global_budget=2)
    assert budget._digest("ai-member:member-123") != "member-123"
    assert budget._digest("ai-member:member-123") != budget._digest("ai-member:other")


@pytest.mark.skipif(not DSN, reason="Disposable Postgres CI database required")
@pytest.mark.asyncio
async def test_atomic_daily_budget_in_disposable_postgres():
    import asyncpg
    conn = await asyncpg.connect(DSN)
    try:
        migration = Path(__file__).resolve().parents[1] / "migrations" / "DRAFT_0002_ai_daily_budget.sql"
        await conn.execute(migration.read_text())
        await conn.execute("DELETE FROM ai_daily_quota_windows")
        key = b"safe-ai-daily-budget-test-secret-hmac-abcdefg"
        budget = SharedAIDailyBudget(key, per_member=1, global_budget=1)
        at = datetime(2026, 11, 21, 8, 10, tzinfo=timezone.utc)
        await budget.reserve(conn, "invited-member-a", now=at)
        with pytest.raises(AIDailyBudgetExceeded) as repeated:
            await budget.reserve(conn, "invited-member-a", now=at)
        assert repeated.value.retry_after_seconds > 0
        # The next subject should hit global cap; member row must be rolled back.
        with pytest.raises(AIDailyBudgetExceeded):
            await budget.reserve(conn, "invited-member-b", now=at)
        day = int(at.timestamp()) // 86400
        rows = await conn.fetch("SELECT scope,subject_key,used FROM ai_daily_quota_windows WHERE day_number=$1", day)
        assert len(rows) == 2
        assert {row["scope"] for row in rows} == {"member", "global"}
        assert all(row["used"] == 1 for row in rows)
        assert not any("invited-member" in row["subject_key"] for row in rows)
        # UTC next day has its own budget.
        await budget.reserve(conn, "invited-member-b", now=at+timedelta(days=1))
    finally:
        await conn.close()
