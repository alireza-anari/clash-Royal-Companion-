from __future__ import annotations
import base64,time
import pytest
from io import BytesIO
from uuid import uuid4
import jwt
from fastapi.testclient import TestClient
from PIL import Image
from crc_api.beta_gateway import BetaConfig,create_beta_app,UnsafeBetaConfiguration
from crc_api.security.worker_assertion import WorkerAssertionVerifier
from crc_api.supercell import SupercellClient
HOST="vision.beta.comp.example";ISSUER="https://"+HOST;AUD="vision-test-audience"
SUBJECT="acct_"+"a"*32
WORKER=b"vision-gateway-worker-secret-123456789012345"
QUOTA=b"vision-gateway-quota-secret-123456789012"
VISION=b"vision-gateway-subject-secret-123456789"
class Pool:
 def acquire(self):return self
 async def __aenter__(self):return self
 async def __aexit__(self,*args):return None
 async def close(self):pass
class Quota:
 async def reserve(self,connection,subject):return {"member_count":1,"global_count":1}
class Vision:
 def __init__(self):self.calls=[]
 async def submit(self,connection,subject,payload):
  self.calls.append(("submit",subject,payload.client_request_id))
  return {"job_id":str(payload.client_request_id),"status":"queued","frame_count":len(payload.frames),
   "total_bytes":100,"created_at":None,"updated_at":None,"expires_at":None,"reused":False}
 async def get(self,connection,subject,job_id):
  self.calls.append(("get",subject,job_id))
  return {"job_id":str(job_id),"status":"queued","frame_count":1,"total_bytes":100,
   "created_at":None,"updated_at":None,"expires_at":None,"reused":False}
 async def cancel(self,connection,subject,job_id):
  self.calls.append(("cancel",subject,job_id))
  return {"job_id":str(job_id),"status":"cancelled","frame_count":1,"total_bytes":0,
   "created_at":None,"updated_at":None,"expires_at":None,"reused":False}
 async def recover_stale(self,connection,limit=20): return 0
 async def expire_due(self,connection,limit=50): return 0
 async def claim_next(self,connection,lease_seconds=900):
  self.calls.append(("claim",lease_seconds))
  return {"job_id":"123e4567-e89b-42d3-a456-426614174000",
   "lease_token":"123e4567-e89b-42d3-a456-426614174001","attempt_count":1,
   "frames":[{"at_ms":0,"mime":"image/jpeg","width":160,"height":240,"data_base64":"AA=="}]}
 async def complete(self,connection,job_id,lease_token,result):
  self.calls.append(("complete",job_id,lease_token,result.model))
  return {"job_id":str(job_id),"status":"succeeded","frame_count":1,"total_bytes":0,
   "created_at":None,"updated_at":None,"expires_at":None,"reused":False}
 async def fail(self,connection,job_id,lease_token,error_code):
  self.calls.append(("fail",job_id,lease_token,error_code))
  return {"job_id":str(job_id),"status":"failed","frame_count":1,"total_bytes":0,
   "created_at":None,"updated_at":None,"expires_at":None,"reused":False}
def config(**changes):
 from dataclasses import replace
 base=BetaConfig(hostname=HOST,auth_issuer=ISSUER,audience=AUD,allowed_subjects=frozenset({SUBJECT}),
  quota_hmac_secret=QUOTA,worker_assertion_secret=WORKER,
  database_dsn="postgresql://demo:local-test@postgres:5432/crc_test?sslmode=verify-full",
  vision_requested=True,vision_processor_ready=True,vision_worker_requested=False,vision_subjects=frozenset({SUBJECT}),vision_hmac_secret=VISION)
 return replace(base,**changes)
def token(subject=SUBJECT):
 now=int(time.time())
 return jwt.encode({"iss":ISSUER,"aud":AUD,"sub":subject,"iat":now,"exp":now+60,"jti":"vision-test-token-123456"},
  WORKER,algorithm="HS256")
def image_payload(upload=True,external=True):
 im=Image.new("RGB",(160,240),(100,120,180));s=BytesIO();im.save(s,format="JPEG");im.close()
 return {"client_request_id":str(uuid4()),"consent_to_upload":upload,"consent_to_external_ai":external,
  "frames":[{"at_ms":0,"mime":"image/jpeg","width":160,"height":240,"data_base64":base64.b64encode(s.getvalue()).decode()}]}
async def pool_factory(_):return Pool()
def app(settings=None,vision=None):
 cfg=settings or config()
 return create_beta_app(config=cfg,
  verifier=WorkerAssertionVerifier(ISSUER,AUD,cfg.allowed_subjects | (frozenset({"crc-vision-worker"}) if cfg.vision_worker_requested else frozenset()),WORKER),quota=Quota(),
  supercell=SupercellClient(token=""),pool_factory=pool_factory,vision_jobs=vision or Vision())
def test_vision_capability_and_fail_closed_gate():
 with TestClient(app(config(vision_requested=False)),base_url='https://'+HOST) as c:
  r=c.get("/api/v1/vision/capabilities",headers={"X-CRC-Worker-Assertion":token()})
  assert r.status_code==200 and r.json()["enabled"] is False
 with TestClient(app(config()),base_url='https://'+HOST) as c:
  r=c.get("/api/v1/vision/capabilities",headers={"X-CRC-Worker-Assertion":token()})
  assert r.status_code==200 and r.json()["enabled"] is True and r.json()["max_frames"]==8
 for settings in [config(vision_processor_ready=False),config(vision_subjects=frozenset())]:
  with TestClient(app(settings),base_url='https://'+HOST) as c:
   r=c.post("/api/v1/vision/jobs",headers={"X-CRC-Worker-Assertion":token()},json=image_payload())
   assert r.status_code==503 and r.json()["error"]["code"]=="VISION_ANALYSIS_DISABLED"
 other="acct_"+"b"*32
 cfg=config(allowed_subjects=frozenset({SUBJECT,other}))
 with TestClient(app(cfg),base_url='https://'+HOST) as c:
  r=c.get("/api/v1/vision/capabilities",headers={"X-CRC-Worker-Assertion":token(other)})
  assert r.status_code==200 and r.json()["enabled"] is False
  assert r.json()["reason"]=="VISION_ACCOUNT_NOT_ELIGIBLE"
def test_upload_requires_both_consents_and_returns_only_job_metadata():
 vision=Vision()
 with TestClient(app(vision=vision),base_url='https://'+HOST) as c:
  h={"X-CRC-Worker-Assertion":token()}
  denied=c.post("/api/v1/vision/jobs",headers=h,json=image_payload(external=False))
  assert denied.status_code==403 and not vision.calls
  r=c.post("/api/v1/vision/jobs",headers=h,json=image_payload())
  assert r.status_code==202 and r.json()["status"]=="queued"
  assert "data_base64" not in r.text and SUBJECT not in r.text
  assert vision.calls[0][0:2]==("submit",SUBJECT)
def test_status_and_cancel_are_account_scoped():
 vision=Vision()
 with TestClient(app(vision=vision),base_url='https://'+HOST) as c:
  h={"X-CRC-Worker-Assertion":token()};job=uuid4()
  assert c.get(f"/api/v1/vision/jobs/{job}",headers=h).status_code==200
  assert c.delete(f"/api/v1/vision/jobs/{job}",headers=h).status_code==200
  assert [x[0] for x in vision.calls]==["get","cancel"]


def test_worker_claim_routes_are_separate_from_user_and_vision_routes():
 vision=Vision();settings=config(vision_worker_requested=True)
 with TestClient(app(settings,vision=vision),base_url='https://'+HOST) as c:
  worker={"X-CRC-Worker-Assertion":token("crc-vision-worker")}
  account={"X-CRC-Worker-Assertion":token()}
  denied=c.post("/api/v1/vision/worker/claim",headers=account,json={})
  assert denied.status_code==403
  claim=c.post("/api/v1/vision/worker/claim",headers=worker,json={})
  assert claim.status_code==200
  assert claim.json()["job"]["attempt_count"]==1
  assert vision.calls[0]==("claim",900)
  # A valid worker assertion is not a general-purpose API identity.
  denied=c.get("/api/v1/vision/capabilities",headers=worker)
  assert denied.status_code==403
  complete=c.post("/api/v1/vision/worker/complete",headers=worker,json={
   "job_id":"123e4567-e89b-42d3-a456-426614174000",
   "lease_token":"123e4567-e89b-42d3-a456-426614174001",
   "result":{"version":"crc-vision-lab-v1","model":"@cf/google/gemma-4-26b-a4b-it",
    "replay_analyzed":False,"selected":[0],"calls":1,
    "results":[{"at_ms":0,"status":"unverified","observation":{
     "screen":"battle","game_clock_s":120,"elixir":5,"hand":[1],"units":[]}}]}})
  assert complete.status_code==200 and complete.json()["status"]=="succeeded"
  bad=c.post("/api/v1/vision/worker/fail",headers=account,json={
   "job_id":"123e4567-e89b-42d3-a456-426614174000",
   "lease_token":"123e4567-e89b-42d3-a456-426614174001",
   "error_code":"VISION_PROVIDER_UNAVAILABLE"})
  assert bad.status_code==403

def test_worker_subject_cannot_be_enabled_without_vision_processor_readiness():
 with pytest.raises(UnsafeBetaConfiguration):
  config(vision_worker_requested=True,vision_processor_ready=False).validate()
