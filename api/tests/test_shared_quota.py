import asyncio
from datetime import datetime, timezone
import os
from pathlib import Path

import asyncpg
import pytest

from crc_api.security.shared_quota import PostgresSharedQuota, QuotaDenied


SECRET = b"unit-test-key-not-a-real-secret-1234567890"
NOW = datetime(2026, 11, 20, 14, 15, 25, tzinfo=timezone.utc)
TEST_DSN = os.environ.get("CRC_TEST_POSTGRES_DSN")


def new_quota(member=2, global_limit=5):
    return PostgresSharedQuota(SECRET, per_member=member, global_budget=global_limit)


def test_quota_hmac_subject_is_opaque_and_requires_strong_key():
    with pytest.raises(ValueError):
        PostgresSharedQuota(b"weak")
    a = new_quota()
    hashed = a._digest("member:sample-user")
    assert len(hashed) == 64
    assert "sample-user" not in hashed
    assert a._digest("member:sample-user") == hashed
    with pytest.raises(ValueError):
        a._digest("")


@pytest.mark.asyncio
async def test_naive_timestamp_rejected_before_any_database_activity():
    class Unused:
        def transaction(self):
            raise AssertionError("No transaction should start.")
    with pytest.raises(ValueError):
        await new_quota().reserve(Unused(), "test-sub", now=datetime(2026, 11, 20))


@pytest.mark.asyncio
async def test_postgres_global_budget_rolls_back_individual_count():
    if not TEST_DSN:
        pytest.skip("PostgreSQL integration runs in CI service.")
    connection = await asyncpg.connect(TEST_DSN)
    try:
        schema = Path(__file__).resolve().parents[1] / "migrations" / "DRAFT_0001_gateway_quota.sql"
        await connection.execute(schema.read_text())
        await connection.execute("DELETE FROM gateway_quota_windows")
        quota = new_quota(member=5, global_limit=1)
        first = await quota.reserve(connection, "subject-A", now=NOW)
        assert first == {"member_count": 1, "global_count": 1}
        with pytest.raises(QuotaDenied) as err:
            await quota.reserve(connection, "subject-B", now=NOW)
        assert err.value.code == "GLOBAL_QUOTA_EXCEEDED"
        # A rejected global request must not consume a subject's allowance.
        subject_key = quota._digest("member:subject-B")
        count = await connection.fetchval(
            "SELECT used FROM gateway_quota_windows WHERE scope='member' AND subject_key=$1",
            subject_key
        )
        assert count is None
    finally:
        await connection.close()


@pytest.mark.asyncio
async def test_postgres_member_budget_is_shared_across_parallel_connections():
    if not TEST_DSN:
        pytest.skip("PostgreSQL integration runs in CI service.")
    pool = await asyncpg.create_pool(TEST_DSN, min_size=2, max_size=8)
    try:
        async with pool.acquire() as conn:
            schema = Path(__file__).resolve().parents[1] / "migrations" / "DRAFT_0001_gateway_quota.sql"
            await conn.execute(schema.read_text())
            await conn.execute("DELETE FROM gateway_quota_windows")
        quota = new_quota(member=5, global_limit=20)
        async def attempt():
            async with pool.acquire() as conn:
                try:
                    return await quota.reserve(conn, "same-subject", now=NOW)
                except QuotaDenied as e:
                    return e
        results = await asyncio.gather(*(attempt() for _ in range(16)))
        accepted = [x for x in results if isinstance(x, dict)]
        rejected = [x for x in results if isinstance(x, QuotaDenied)]
        assert len(accepted) == 5
        assert len(rejected) == 11
        assert all(e.code == "MEMBER_QUOTA_EXCEEDED" for e in rejected)
        async with pool.acquire() as conn:
            counts = await conn.fetch(
                "SELECT scope, used FROM gateway_quota_windows ORDER BY scope"
            )
        assert {row["scope"]: row["used"] for row in counts} == {
            "member": 5, "global": 5
        }
    finally:
        await pool.close()


@pytest.mark.asyncio
async def test_postgres_new_minute_uses_new_quota_bucket():
    if not TEST_DSN:
        pytest.skip("PostgreSQL integration runs in CI service.")
    conn = await asyncpg.connect(TEST_DSN)
    try:
        quota = new_quota(member=1, global_limit=1)
        await conn.execute("DELETE FROM gateway_quota_windows")
        await quota.reserve(conn, "subject-C", now=NOW)
        with pytest.raises(QuotaDenied):
            await quota.reserve(conn, "subject-C", now=NOW)
        later = datetime(2026, 11, 20, 14, 16, 0, tzinfo=timezone.utc)
        counts = await quota.reserve(conn, "subject-C", now=later)
        assert counts["member_count"] == 1
    finally:
        await conn.close()
