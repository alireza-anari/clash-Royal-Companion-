from __future__ import annotations
import asyncio,base64,os
from io import BytesIO
from pathlib import Path
from uuid import uuid4,UUID
import asyncpg,pytest
from PIL import Image
from pydantic import ValidationError
from crc_api.vision_jobs import (PostgresVisionJobs,VisionJobRequest,VisionInputError,VisionCreditsExhausted,VisionIdempotencyConflict,ACCOUNT_SUBJECT,VisionWorkerResult,VisionJobStateConflict)
SECRET=b"vision-tests-only-hmac-key-123456789012345"
TEST_DSN=os.environ.get("CRC_TEST_POSTGRES_DSN")
def account(): return "acct_"+uuid4().hex
def jpeg(w=160,h=240):
 im=Image.new("RGB",(w,h),(90,120,180));s=BytesIO();im.save(s,format="JPEG",quality=80);im.close();return s.getvalue()
def frame(at_ms,raw=None):
 raw=raw or jpeg()
 try:
  with Image.open(BytesIO(raw)) as im: w,h=im.size
 except Exception:
  w,h=160,240
 return {"at_ms":at_ms,"mime":"image/jpeg","width":w,"height":h,"data_base64":base64.b64encode(raw).decode("ascii")}
def payload(request_id=None,upload=True,external=True,frames=None):
 return VisionJobRequest.model_validate({"client_request_id":str(request_id or uuid4()),"consent_to_upload":upload,
  "consent_to_external_ai":external,"frames":frames or [frame(0)]})
def test_identity_and_request_contract_are_strict():
 svc=PostgresVisionJobs(SECRET);subject=account()
 assert ACCOUNT_SUBJECT.fullmatch(subject) and len(svc.subject_key(subject))==64 and subject not in svc.subject_key(subject)
 for bad in ["#ABC123","shared-beta-subject","acct_not-hex","",None]:
  with pytest.raises(ValueError): svc.subject_key(bad)
 with pytest.raises(ValidationError): payload(frames=[frame(0),frame(0)])
 with pytest.raises(ValidationError):
  VisionJobRequest.model_validate({"client_request_id":str(uuid4()),"consent_to_upload":True,
   "consent_to_external_ai":True,"frames":[frame(0)],"player_tag":"#SECRET"})
 with pytest.raises(ValidationError):
  VisionJobRequest.model_validate({"client_request_id":str(uuid4()),"consent_to_upload":"true",
   "consent_to_external_ai":True,"frames":[frame(0)]})
def test_images_are_decoded_reencoded_and_spoofed_jpegs_rejected():
 req=payload();clean=req.sanitized_frames()[0]
 assert clean["image_bytes"][:2]==b"\xff\xd8" and clean["image_bytes"][-2:]==b"\xff\xd9"
 assert clean["width"]==160 and clean["height"]==240 and clean["sha256"]
 for bad in [b"not a jpeg",b"\xff\xd8fake\xff\xd9",jpeg()[:-2]+b"xx"]:
  with pytest.raises(VisionInputError): payload(frames=[frame(0,bad)]).sanitized_frames()
def test_both_consents_are_required():
 for a,b in [(False,True),(True,False),(False,False)]:
  with pytest.raises(VisionInputError): payload(upload=a,external=b).sanitized_frames()
def test_frame_count_time_order_and_format_bounds():
 with pytest.raises(ValidationError): payload(frames=[frame(i*1000) for i in range(9)])
 with pytest.raises(ValidationError): payload(frames=[frame(0),frame(0)])
 with pytest.raises(ValidationError):
  VisionJobRequest.model_validate({"client_request_id":str(uuid4()),"consent_to_upload":True,
   "consent_to_external_ai":True,"frames":[{"at_ms":0,"mime":"image/png","width":160,"height":240,
   "data_base64":base64.b64encode(jpeg()).decode()}]})
@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_reservation_idempotency_scope_and_cancel_release():
 svc=PostgresVisionJobs(SECRET);owners=[account(),account()];pool=await asyncpg.create_pool(TEST_DSN,min_size=1,max_size=4)
 try:
  schema=Path(__file__).resolve().parents[1]/"migrations"/"DRAFT_0003_vision_jobs.sql"
  async with pool.acquire() as c:
   await c.execute(schema.read_text())
   for owner in owners:
    key=svc.subject_key(owner)
    await c.execute("DELETE FROM vision_credit_ledger WHERE subject_key=$1",key)
    await c.execute("DELETE FROM vision_jobs WHERE subject_key=$1",key)
    await c.execute("DELETE FROM vision_credit_accounts WHERE subject_key=$1",key)
    await c.execute("INSERT INTO vision_credit_accounts(subject_key,balance) VALUES($1,2)",key)
  req=payload()
  async with pool.acquire() as c:
   first=await svc.submit(c,owners[0],req);again=await svc.submit(c,owners[0],req)
   assert first["job_id"]==again["job_id"] and again["reused"] is True
   with pytest.raises(VisionIdempotencyConflict):
    await svc.submit(c,owners[0],payload(request_id=req.client_request_id,frames=[frame(0,jpeg(120,180))]))
   job_id=UUID(first["job_id"])
   assert await svc.get(c,owners[1],job_id) is None
   assert (await svc.get(c,owners[0],job_id))["status"]=="queued"
   cancelled=await svc.cancel(c,owners[0],job_id)
   assert cancelled["status"]=="cancelled"
   assert (await svc.cancel(c,owners[0],job_id))["status"]=="cancelled"
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",svc.subject_key(owners[0]))==2
   assert await c.fetchval("SELECT count(*) FROM vision_job_frames WHERE job_id=$1",job_id)==0
   ledger=await c.fetch("SELECT event_type,delta FROM vision_credit_ledger WHERE subject_key=$1 ORDER BY id",svc.subject_key(owners[0]))
   assert [(x["event_type"],x["delta"]) for x in ledger]==[("reserve",-1),("release",1)]
 finally: await pool.close()
@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_parallel_duplicate_request_is_charged_once_and_zero_credit_fails():
 svc=PostgresVisionJobs(SECRET);owner=account();pool=await asyncpg.create_pool(TEST_DSN,min_size=2,max_size=6)
 try:
  async with pool.acquire() as c:
   await c.execute((Path(__file__).resolve().parents[1]/"migrations"/"DRAFT_0003_vision_jobs.sql").read_text())
   key=svc.subject_key(owner)
   await c.execute("DELETE FROM vision_credit_ledger WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_jobs WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_credit_accounts WHERE subject_key=$1",key)
   await c.execute("INSERT INTO vision_credit_accounts(subject_key,balance) VALUES($1,1)",key)
  req=payload()
  async def submit():
   async with pool.acquire() as c:return await svc.submit(c,owner,req)
  a,b=await asyncio.gather(submit(),submit())
  assert a["job_id"]==b["job_id"]
  async with pool.acquire() as c:
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",key)==0
   assert await c.fetchval("SELECT count(*) FROM vision_credit_ledger WHERE subject_key=$1",key)==1
  with pytest.raises(VisionCreditsExhausted):
   async with pool.acquire() as c: await svc.submit(c,owner,payload())
 finally: await pool.close()


def worker_result(times=(0,)):
 return VisionWorkerResult.model_validate({
  "version":"crc-vision-lab-v1","model":"@cf/google/gemma-4-26b-a4b-it",
  "replay_analyzed":False,"selected":list(times),"calls":len(times),
  "results":[{"at_ms":at,"status":"unverified","observation":{
   "screen":"battle","game_clock_s":120,"elixir":5,"hand":[1],
   "units":[{"card_id":2,"x":0.4,"y":0.5,"side":"opponent"}]}} for at in times]})
def apply_worker_schema(connection):
 schema_dir=Path(__file__).resolve().parents[1]/"migrations"
 return connection.execute((schema_dir/"DRAFT_0003_vision_jobs.sql").read_text()+"\n"+(schema_dir/"DRAFT_0004_vision_worker.sql").read_text())

def test_worker_result_schema_is_bounded_and_never_claims_replay_analysis():
 valid=worker_result((0,2000))
 assert valid.replay_analyzed is False and valid.calls==2
 with pytest.raises(ValidationError):
  VisionWorkerResult.model_validate({**valid.model_dump(),"replay_analyzed":True})
 with pytest.raises(ValidationError):
  VisionWorkerResult.model_validate({**valid.model_dump(),"calls":9})
 with pytest.raises(ValidationError):
  VisionWorkerResult.model_validate({**valid.model_dump(),"results":[{**valid.results[0].model_dump(),"at_ms":9999}]})
 with pytest.raises(ValidationError):
  VisionWorkerResult.model_validate({**valid.model_dump(),"results":[{**valid.results[0].model_dump(),"observation":{"screen":"other","game_clock_s":120,"elixir":5,"hand":[1],"units":[]}}]})

@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_worker_claim_complete_erases_images_and_consumes_one_reserved_credit():
 svc=PostgresVisionJobs(SECRET);owner=account();pool=await asyncpg.create_pool(TEST_DSN,min_size=1,max_size=4)
 try:
  async with pool.acquire() as c:
   await apply_worker_schema(c)
   key=svc.subject_key(owner)
   await c.execute("DELETE FROM vision_credit_ledger WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_jobs WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_credit_accounts WHERE subject_key=$1",key)
   await c.execute("INSERT INTO vision_credit_accounts(subject_key,balance) VALUES($1,2)",key)
   request=payload(frames=[frame(0),frame(2000)])
   submitted=await svc.submit(c,owner,request)
   claim=await svc.claim_next(c)
   assert claim["job_id"]==submitted["job_id"] and len(claim["frames"])==2
   assert claim["attempt_count"]==1 and claim["lease_token"]
   with pytest.raises(VisionJobStateConflict):
    await svc.claim_next(c)
   completed=await svc.complete(c,UUID(claim["job_id"]),UUID(claim["lease_token"]),worker_result((0,2000)))
   assert completed["status"]=="succeeded" and completed["total_bytes"]==0
   assert completed["result"]["replay_analyzed"] is False
   assert await c.fetchval("SELECT count(*) FROM vision_job_frames WHERE job_id=$1",UUID(claim["job_id"]))==0
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",key)==1
   events=await c.fetch("SELECT event_type,delta FROM vision_credit_ledger WHERE subject_key=$1 ORDER BY id",key)
   assert [(x["event_type"],x["delta"]) for x in events]==[("reserve",-1),("consume",0)]
   with pytest.raises(VisionJobStateConflict):
    await svc.complete(c,UUID(claim["job_id"]),UUID(claim["lease_token"]),worker_result((0,2000)))
 finally: await pool.close()

@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_worker_failure_and_stale_lease_refund_once_without_replaying_provider_calls():
 svc=PostgresVisionJobs(SECRET);owner=account();pool=await asyncpg.create_pool(TEST_DSN,min_size=1,max_size=4)
 try:
  async with pool.acquire() as c:
   await apply_worker_schema(c)
   key=svc.subject_key(owner)
   await c.execute("DELETE FROM vision_credit_ledger WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_jobs WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_credit_accounts WHERE subject_key=$1",key)
   await c.execute("INSERT INTO vision_credit_accounts(subject_key,balance) VALUES($1,2)",key)
   first=await svc.submit(c,owner,payload())
   claim=await svc.claim_next(c)
   failed=await svc.fail(c,UUID(claim["job_id"]),UUID(claim["lease_token"]),"VISION_PROVIDER_UNAVAILABLE")
   assert failed["status"]=="failed"
   assert (await svc.fail(c,UUID(claim["job_id"]),UUID(claim["lease_token"]),"VISION_PROVIDER_UNAVAILABLE"))["status"]=="failed"
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",key)==2
   assert await c.fetchval("SELECT count(*) FROM vision_credit_ledger WHERE subject_key=$1",key)==2
   second=await svc.submit(c,owner,payload())
   stale=await svc.claim_next(c)
   await c.execute("UPDATE vision_jobs SET lease_expires_at=now()-interval '1 second' WHERE id=$1",UUID(stale["job_id"]))
   assert await svc.recover_stale(c)==1
   recovered=await svc.get(c,owner,UUID(stale["job_id"]))
   assert recovered["status"]=="failed" and recovered["error_code"]=="VISION_PROCESSOR_INTERRUPTED"
   assert await svc.recover_stale(c)==0
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",key)==2
   assert await c.fetchval("SELECT count(*) FROM vision_job_frames WHERE job_id=$1",UUID(stale["job_id"]))==0
 finally: await pool.close()

@pytest.mark.skipif(not TEST_DSN,reason="Disposable PostgreSQL CI database required.")
@pytest.mark.asyncio
async def test_expiry_erases_successful_report_but_does_not_refund_consumed_credit():
 svc=PostgresVisionJobs(SECRET);owner=account();pool=await asyncpg.create_pool(TEST_DSN,min_size=1,max_size=4)
 try:
  async with pool.acquire() as c:
   await apply_worker_schema(c)
   key=svc.subject_key(owner)
   await c.execute("DELETE FROM vision_credit_ledger WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_jobs WHERE subject_key=$1",key)
   await c.execute("DELETE FROM vision_credit_accounts WHERE subject_key=$1",key)
   await c.execute("INSERT INTO vision_credit_accounts(subject_key,balance) VALUES($1,2)",key)
   submitted=await svc.submit(c,owner,payload())
   claim=await svc.claim_next(c)
   await svc.complete(c,UUID(claim["job_id"]),UUID(claim["lease_token"]),worker_result())
   await c.execute("UPDATE vision_jobs SET expires_at=now()-interval '1 second' WHERE id=$1",UUID(submitted["job_id"]))
   assert await svc.expire_due(c)==1
   expired=await svc.get(c,owner,UUID(submitted["job_id"]))
   assert expired["status"]=="expired" and "result" not in expired
   assert await c.fetchval("SELECT balance FROM vision_credit_accounts WHERE subject_key=$1",key)==1
 finally: await pool.close()
