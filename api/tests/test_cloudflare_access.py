import json
import time

import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from crc_api.security.cloudflare_access import AccessDenied, AccessVerifier


TEAM = "crc-private-beta.cloudflareaccess.com"
ISSUER = "https://" + TEAM
AUDIENCE = "test-application-audience"
SUBJECT = "user-opaque-123"


@pytest.fixture
def signed_access():
    private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    public_jwk = json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(private.public_key()))
    public_jwk.update({"kid": "one-key", "alg": "RS256", "use": "sig"})
    def sign(**claims):
        now = int(time.time())
        payload = {"iss": ISSUER, "aud": AUDIENCE, "sub": SUBJECT,
                   "iat": now, "exp": now + 300}
        payload.update(claims)
        return jwt.encode(payload, private, algorithm="RS256", headers={"kid": "one-key"})
    return sign, {"keys": [public_jwk]}


def verifier(public_keys, allow=None, handler=None):
    hits = [0]
    def respond(request):
        hits[0] += 1
        assert request.url.host == TEAM
        assert request.url.path == "/cdn-cgi/access/certs"
        assert "Authorization" not in request.headers
        if handler is not None:
            return handler(request)
        return httpx.Response(200, json=public_keys)
    client = AccessVerifier(
        TEAM, AUDIENCE, frozenset(allow if allow is not None else {SUBJECT}),
        transport=httpx.MockTransport(respond),
    )
    return client, hits


@pytest.mark.asyncio
async def test_verifies_signature_aud_issuer_exp_and_allowlist(signed_access):
    sign, keys = signed_access
    client, hits = verifier(keys)
    assert await client.verify(sign()) == SUBJECT
    assert await client.verify(sign()) == SUBJECT
    assert hits[0] == 1  # Bounded JWKS cache


@pytest.mark.asyncio
@pytest.mark.parametrize("modified", [
    {"aud": "wrong-application"}, {"iss": "https://other.cloudflareaccess.com"},
    {"exp": 1}, {"iat": 1, "exp": 2}, {"sub": "not-invited"},
])
async def test_rejects_invalid_claims(signed_access, modified):
    sign, keys = signed_access
    client, _ = verifier(keys)
    with pytest.raises(AccessDenied):
        await client.verify(sign(**modified))


@pytest.mark.asyncio
async def test_rejects_malformed_none_algorithm_and_wrong_signature(signed_access):
    sign, keys = signed_access
    client, _ = verifier(keys)
    for bad in ["garbage", jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": SUBJECT},
        key="", algorithm="none", headers={"kid": "one-key"}
    )]:
        with pytest.raises(AccessDenied):
            await client.verify(bad)
    another_private = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    now = int(time.time())
    forged = jwt.encode(
        {"iss": ISSUER, "aud": AUDIENCE, "sub": SUBJECT, "iat": now, "exp": now + 300},
        another_private, algorithm="RS256", headers={"kid": "one-key"}
    )
    with pytest.raises(AccessDenied):
        await client.verify(forged)


@pytest.mark.asyncio
async def test_fails_closed_if_jwks_unavailable(signed_access):
    sign, keys = signed_access
    client, hits = verifier(keys, handler=lambda req: httpx.Response(503))
    with pytest.raises(AccessDenied) as e:
        await client.verify(sign())
    assert e.value.code == "ACCESS_KEYS_UNAVAILABLE"
    assert hits[0] == 1


@pytest.mark.asyncio
async def test_rejects_unknown_key_id_without_accepting_untrusted_payload(signed_access):
    sign, keys = signed_access
    client, hits = verifier(keys)
    original = sign()
    header, body, signature = original.split(".")
    import base64
    tampered = base64.urlsafe_b64encode(
        json.dumps({"alg": "RS256", "kid": "unexpected-key"}).encode()
    ).decode().rstrip("=") + "." + body + "." + signature
    with pytest.raises(AccessDenied):
        await client.verify(tampered)
    assert hits[0] == 2  # refresh once for possible key rotation


def test_rejects_arbitrary_team_url_and_empty_approved_member_list():
    with pytest.raises(ValueError):
        AccessVerifier("localhost", AUDIENCE, frozenset({SUBJECT}))
    with pytest.raises(ValueError):
        AccessVerifier("evil.example.cloudflareaccess.com", AUDIENCE, frozenset({SUBJECT}))
    with pytest.raises(ValueError):
        AccessVerifier(TEAM, AUDIENCE, frozenset())
