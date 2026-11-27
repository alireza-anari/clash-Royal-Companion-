"""PostgreSQL retention tests with a disposable CI service only."""
from datetime import datetime, timedelta, timezone
import os
from pathlib import Path

import asyncpg
import pytest

from crc_api.security.quota_cleanup import prune_expired_quota_windows
from crc_api.security.shared_quota import PostgresSharedQuota


DATABASE = os.environ.get("CRC_TEST_POSTGRES_DSN")
WHEN = datetime(2026, 11, 20, 14, 15, tzinfo=timezone.utc)


@pytest.mark.asyncio
async def test_cleanup_arguments_are_checked_before_sql():
    class NeverQuery:
        async def fetchval(self, *args):
            raise AssertionError("Cleanup must not execute SQL on bad input.")
    for options in (
        {"retain_minutes": 0}, {"retain_minutes": 10081},
        {"retain_minutes": True}, {"batch_size": 0},
        {"batch_size": 1001}, {"batch_size": True},
        {"now": datetime(2026, 11, 20)},
    ):
        with pytest.raises(ValueError):
            await prune_expired_quota_windows(NeverQuery(), **options)


@pytest.mark.asyncio
async def test_bounded_cleanup_removes_old_buckets_but_preserves_new():
    if not DATABASE:
        pytest.skip("Only disposable GitHub Actions PostgreSQL runs this test.")
    conn = await asyncpg.connect(DATABASE)
    try:
        migration = Path(__file__).resolve().parents[1] / "migrations" / "DRAFT_0001_gateway_quota.sql"
        await conn.execute(migration.read_text())
        await conn.execute("DELETE FROM gateway_quota_windows")
        budget = PostgresSharedQuota(b"test-fixture-secret-for-retention-only-123456789", per_member=5, global_budget=20)
        expired = WHEN - timedelta(hours=4)
        recent = WHEN - timedelta(minutes=15)
        await budget.reserve(conn, "old-test-subject", now=expired)
        await budget.reserve(conn, "recent-test-subject", now=recent)
        assert await conn.fetchval("SELECT COUNT(*) FROM gateway_quota_windows") == 4

        # Each admission produces one member + one global counter. A single
        # maintenance invocation never removes more than its requested batch.
        first = await prune_expired_quota_windows(conn, now=WHEN, batch_size=1)
        assert first == 1
        assert await conn.fetchval("SELECT COUNT(*) FROM gateway_quota_windows") == 3
        second = await prune_expired_quota_windows(conn, now=WHEN, batch_size=1)
        assert second == 1
        assert await conn.fetchval("SELECT COUNT(*) FROM gateway_quota_windows") == 2
        third = await prune_expired_quota_windows(conn, now=WHEN, batch_size=10)
        assert third == 0

        recent_key = budget._digest("member:recent-test-subject")
        assert await conn.fetchval(
            "SELECT used FROM gateway_quota_windows WHERE scope='member' AND subject_key=$1",
            recent_key
        ) == 1
    finally:
        await conn.close()
