"""Invite-only beta admission orchestration.

The edge-signed assertion is verified before quota reservation and before any
Supercell lookup. This app is separate from the local-only FastAPI application.
"""
from __future__ import annotations

from typing import Any, Protocol

from .shared_quota import PostgresSharedQuota


class SubjectVerifier(Protocol):
    async def verify(self, assertion: str) -> str: ...


class PrivateBetaAdmission:
    def __init__(self, verifier: SubjectVerifier, quota: PostgresSharedQuota):
        self.verifier = verifier
        self.quota = quota

    async def admit(self, assertion: str, connection: Any) -> dict[str, Any]:
        # Identity must originate from a verified Worker-signed assertion, never
        # from browser-supplied email, Player Tag, forwarded IP or identity header.
        subject = await self.verifier.verify(assertion)
        reservation = await self.quota.reserve(connection, subject)
        return {"subject": subject, "quota": reservation}
