"""Bounded process-local upstream response cache and request budget.

No Redis, filesystem, background workers, cross-process sharing or production
quota assumptions. All player data lives temporarily in this process's RAM.
"""
from __future__ import annotations

import asyncio
from collections import OrderedDict, deque
from copy import deepcopy
from dataclasses import dataclass
from datetime import datetime, timezone
import time
from typing import Any, Awaitable, Callable


@dataclass(frozen=True)
class BudgetExceeded(Exception):
    message: str = "Local upstream request budget exhausted."


@dataclass(frozen=True)
class CacheEntry:
    value: Any
    expires_at: float
    fetched_at: str


class UpstreamCache:
    def __init__(
        self,
        *,
        max_entries: int = 256,
        budget: int = 90,
        budget_window: float = 60.0,
        max_inflight: int = 64,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.max_entries = max(1, max_entries)
        self.budget = max(1, budget)
        self.budget_window = max(1.0, budget_window)
        self.max_inflight = max(1, max_inflight)
        self._clock = clock
        self._lock = asyncio.Lock()
        self._cache: OrderedDict[str, CacheEntry] = OrderedDict()
        self._inflight: dict[str, asyncio.Task] = {}
        self._starts: deque[float] = deque()

    async def _load(
        self, key: str, ttl: float, loader: Callable[[], Awaitable[Any]]
    ) -> tuple[Any, str, bool]:
        try:
            now = self._clock()
            async with self._lock:
                cutoff = now - self.budget_window
                while self._starts and self._starts[0] <= cutoff:
                    self._starts.popleft()
                if len(self._starts) >= self.budget:
                    raise BudgetExceeded()
                self._starts.append(now)
            # An upstream failure never populates the cache; failed calls still
            # consume a budget slot and therefore cannot spin indefinitely.
            value = await loader()
            fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
            if ttl > 0:
                async with self._lock:
                    self._cache.pop(key, None)
                    self._cache[key] = CacheEntry(deepcopy(value), self._clock() + ttl, fetched_at)
                    while len(self._cache) > self.max_entries:
                        self._cache.popitem(last=False)
            return value, fetched_at, False
        finally:
            async with self._lock:
                # Singleflight: another caller sharing this task must not remove
                # a newer task registered for the same key.
                if self._inflight.get(key) is asyncio.current_task():
                    del self._inflight[key]

    async def run(
        self, key: str, ttl: float, loader: Callable[[], Awaitable[Any]]
    ) -> tuple[Any, str, bool]:
        now = self._clock()
        async with self._lock:
            cached = self._cache.get(key)
            if cached and cached.expires_at > now:
                self._cache.move_to_end(key)
                return deepcopy(cached.value), cached.fetched_at, True
            if cached:
                self._cache.pop(key, None)
            task = self._inflight.get(key)
            if task is None:
                if len(self._inflight) >= self.max_inflight:
                    raise BudgetExceeded("Too many concurrent upstream requests.")
                task = asyncio.create_task(self._load(key, ttl, loader))
                self._inflight[key] = task
        # Cancellation of a single HTTP request must not cancel the shared
        # in-flight upstream request awaited by other clients.
        data, fetched_at, cached = await asyncio.shield(task)
        return deepcopy(data), fetched_at, cached

    def stats(self) -> dict[str, int]:
        """For tests only. Never expose per-player cache keys in a public API."""
        return {"entries": len(self._cache), "inflight": len(self._inflight)}
