import asyncio

import httpx
import pytest

from crc_api.supercell import SupercellClient, SupercellError
from crc_api.upstream_cache import BudgetExceeded, UpstreamCache


@pytest.mark.asyncio
async def test_ttl_and_defensive_copies_without_stale_fetched_at():
    now = [10.0]
    calls = [0]
    cache = UpstreamCache(clock=lambda: now[0], budget=10)

    async def fetch():
        calls[0] += 1
        return {"items": [1, 2]}

    first, fetched_at, cached = await cache.run("cards", 10, fetch)
    assert cached is False
    first["items"].append(99)
    second, timestamp, cached = await cache.run("cards", 10, fetch)
    assert cached is True
    assert second == {"items": [1, 2]}
    assert timestamp == fetched_at
    assert calls[0] == 1
    now[0] = 21
    third, timestamp3, cached = await cache.run("cards", 10, fetch)
    assert cached is False
    assert calls[0] == 2
    assert third == {"items": [1, 2]}


@pytest.mark.asyncio
async def test_singleflight_simultaneous_callers_only_use_one_upstream_budget_slot():
    cache = UpstreamCache(budget=1)
    started = asyncio.Event()
    release = asyncio.Event()
    hits = [0]

    async def fetch():
        hits[0] += 1
        started.set()
        await release.wait()
        return {"items": [1]}

    first = asyncio.create_task(cache.run("cards", 1, fetch))
    await started.wait()
    second = asyncio.create_task(cache.run("cards", 1, fetch))
    await asyncio.sleep(0)
    release.set()
    a, b = await asyncio.gather(first, second)
    assert hits[0] == 1
    assert a[0] == b[0]
    assert cache.stats()["inflight"] == 0


@pytest.mark.asyncio
async def test_budget_blocks_new_calls_and_resets_after_window():
    clock = [50.0]
    cache = UpstreamCache(clock=lambda: clock[0], budget=2, budget_window=10)
    calls = [0]

    async def fetch():
        calls[0] += 1
        return [1]

    await cache.run("first", 0, fetch)
    await cache.run("second", 0, fetch)
    with pytest.raises(BudgetExceeded):
        await cache.run("third", 0, fetch)
    assert calls[0] == 2
    clock[0] += 11
    await cache.run("third", 0, fetch)
    assert calls[0] == 3


@pytest.mark.asyncio
async def test_errors_do_not_get_cached_or_expose_bad_data():
    clock = [0.0]
    cache = UpstreamCache(clock=lambda: clock[0], budget=4)
    hits = [0]

    async def failing():
        hits[0] += 1
        raise RuntimeError("simulated upstream failure")

    for _ in range(2):
        with pytest.raises(RuntimeError):
            await cache.run("failed", 100, failing)
    assert hits[0] == 2
    assert cache.stats()["entries"] == 0


@pytest.mark.asyncio
async def test_cache_has_bounded_memory_entries():
    cache = UpstreamCache(max_entries=2, budget=10)
    async def fetch(n):
        return {"n": n}
    for i in range(4):
        await cache.run(str(i), 100, lambda i=i: fetch(i))
    assert cache.stats()["entries"] == 2


@pytest.mark.asyncio
async def test_supercell_client_reports_cached_freshness_and_respects_upstream_budget():
    calls = []
    clock = [10.0]

    def responder(request: httpx.Request):
        calls.append(request.url.path)
        return httpx.Response(200, json={"items": [{"id": 1, "name": "Knight", "elixirCost": 3}]})

    api = SupercellClient(
        token="testing-only",
        transport=httpx.MockTransport(responder),
        clock=lambda: clock[0],
        cache_ttls={"cards": 15, "player": 0, "battles": 0},
        budget=1,
    )
    data1, source1 = await api.cards_record()
    data2, source2 = await api.cards_record()
    assert len(calls) == 1
    assert data1 == data2
    assert source1["cached"] is False
    assert source2["cached"] is True
    assert source2["fetched_at"] == source1["fetched_at"]
    clock[0] += 16
    with pytest.raises(SupercellError) as exc:
        await api.cards_record()
    assert exc.value.code == "LOCAL_UPSTREAM_BUDGET"
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_supercell_403_not_cached_and_error_code_is_sanitized():
    calls = [0]

    def forbidden(request: httpx.Request):
        calls[0] += 1
        return httpx.Response(403, json={"message": "private provider diagnostic"})

    api = SupercellClient(token="testing-only", transport=httpx.MockTransport(forbidden), budget=10)
    for _ in range(2):
        with pytest.raises(SupercellError) as exc:
            await api.cards_record()
        assert exc.value.code == "UPSTREAM_FORBIDDEN"
        assert "private" not in exc.value.public_message
    assert calls[0] == 2
