"""Local development admission control.

This intentionally fails closed for non-loopback peers. It is NOT a substitute for
a distributed rate limiter, trusted reverse-proxy setup, or user authentication.
"""
from __future__ import annotations

import asyncio
from collections import deque
from dataclasses import dataclass
import hmac
import ipaddress
import os
import time
from typing import Callable


@dataclass(frozen=True)
class AdmissionError(Exception):
    code: str
    status: int
    message: str
    retry_after: int | None = None


def bounded_int(name: str, default: int, minimum: int, maximum: int) -> int:
    try:
        value = int(os.getenv(name, str(default)))
        return max(minimum, min(value, maximum))
    except ValueError:
        return default


class LocalAdmission:
    """Limits request bursts per immediate socket peer within ONE process."""

    def __init__(
        self,
        *,
        limit: int = 60,
        window_seconds: float = 60.0,
        secret: str = "",
        clock: Callable[[], float] = time.monotonic,
        max_peers: int = 256,
    ):
        self.limit = max(1, limit)
        self.window = max(1.0, window_seconds)
        self.secret = secret
        self.clock = clock
        self.max_peers = max(1, max_peers)
        self._buckets: dict[str, deque[float]] = {}
        self._lock = asyncio.Lock()

    @staticmethod
    def is_local_peer(host: str) -> bool:
        # TestClient's synthetic socket peer is not representable on the network.
        # Do NOT authorize based on Host, Origin, Forwarded or X-Forwarded-For.
        if host == "testclient":
            return True
        try:
            return ipaddress.ip_address(host).is_loopback
        except ValueError:
            return False

    async def admit(self, peer: str, supplied_secret: str = "") -> None:
        if not self.is_local_peer(peer):
            raise AdmissionError("LOCAL_ONLY", 403, "این Backend فقط از دستگاه محلی قابل استفاده است.")
        if self.secret and not hmac.compare_digest(supplied_secret, self.secret):
            raise AdmissionError("INTERNAL_ACCESS_DENIED", 403, "دسترسی به Backend مجاز نیست.")

        now = self.clock()
        cutoff = now - self.window
        async with self._lock:
            bucket = self._buckets.get(peer)
            if bucket is None:
                if len(self._buckets) >= self.max_peers:
                    # Keep memory bounded even if client address churn is unusual.
                    obsolete = [key for key, q in self._buckets.items()
                                if not q or q[-1] <= cutoff]
                    for key in obsolete:
                        self._buckets.pop(key, None)
                    if len(self._buckets) >= self.max_peers:
                        raise AdmissionError("LOCAL_LIMITED", 429, "درخواست‌ها موقتاً محدود شده‌اند.", 60)
                bucket = deque()
                self._buckets[peer] = bucket
            while bucket and bucket[0] <= cutoff:
                bucket.popleft()
            if len(bucket) >= self.limit:
                retry_after = max(1, int(self.window - (now - bucket[0])) + 1)
                raise AdmissionError("LOCAL_LIMITED", 429, "درخواست‌ها موقتاً محدود شده‌اند.", retry_after)
            bucket.append(now)


def configured_admission() -> LocalAdmission:
    return LocalAdmission(
        limit=bounded_int("CRC_LOCAL_RPM", 60, 1, 500),
        secret=os.getenv("CRC_INTERNAL_ACCESS_TOKEN", ""),
    )
