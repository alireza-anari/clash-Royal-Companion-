"""Verify short-lived HMAC assertions minted only by the private Cloudflare Worker.

This replaces the Cloudflare Access dependency for the no-card invite-only beta.
The signing key is shared only between Worker Secrets and AWS SSM; never browser code.
"""
from __future__ import annotations

from dataclasses import dataclass
import re
import time
from urllib.parse import urlsplit

import jwt


SUBJECT = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$")
JTI = re.compile(r"^[A-Za-z0-9_-]{16,128}$")


@dataclass(frozen=True)
class WorkerAssertionDenied(Exception):
    code: str = "WORKER_ASSERTION_INVALID"


class WorkerAssertionVerifier:
    """Verify pinned HS256 issuer/audience, short expiry, jti and invited subject."""

    def __init__(
        self,
        issuer: str,
        audience: str,
        allowed_subjects: frozenset[str],
        secret: bytes,
    ):
        parsed = urlsplit(issuer)
        if (
            parsed.scheme != "https"
            or not parsed.hostname
            or parsed.username is not None
            or parsed.password is not None
            or parsed.path not in ("", "/")
            or parsed.query
            or parsed.fragment
            or issuer.rstrip("/") != f"https://{parsed.hostname.lower()}"
        ):
            raise ValueError("Worker assertion issuer must be one pinned HTTPS origin.")
        if not audience or len(audience) > 256 or not allowed_subjects:
            raise ValueError("Audience and a nonempty explicit subject allowlist are required.")
        if any(not isinstance(sub, str) or not SUBJECT.fullmatch(sub) for sub in allowed_subjects):
            raise ValueError("Invalid allowlisted subject.")
        if not isinstance(secret, bytes) or len(secret) < 32:
            raise ValueError("Worker assertion HMAC key must contain at least 32 bytes.")
        self.issuer = issuer.rstrip("/")
        self.audience = audience
        self.allowed_subjects = allowed_subjects
        self.secret = secret

    async def verify(self, assertion: str) -> str:
        """Return only the invited subject; never return or log JWT claims."""
        if not isinstance(assertion, str) or not assertion or len(assertion) > 8192:
            raise WorkerAssertionDenied("WORKER_ASSERTION_INVALID")
        try:
            header = jwt.get_unverified_header(assertion)
            if header != {"alg": "HS256", "typ": "JWT"}:
                raise WorkerAssertionDenied("WORKER_ASSERTION_INVALID")
            claims = jwt.decode(
                assertion,
                self.secret,
                algorithms=["HS256"],
                issuer=self.issuer,
                audience=self.audience,
                options={"require": ["iss", "aud", "sub", "iat", "exp", "jti"]},
                leeway=15,
            )
        except WorkerAssertionDenied:
            raise
        except (jwt.PyJWTError, ValueError, TypeError) as exc:
            raise WorkerAssertionDenied("WORKER_ASSERTION_INVALID") from exc

        subject = claims.get("sub")
        issued = claims.get("iat")
        expires = claims.get("exp")
        jti = claims.get("jti")
        now = time.time()
        if (
            not isinstance(subject, str)
            or not SUBJECT.fullmatch(subject)
            or subject not in self.allowed_subjects
            or isinstance(issued, bool)
            or not isinstance(issued, (int, float))
            or isinstance(expires, bool)
            or not isinstance(expires, (int, float))
            or expires <= issued
            or expires - issued > 120
            or issued > now + 15
            or not isinstance(jti, str)
            or not JTI.fullmatch(jti)
        ):
            raise WorkerAssertionDenied("WORKER_ASSERTION_INVALID")
        return subject
