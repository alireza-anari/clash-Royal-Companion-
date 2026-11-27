"""Provider-neutral OIDC identity exchange for native clients.

Only a verified ID token and a one-time Worker-signed nonce can create an
account session. Provider identifiers and email addresses are never stored.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlsplit
from uuid import uuid4
from typing import Any

import httpx
import jwt
from pydantic import BaseModel, ConfigDict, Field, StrictStr


NONCE_AUDIENCE = "crc-oidc-nonce"
MOBILE_AUDIENCE = "crc-mobile-session"
MOBILE_TOKEN_TTL = 900
NONCE_TTL = 300
MAX_ID_TOKEN_AGE = 600
MAX_JWKS_BYTES = 64 * 1024


class OIDCIdentityError(Exception):
    pass


class OIDCInvalidToken(OIDCIdentityError):
    pass


class OIDCNonceReplay(OIDCIdentityError):
    pass


class OIDCProviderUnavailable(OIDCIdentityError):
    pass


class OIDCExchangeRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")
    id_token: StrictStr = Field(min_length=100, max_length=16_384)
    nonce_token: StrictStr = Field(min_length=100, max_length=4_096)


class OIDCIdentityService:
    def __init__(
        self,
        *,
        issuer: str,
        client_id: str,
        jwks_url: str,
        redirect_uri: str,
        beta_issuer: str,
        worker_secret: bytes,
        account_secret: bytes,
        vision_hmac_secret: bytes = b"",
        transport: httpx.AsyncBaseTransport | None = None,
    ):
        self.issuer = issuer
        self.client_id = client_id
        self.jwks_url = jwks_url
        self.redirect_uri = redirect_uri
        self.beta_issuer = beta_issuer
        self.worker_secret = worker_secret
        self.account_secret = account_secret
        self.vision_hmac_secret = vision_hmac_secret
        self.transport = transport
        self._jwks: dict[str, dict[str, Any]] | None = None
        self._jwks_loaded_at = 0.0
        self._jwks_lock = asyncio.Lock()

    @property
    def enabled(self) -> bool:
        return (
            bool(self.issuer and self.client_id and self.jwks_url and self.redirect_uri)
            and len(self.worker_secret) >= 32
            and len(self.account_secret) >= 32
        )

    def public_config(self) -> dict[str, Any]:
        if not self.enabled:
            raise OIDCProviderUnavailable()
        return {
            "enabled": True,
            "issuer": self.issuer,
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scopes": ["openid", "profile"],
            "response_type": "code",
            "pkce_required": True,
            "nonce_required": True,
        }

    def create_nonce(self) -> dict[str, Any]:
        if not self.enabled:
            raise OIDCProviderUnavailable()
        now = int(time.time())
        nonce = secrets.token_urlsafe(32)
        claims = {
            "iss": self.beta_issuer,
            "aud": NONCE_AUDIENCE,
            "sub": "oidc-nonce",
            "nonce": nonce,
            "iat": now,
            "exp": now + NONCE_TTL,
            "jti": uuid4().hex,
        }
        token = jwt.encode(claims, self.worker_secret, algorithm="HS256")
        return {"nonce": nonce, "nonce_token": token, "expires_in": NONCE_TTL}

    def _nonce_claims(self, token: str) -> dict[str, Any]:
        if not isinstance(token, str) or len(token) > 4_096:
            raise OIDCInvalidToken()
        try:
            claims = jwt.decode(
                token,
                self.worker_secret,
                algorithms=["HS256"],
                issuer=self.beta_issuer,
                audience=NONCE_AUDIENCE,
                options={"require": ["iss", "aud", "sub", "nonce", "iat", "exp", "jti"]},
                leeway=5,
            )
        except (jwt.PyJWTError, ValueError, TypeError):
            raise OIDCInvalidToken() from None
        now = int(time.time())
        if (
            claims.get("sub") != "oidc-nonce"
            or not isinstance(claims.get("nonce"), str)
            or len(claims["nonce"]) < 32
            or len(claims["nonce"]) > 128
            or not isinstance(claims.get("jti"), str)
            or len(claims["jti"]) != 32
            or claims["exp"] - claims["iat"] > NONCE_TTL
            or claims["iat"] > now + 15
        ):
            raise OIDCInvalidToken()
        return claims

    async def _get_jwks(self) -> dict[str, dict[str, Any]]:
        now = time.time()
        if self._jwks is not None and now - self._jwks_loaded_at < 300:
            return self._jwks
        async with self._jwks_lock:
            now = time.time()
            if self._jwks is not None and now - self._jwks_loaded_at < 300:
                return self._jwks
            try:
                async with httpx.AsyncClient(
                    timeout=httpx.Timeout(4.0, connect=2.0),
                    follow_redirects=False,
                    transport=self.transport,
                ) as client:
                    response = await client.get(
                        self.jwks_url,
                        headers={"Accept": "application/json"},
                    )
                if response.status_code != 200 or len(response.content) > MAX_JWKS_BYTES:
                    raise OIDCProviderUnavailable()
                document = response.json()
            except OIDCProviderUnavailable:
                raise
            except Exception:
                raise OIDCProviderUnavailable() from None
            keys = document.get("keys") if isinstance(document, dict) else None
            if not isinstance(keys, list) or not 1 <= len(keys) <= 32:
                raise OIDCProviderUnavailable()
            indexed: dict[str, dict[str, Any]] = {}
            for key in keys:
                if (
                    not isinstance(key, dict)
                    or key.get("kty") != "RSA"
                    or key.get("alg", "RS256") != "RS256"
                    or key.get("use", "sig") != "sig"
                    or not isinstance(key.get("kid"), str)
                    or not key["kid"]
                    or len(key["kid"]) > 128
                ):
                    continue
                indexed[key["kid"]] = key
            if not indexed:
                raise OIDCProviderUnavailable()
            self._jwks = indexed
            self._jwks_loaded_at = now
            return indexed

    async def _verified_id_claims(self, token: str, expected_nonce: str) -> dict[str, Any]:
        if not isinstance(token, str) or len(token) > 16_384:
            raise OIDCInvalidToken()
        try:
            header = jwt.get_unverified_header(token)
        except (jwt.PyJWTError, ValueError, TypeError):
            raise OIDCInvalidToken() from None
        if (
            header.get("alg") != "RS256"
            or not isinstance(header.get("kid"), str)
            or len(header.get("kid", "")) > 128
            or header.get("typ", "JWT") != "JWT"
        ):
            raise OIDCInvalidToken()
        keys = await self._get_jwks()
        jwk = keys.get(header["kid"])
        if jwk is None:
            # One forced refresh handles normal provider key rotation.
            self._jwks_loaded_at = 0
            keys = await self._get_jwks()
            jwk = keys.get(header["kid"])
        if jwk is None:
            raise OIDCInvalidToken()
        try:
            public_key = jwt.PyJWK.from_dict(jwk).key
            claims = jwt.decode(
                token,
                public_key,
                algorithms=["RS256"],
                audience=self.client_id,
                issuer=self.issuer,
                options={"require": ["iss", "aud", "sub", "iat", "exp", "nonce"]},
                leeway=30,
            )
        except (jwt.PyJWTError, ValueError, TypeError):
            raise OIDCInvalidToken() from None
        now = int(time.time())
        subject = claims.get("sub")
        issued = claims.get("iat")
        expires = claims.get("exp")
        audiences = claims.get("aud")
        if (
            not isinstance(subject, str)
            or not subject
            or len(subject) > 255
            or isinstance(issued, bool)
            or not isinstance(issued, int)
            or isinstance(expires, bool)
            or not isinstance(expires, int)
            or issued > now + 30
            or now - issued > MAX_ID_TOKEN_AGE
            or expires - issued > 3_600
            or claims.get("nonce") != expected_nonce
            or (isinstance(audiences, list) and len(audiences) > 1 and claims.get("azp") != self.client_id)
        ):
            raise OIDCInvalidToken()
        return claims

    def _account_identity(self, provider_subject: str) -> tuple[str, str, str]:
        source = self.issuer.encode() + b"\0" + provider_subject.encode()
        account_digest = hmac.new(
            self.account_secret, b"crc-account-id-v1\0" + source, hashlib.sha256
        ).digest()[:16].hex()
        subject_key = hmac.new(
            self.account_secret, b"crc-account-db-v1\0" + source, hashlib.sha256
        ).hexdigest()
        provider_key = hmac.new(
            self.account_secret, b"crc-oidc-provider-v1\0" + source, hashlib.sha256
        ).hexdigest()
        return "acct_" + account_digest, subject_key, provider_key

    async def exchange(self, connection: Any, id_token: str, nonce_token: str) -> dict[str, Any]:
        if not self.enabled:
            raise OIDCProviderUnavailable()
        nonce_claims = self._nonce_claims(nonce_token)
        claims = await self._verified_id_claims(id_token, nonce_claims["nonce"])
        account_subject, identity_key, provider_key = self._account_identity(claims["sub"])
        now = int(time.time())
        async with connection.transaction():
            await connection.execute("DELETE FROM auth_oidc_nonce_uses WHERE expires_at < now()")
            consumed = await connection.fetchval(
                """INSERT INTO auth_oidc_nonce_uses(jti,expires_at)
                   VALUES($1,to_timestamp($2)) ON CONFLICT(jti) DO NOTHING
                   RETURNING jti""",
                nonce_claims["jti"], nonce_claims["exp"],
            )
            if consumed is None:
                raise OIDCNonceReplay()
            await connection.execute(
                """INSERT INTO auth_accounts(account_subject,identity_key)
                   VALUES($1,$2) ON CONFLICT(account_subject) DO NOTHING""",
                account_subject, identity_key,
            )
            account = await connection.fetchrow(
                "SELECT identity_key,status FROM auth_accounts WHERE account_subject=$1 FOR UPDATE",
                account_subject,
            )
            if account is None or account["identity_key"] != identity_key or account["status"] != "active":
                raise OIDCInvalidToken()
            await connection.execute(
                """INSERT INTO auth_identities(provider_key,account_subject)
                   VALUES($1,$2) ON CONFLICT(provider_key) DO NOTHING""",
                provider_key, account_subject,
            )
            identity = await connection.fetchval(
                "SELECT account_subject FROM auth_identities WHERE provider_key=$1",
                provider_key,
            )
            if identity != account_subject:
                raise OIDCInvalidToken()
            await connection.execute(
                """INSERT INTO vision_account_access(account_subject,enabled)
                   VALUES($1,false) ON CONFLICT(account_subject) DO NOTHING""",
                account_subject,
            )
            if len(self.vision_hmac_secret) >= 32:
                vision_key = hmac.new(
                    self.vision_hmac_secret, account_subject.encode(), hashlib.sha256
                ).hexdigest()
                await connection.execute(
                    """INSERT INTO vision_credit_accounts(subject_key,balance)
                       VALUES($1,0) ON CONFLICT(subject_key) DO NOTHING""",
                    vision_key,
                )
            await connection.execute(
                "UPDATE auth_accounts SET last_login_at=now() WHERE account_subject=$1",
                account_subject,
            )
        mobile_secret = hmac.new(
            self.worker_secret, b"crc-mobile-session-v1", hashlib.sha256
        ).digest()
        access_token = jwt.encode(
            {
                "iss": self.beta_issuer,
                "aud": MOBILE_AUDIENCE,
                "sub": account_subject,
                "iat": now,
                "exp": now + MOBILE_TOKEN_TTL,
                "jti": uuid4().hex,
                "token_use": "mobile_access",
            },
            mobile_secret,
            algorithm="HS256",
        )
        return {
            "account_subject": account_subject,
            "access_token": access_token,
            "token_type": "Bearer",
            "expires_in": MOBILE_TOKEN_TTL,
        }
