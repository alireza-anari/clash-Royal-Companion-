"""Official read-only Supercell API adapter. Never return credentials in errors."""
from __future__ import annotations

import os
import time
from dataclasses import dataclass
from typing import Any, Callable
from urllib.parse import quote

import httpx

from .traffic import bounded_int
from .upstream_cache import BudgetExceeded, UpstreamCache

BASE_URL = "https://api.clashroyale.com/v1"


@dataclass
class SupercellError(Exception):
    code: str
    public_message: str
    http_status: int
    retryable: bool = False


class SupercellClient:
    def __init__(
        self,
        token: str | None = None,
        transport: httpx.AsyncBaseTransport | None = None,
        *,
        clock: Callable[[], float] = time.monotonic,
        cache_ttls: dict[str, int] | None = None,
        budget: int | None = None,
    ):
        self._token = token if token is not None else os.environ.get("SUPERCELL_API_KEY", "")
        self._transport = transport
        self._cache_ttls = cache_ttls if cache_ttls is not None else {
            "cards": bounded_int("CRC_CACHE_CARDS_TTL", 900, 0, 3600),
            "player": bounded_int("CRC_CACHE_PLAYER_TTL", 30, 0, 180),
            "battles": bounded_int("CRC_CACHE_BATTLES_TTL", 15, 0, 60),
        }
        self._cache = UpstreamCache(
            budget=budget if budget is not None else bounded_int("CRC_UPSTREAM_RPM", 90, 1, 600),
            max_entries=bounded_int("CRC_CACHE_MAX_ENTRIES", 256, 1, 1024),
            clock=clock,
        )

    @property
    def configured(self) -> bool:
        return bool(self._token and self._token != "replace-with-your-secret-key")

    async def _get_uncached(self, path: str) -> dict[str, Any] | list[dict[str, Any]]:
        if not self.configured:
            raise SupercellError("CONFIG_MISSING", "کلید Supercell روی Backend تنظیم نشده است.", 503)
        # A fixed base URL and adapter-generated paths prevent SSRF and arbitrary upstream URLs.
        try:
            async with httpx.AsyncClient(
                base_url=BASE_URL,
                transport=self._transport,
                timeout=httpx.Timeout(8.0),
                follow_redirects=False,
                headers={"Authorization": f"Bearer {self._token}", "Accept": "application/json"},
            ) as client:
                response = await client.get(path)
        except httpx.TimeoutException as exc:
            raise SupercellError("UPSTREAM_TIMEOUT", "ارتباط با سرور بازی زمان‌بر شد.", 504, True) from exc
        except httpx.HTTPError as exc:
            raise SupercellError("UPSTREAM_UNAVAILABLE", "ارتباط با سرور بازی برقرار نشد.", 503, True) from exc

        if response.status_code == 404:
            raise SupercellError("PLAYER_NOT_FOUND", "بازیکن پیدا نشد.", 404)
        if response.status_code == 429:
            raise SupercellError("UPSTREAM_RATE_LIMITED", "درخواست‌ها به محدودیت موقت رسیده‌اند.", 429, True)
        if response.status_code in (401, 403):
            raise SupercellError("UPSTREAM_FORBIDDEN", "دسترسی سرور به اطلاعات بازی مجاز نیست.", 502)
        if response.status_code >= 500:
            raise SupercellError("UPSTREAM_UNAVAILABLE", "سرویس بازی موقتاً در دسترس نیست.", 503, True)
        if response.status_code != 200:
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "پاسخ غیرمنتظره از سرویس بازی.", 502)
        try:
            payload = response.json()
        except ValueError as exc:
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "پاسخ دریافتی معتبر نیست.", 502) from exc
        if not isinstance(payload, (list, dict)):
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "فرمت پاسخ قابل پشتیبانی نیست.", 502)
        return payload

    async def _record(self, kind: str, path: str) -> tuple[Any, dict[str, Any]]:
        async def validated_loader() -> Any:
            payload = await self._get_uncached(path)
            if kind == "cards" and (not isinstance(payload, dict) or not isinstance(payload.get("items"), list)):
                raise SupercellError("UPSTREAM_BAD_RESPONSE", "فهرست کارت‌ها نامعتبر است.", 502)
            if kind == "player" and (not isinstance(payload, dict) or not isinstance(payload.get("tag"), str)):
                raise SupercellError("UPSTREAM_BAD_RESPONSE", "اطلاعات بازیکن نامعتبر است.", 502)
            if kind == "battles" and not isinstance(payload, list):
                raise SupercellError("UPSTREAM_BAD_RESPONSE", "تاریخچه بازی نامعتبر است.", 502)
            return payload

        try:
            data, fetched_at, cached = await self._cache.run(
                kind + ":" + path, self._cache_ttls.get(kind, 0), validated_loader
            )
        except BudgetExceeded as exc:
            raise SupercellError(
                "LOCAL_UPSTREAM_BUDGET", "سقف محافظه‌کارانه درخواست‌های سرور پر شده است.", 429, True
            ) from exc
        return data, {
            "provider": "supercell",
            "fetched_at": fetched_at,
            "stale": False,
            "cached": cached,
        }

    async def cards_record(self) -> tuple[dict[str, Any], dict[str, Any]]:
        return await self._record("cards", "/cards")

    async def player_record(self, tag: str) -> tuple[dict[str, Any], dict[str, Any]]:
        return await self._record("player", f"/players/{quote(tag, safe='')}")

    async def battles_record(self, tag: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
        return await self._record("battles", f"/players/{quote(tag, safe='')}/battlelog")

    async def cards(self) -> dict[str, Any]:
        return (await self.cards_record())[0]

    async def player(self, tag: str) -> dict[str, Any]:
        return (await self.player_record(tag))[0]

    async def battles(self, tag: str) -> list[dict[str, Any]]:
        return (await self.battles_record(tag))[0]
