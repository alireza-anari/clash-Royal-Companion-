"""Security tests for the no-card Worker assertion verifier."""
from __future__ import annotations

import time

import jwt
import pytest

from crc_api.security.worker_assertion import WorkerAssertionDenied, WorkerAssertionVerifier


ISSUER = "https://beta.example.test"
AUDIENCE = "crc-private-beta-api"
SUBJECT = "tester-opaque-id"
SECRET = b"test-only-worker-assertion-secret-123456789"


def verifier():
    return WorkerAssertionVerifier(ISSUER, AUDIENCE, frozenset({SUBJECT}), SECRET)


def token(**changes):
    now = int(time.time())
    claims = {
        "iss": ISSUER,
        "aud": AUDIENCE,
        "sub": SUBJECT,
        "iat": now,
        "exp": now + 60,
        "jti": "test-token-identifier-1234",
    }
    claims.update(changes)
    return jwt.encode(claims, SECRET, algorithm="HS256")


@pytest.mark.asyncio
async def test_valid_short_lived_worker_assertion_returns_only_invited_subject():
    assert await verifier().verify(token()) == SUBJECT


@pytest.mark.asyncio
@pytest.mark.parametrize("claims", [
    {"iss": "https://evil.example"},
    {"aud": "other-api"},
    {"sub": "not-invited"},
    {"iat": int(time.time()) - 200, "exp": int(time.time()) - 100},
    {"iat": int(time.time()), "exp": int(time.time()) + 600},
    {"jti": "short"},
])
async def test_invalid_or_uninvited_assertions_fail_closed(claims):
    with pytest.raises(WorkerAssertionDenied):
        await verifier().verify(token(**claims))


@pytest.mark.asyncio
async def test_wrong_signing_key_and_non_hs256_algorithms_are_rejected():
    claims = {
        "iss": ISSUER, "aud": AUDIENCE, "sub": SUBJECT,
        "iat": int(time.time()), "exp": int(time.time()) + 60,
        "jti": "test-token-identifier-1234",
    }
    forged = jwt.encode(claims, b"x" * 40, algorithm="HS256")
    with pytest.raises(WorkerAssertionDenied):
        await verifier().verify(forged)
    with pytest.raises(WorkerAssertionDenied):
        await verifier().verify("not-a-jwt")


def test_issuer_and_key_configuration_are_pinned():
    with pytest.raises(ValueError):
        WorkerAssertionVerifier("http://beta.example.test", AUDIENCE, frozenset({SUBJECT}), SECRET)
    with pytest.raises(ValueError):
        WorkerAssertionVerifier("https://evil.example/path", AUDIENCE, frozenset({SUBJECT}), SECRET)
    with pytest.raises(ValueError):
        WorkerAssertionVerifier(ISSUER, AUDIENCE, frozenset({SUBJECT}), b"short")


@pytest.mark.asyncio
async def test_oidc_account_subjects_are_accepted_only_when_explicitly_enabled():
    account = "acct_" + "a" * 32
    assertion = jwt.encode({
        "iss": ISSUER, "aud": AUDIENCE, "sub": account,
        "iat": int(time.time()), "exp": int(time.time()) + 60,
        "jti": "account-token-identifier-1234",
    }, SECRET, algorithm="HS256")
    with pytest.raises(WorkerAssertionDenied):
        await verifier().verify(assertion)
    enabled = WorkerAssertionVerifier(
        ISSUER, AUDIENCE, frozenset({SUBJECT}), SECRET, allow_account_subjects=True
    )
    assert await enabled.verify(assertion) == account
    invalid = jwt.encode({
        "iss": ISSUER, "aud": AUDIENCE, "sub": "acct_not-hex",
        "iat": int(time.time()), "exp": int(time.time()) + 60,
        "jti": "account-token-identifier-1234",
    }, SECRET, algorithm="HS256")
    with pytest.raises(WorkerAssertionDenied):
        await enabled.verify(invalid)
