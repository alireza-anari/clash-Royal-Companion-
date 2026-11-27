from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from pathlib import Path
from uuid import uuid4

import asyncpg
import httpx
import jwt
import pytest
from cryptography.hazmat.primitives.asymmetric import rsa

from crc_api.identity import (
    OIDCIdentityService, OIDCInvalidToken, OIDCNonceReplay,
    OIDCProviderUnavailable, OIDCExchangeRequest, MOBILE_AUDIENCE,
)

TEST_DSN=os.environ.get("CRC_TEST_POSTGRES_DSN")
ISSUER="https://accounts.example.test"
BETA_ISSUER="https://beta.example.test"
CLIENT_ID="crc-native-client"
REDIRECT_URI="com.crc.companion:/oauth2redirect"
WORKER_SECRET=b"oidc-test-worker-secret-123456789012345"
ACCOUNT_SECRET=b"oidc-test-stable-account-secret-123456789"
VISION_SECRET=b"oidc-test-vision-key-1234567890123456789"
PRIVATE_KEY=rsa.generate_private_key(public_exponent=65537,key_size=2048)
PUBLIC_JWK=json.loads(jwt.algorithms.RSAAlgorithm.to_jwk(PRIVATE_KEY.public_key()))
PUBLIC_JWK.update({"kid":"test-rsa-key","use":"sig","alg":"RS256"})

def service(transport=None):
 return OIDCIdentityService(
  issuer=ISSUER,client_id=CLIENT_ID,jwks_url="https://keys.example.test/jwks.json",
  redirect_uri=REDIRECT_URI,beta_issuer=BETA_ISSUER,worker_secret=WORKER_SECRET,
  account_secret=ACCOUNT_SECRET,vision_hmac_secret=VISION_SECRET,transport=transport)

def id_token(nonce,sub=None,**changes):
 now=int(time.time())
 claims={"iss":ISSUER,"aud":CLIENT_ID,"sub":sub or "player-"+uuid4().hex,
  "iat":now,"exp":now+300,"nonce":nonce}
 claims.update(changes)
 return jwt.encode(claims,PRIVATE_KEY,algorithm="RS256",headers={"kid":"test-rsa-key"})

def transport(status=200):
 def handler(request):
  assert str(request.url)=="https://keys.example.test/jwks.json"
  return httpx.Response(status,json={"keys":[PUBLIC_JWK]})
 return httpx.MockTransport(handler)

def apply_schema(connection):
 root=Path(__file__).resolve().parents[1]/"migrations"
 return connection.execute((root/"DRAFT_0003_vision_jobs.sql").read_text()+"\n"+(root/"DRAFT_0005_oidc_identity.sql").read_text())

def test_public_oidc_configuration_and_nonce_are_minimal_and_signed():
 svc=service(transport())
 config=svc.public_config()
 assert config["issuer"]==ISSUER and config["client_id"]==CLIENT_ID
 assert config["redirect_uri"]==REDIRECT_URI and config["pkce_required"] is True
 nonce=svc.create_nonce()
 assert len(nonce["nonce"])>=32 and nonce["expires_in"]==300
 claims=jwt.decode(nonce["nonce_token"],WORKER_SECRET,algorithms=["HS256"],
  issuer=BETA_ISSUER,audience="crc-oidc-nonce")
 assert claims["nonce"]==nonce["nonce"] and claims["sub"]=="oidc-nonce"
 assert "email" not in claims

def test_exchange_request_rejects_extra_fields_and_oversized_tokens():
 with pytest.raises(Exception):
  OIDCExchangeRequest.model_validate({"id_token":"x"*100,"nonce_token":"y"*100,"email":"player@example.test"})
 with pytest.raises(Exception):
  OIDCExchangeRequest.model_validate({"id_token":"x"*17000,"nonce_token":"y"*100})

@pytest.mark.asyncio
async def test_provider_outage_fails_closed_without_creating_account():
 svc=service(httpx.MockTransport(lambda request:httpx.Response(503)))
 nonce=svc.create_nonce()
 with pytest.raises(OIDCProviderUnavailable):
  await svc._verified_id_claims(id_token(nonce["nonce"]),nonce["nonce"])

@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_verified_oidc_exchange_creates_pseudonymous_account_and_one_time_mobile_token():
 svc=service(transport());pool=await asyncpg.create_pool(TEST_DSN,min_size=1,max_size=3)
 provider_sub="private-provider-subject-"+uuid4().hex
 try:
  async with pool.acquire() as c:
   await apply_schema(c)
   nonce=svc.create_nonce()
   token=id_token(nonce["nonce"],sub=provider_sub)
   result=await svc.exchange(c,token,nonce["nonce_token"])
   assert result["account_subject"].startswith("acct_")
   assert len(result["account_subject"])==37
   assert result["token_type"]=="Bearer" and result["expires_in"]==900
   mobile_secret=hmac.new(WORKER_SECRET,b"crc-mobile-session-v1",hashlib.sha256).digest()
   claims=jwt.decode(result["access_token"],mobile_secret,algorithms=["HS256"],
    issuer=BETA_ISSUER,audience=MOBILE_AUDIENCE)
   assert claims["sub"]==result["account_subject"] and claims["token_use"]=="mobile_access"
   account=await c.fetchrow("SELECT identity_key,status FROM auth_accounts WHERE account_subject=$1",result["account_subject"])
   assert account["status"]=="active" and len(account["identity_key"])==64
   assert await c.fetchval("SELECT count(*) FROM auth_identities WHERE account_subject=$1",result["account_subject"])==1
   vision_key=hmac.new(VISION_SECRET,result["account_subject"].encode(),hashlib.sha256).hexdigest()
   credit=await c.fetchrow("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",vision_key)
   assert credit["balance"]==0
   access=await c.fetchrow("SELECT enabled,granted_at,granted_by FROM vision_account_access WHERE account_subject=$1",result["account_subject"])
   assert access["enabled"] is False and access["granted_at"] is None and access["granted_by"] is None
   # Neither raw provider subject nor provider email is persisted.
   assert provider_sub not in json.dumps(dict(account))
   with pytest.raises(OIDCNonceReplay):
    await svc.exchange(c,token,nonce["nonce_token"])
 finally:
  await pool.close()

@pytest.mark.asyncio
async def test_nonce_mismatch_and_invalid_issuer_are_rejected():
 svc=service(transport())
 first=svc.create_nonce();second=svc.create_nonce()
 with pytest.raises(OIDCInvalidToken):
  await svc._verified_id_claims(id_token(first["nonce"]),second["nonce"])
 bad=id_token(first["nonce"],iss="https://evil.example")
 with pytest.raises(OIDCInvalidToken):
  await svc._verified_id_claims(bad,first["nonce"])
