"""Official read-only Supercell API adapter. Never return credentials in errors."""
from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any
from urllib.parse import quote

import httpx

BASE_URL = "https://api.clashroyale.com/v1"


@dataclass
class SupercellError(Exception):
    code: str
    public_message: str
    http_status: int
    retryable: bool = False


class SupercellClient:
    def __init__(self, token: str | None = None, transport: httpx.AsyncBaseTransport | None = None):
        self._token = token if token is not None else os.environ.get("SUPERCELL_API_KEY", "")
        self._transport = transport

    @property
    def configured(self) -> bool:
        return bool(self._token and self._token != "replace-with-your-secret-key")

    async def get(self, path: str) -> dict[str, Any] | list[dict[str, Any]]:
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

    async def cards(self) -> dict[str, Any]:
        payload = await self.get("/cards")
        if not isinstance(payload, dict) or not isinstance(payload.get("items"), list):
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "فهرست کارت‌ها نامعتبر است.", 502)
        return payload

    async def player(self, tag: str) -> dict[str, Any]:
        payload = await self.get(f"/players/{quote(tag, safe='')}")
        if not isinstance(payload, dict) or not isinstance(payload.get("tag"), str):
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "اطلاعات بازیکن نامعتبر است.", 502)
        return payload

    async def battles(self, tag: str) -> list[dict[str, Any]]:
        payload = await self.get(f"/players/{quote(tag, safe='')}/battlelog")
        if not isinstance(payload, list):
            raise SupercellError("UPSTREAM_BAD_RESPONSE", "تاریخچه بازی نامعتبر است.", 502)
        return payload
