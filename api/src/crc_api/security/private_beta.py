"""Inactive private-beta admission orchestration.

Intended position: behind authenticated edge + isolated origin, before ANY
Supercell lookup. This is mounted only by the separately created private-beta FastAPI app,
not by the existing local FastAPI application.
"""
from __future__ import annotations

from typing import Any

from .cloudflare_access import AccessVerifier
from .shared_quota import PostgresSharedQuota


class PrivateBetaAdmission:
    def __init__(self, verifier: AccessVerifier, quota: PostgresSharedQuota):
        self.verifier = verifier
        self.quota = quota

    async def admit(self, assertion: str, connection: Any) -> dict[str, Any]:
        # Identity must originate from verified signed JWT; never from a
        # browser-supplied email, Player Tag, X-Forwarded-For or access header alone.
        subject = await self.verifier.verify(assertion)
        reservation = await self.quota.reserve(connection, subject)
        return {"subject": subject, "quota": reservation}
