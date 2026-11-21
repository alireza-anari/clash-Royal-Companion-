"""Cloudflare Access JWT verifier for a FUTURE invite-only private beta.

Used only by the separate protected beta gateway; not mounted on the local API.
Never treat a forwarded identity header as verified.
The JWKS URL is derived from a strictly pinned team hostname to avoid SSRF.
"""
from __future__ import annotations

import asyncio
from dataclasses import dataclass
import re
import time
from typing import Callable

import httpx
import jwt


TEAM = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.cloudflareaccess\.com$")
KID = re.compile(r"^[A-Za-z0-9_.-]{1,128}$")


@dataclass(frozen=True)
class AccessDenied(Exception):
    code: str = "ACCESS_DENIED"


class AccessVerifier:
    """Verify RS256, signature, expiration, issuer, AUD, and explicit beta members.

    Credentials and decoded claims must NEVER be included in public errors/logs.
    An invited subject is Access's stable 'sub' claim, not a player tag.
    """

    def __init__(
        self,
        team_domain: str,
        audience: str,
        allowed_subjects: frozenset[str],
        *,
        transport: httpx.AsyncBaseTransport | None = None,
        clock: Callable[[], float] = time.monotonic,
        jwks_ttl_seconds: int = 300,
    ):
        if not TEAM.fullmatch(team_domain):
            raise ValueError("Cloudflare Access team domain must be a pinned team hostname.")
        if not audience or len(audience) > 256 or not allowed_subjects:
            raise ValueError("Audience and a nonempty explicit subject allowlist are required.")
        if any(not sub or len(sub) > 256 for sub in allowed_subjects):
            raise ValueError("Invalid allowlisted subject.")
        self.issuer = "https://" + team_domain
        self.audience = audience
        self.allowed_subjects = allowed_subjects
        self.certs_url = self.issuer + "/cdn-cgi/access/certs"
        self._transport = transport
        self._clock = clock
        self._ttl = max(1, min(jwks_ttl_seconds, 3600))
        self._jwks: dict[str, dict] = {}
        self._expires_at = 0.0
        self._lock = asyncio.Lock()

    async def _keys(self, force: bool = False) -> dict[str, dict]:
        async with self._lock:
            now = self._clock()
            if self._jwks and now < self._expires_at and not force:
                return self._jwks
            try:
                async with httpx.AsyncClient(
                    transport=self._transport,
                    timeout=httpx.Timeout(5.0),
                    follow_redirects=False,
                    trust_env=False,
                ) as client:
                    response = await client.get(
                        self.certs_url, headers={"Accept": "application/json"}
                    )
                    response.raise_for_status()
                    data = response.json()
                if not isinstance(data, dict) or not isinstance(data.get("keys"), list):
                    raise ValueError("Malformed public key set")
                found: dict[str, dict] = {}
                for key in data["keys"]:
                    if not isinstance(key, dict):
                        continue
                    kid = key.get("kid")
                    if (
                        isinstance(kid, str)
                        and KID.fullmatch(kid)
                        and key.get("kty") == "RSA"
                        and key.get("alg", "RS256") == "RS256"
                        and key.get("use", "sig") == "sig"
                    ):
                        found[kid] = key
                if not found or len(found) > 20:
                    raise ValueError("Unacceptable public key set")
            except (httpx.HTTPError, ValueError, TypeError) as exc:
                # Fail closed when key refresh fails. Never use stale keys.
                self._jwks = {}
                self._expires_at = 0.0
                raise AccessDenied("ACCESS_KEYS_UNAVAILABLE") from exc
            self._jwks = found
            self._expires_at = now + self._ttl
            return found

    async def verify(self, assertion: str) -> str:
        """Return only the allowed authenticated subject ID."""
        if not isinstance(assertion, str) or len(assertion) > 8192:
            raise AccessDenied("ACCESS_TOKEN_INVALID")
        try:
            header = jwt.get_unverified_header(assertion)
        except jwt.PyJWTError as exc:
            raise AccessDenied("ACCESS_TOKEN_INVALID") from exc
        kid = header.get("kid")
        if header.get("alg") != "RS256" or not isinstance(kid, str) or not KID.fullmatch(kid):
            raise AccessDenied("ACCESS_TOKEN_INVALID")
        keys = await self._keys()
        key = keys.get(kid)
        if key is None:
            keys = await self._keys(force=True)  # Key rotation, one trusted refresh.
            key = keys.get(kid)
        if key is None:
            raise AccessDenied("ACCESS_TOKEN_INVALID")
        try:
            public_key = jwt.PyJWK.from_dict(key).key
            claims = jwt.decode(
                assertion,
                public_key,
                algorithms=["RS256"],
                issuer=self.issuer,
                audience=self.audience,
                options={"require": ["iss", "aud", "sub", "iat", "exp"]},
                leeway=30,
            )
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise AccessDenied("ACCESS_TOKEN_INVALID") from exc
        subject = claims.get("sub")
        if not isinstance(subject, str) or subject not in self.allowed_subjects:
            raise AccessDenied("ACCESS_NOT_INVITED")
        return subject
