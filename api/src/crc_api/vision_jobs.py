"""Fail-closed, PostgreSQL-backed vision upload queue and credit reservation.

Stores only sanitized, bounded JPEG samples. It does not run inference.
"""
from __future__ import annotations
import base64, binascii, hmac, json, re
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from typing import Any, Literal
import base64
from uuid import UUID, uuid4
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel, ConfigDict, Field, StrictBool, model_validator

MAX_FRAMES=8
MAX_FRAME_BYTES=256*1024
MAX_TOTAL_BYTES=2*1024*1024
MAX_SIDE=320
MAX_CAPTURE_MS=240_000
MAX_BASE64_FRAME_CHARS=((MAX_FRAME_BYTES+2)//3)*4
ACCOUNT_SUBJECT=re.compile(r"^acct_[a-f0-9]{32}$")
VISION_WORKER_SUBJECT="crc-vision-worker"

class VisionInputError(ValueError): pass
class VisionCreditsExhausted(Exception): pass
class VisionIdempotencyConflict(Exception): pass
class VisionJobNotFound(Exception): pass
class VisionJobStateConflict(Exception): pass

class VisionFrameInput(BaseModel):
    model_config=ConfigDict(extra="forbid",str_strip_whitespace=False)
    at_ms:int=Field(ge=0,lt=MAX_CAPTURE_MS)
    mime:Literal["image/jpeg"]
    width:int=Field(ge=1,le=MAX_SIDE)
    height:int=Field(ge=1,le=MAX_SIDE)
    data_base64:str=Field(min_length=4,max_length=MAX_BASE64_FRAME_CHARS)
    def sanitized(self)->dict[str,Any]:
        try: raw=base64.b64decode(self.data_base64,validate=True)
        except (binascii.Error,ValueError) as exc: raise VisionInputError("Invalid image encoding.") from exc
        if len(raw)<4 or len(raw)>MAX_FRAME_BYTES or raw[:2]!=b"\xff\xd8" or raw[-2:]!=b"\xff\xd9":
            raise VisionInputError("Image size or JPEG markers are invalid.")
        try:
            with Image.open(BytesIO(raw)) as image:
                if image.format!="JPEG" or image.size!=(self.width,self.height) or max(image.size)>MAX_SIDE:
                    raise VisionInputError("Image format or dimensions do not match.")
                image.verify()
            with Image.open(BytesIO(raw)) as image:
                image.load()
                clean=image.convert("RGB")
                output=BytesIO()
                clean.save(output,format="JPEG",quality=82,optimize=True)
                clean.close()
                normalized=output.getvalue()
        except VisionInputError: raise
        except (OSError,ValueError,UnidentifiedImageError,Image.DecompressionBombError) as exc:
            raise VisionInputError("Image could not be decoded safely.") from exc
        if len(normalized)<4 or len(normalized)>MAX_FRAME_BYTES or normalized[:2]!=b"\xff\xd8" or normalized[-2:]!=b"\xff\xd9":
            raise VisionInputError("Sanitized image size is invalid.")
        return {"at_ms":self.at_ms,"mime":"image/jpeg","width":self.width,"height":self.height,
                "image_bytes":normalized,"sha256":sha256(normalized).hexdigest()}

class VisionJobRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    client_request_id:UUID
    consent_to_upload:StrictBool
    consent_to_external_ai:StrictBool
    frames:list[VisionFrameInput]=Field(min_length=1,max_length=MAX_FRAMES)
    @model_validator(mode="after")
    def ordered_frames(self):
        times=[frame.at_ms for frame in self.frames]
        if any(b<=a for a,b in zip(times,times[1:])): raise ValueError("Frame timestamps must be strictly increasing.")
        if sum(len(frame.data_base64) for frame in self.frames)>MAX_TOTAL_BYTES*4//3+8192:
            raise ValueError("Encoded frame batch exceeds the upload limit.")
        return self
    def sanitized_frames(self)->list[dict[str,Any]]:
        if self.consent_to_upload is not True or self.consent_to_external_ai is not True:
            raise VisionInputError("Both upload and external AI consent are required.")
        frames=[frame.sanitized() for frame in self.frames]
        if sum(len(frame["image_bytes"]) for frame in frames)>MAX_TOTAL_BYTES:
            raise VisionInputError("Frame batch exceeds the total byte limit.")
        return frames



class VisionUnitObservation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    card_id:int=Field(ge=1,le=1_000_000_000)
    x:float=Field(ge=0,le=1)
    y:float=Field(ge=0,le=1)
    side:Literal["player","opponent","unknown"]

class VisionObservation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    screen:Literal["battle","other","unknown"]
    game_clock_s:int|None=Field(default=None,ge=0,le=300)
    elixir:int|None=Field(default=None,ge=0,le=10)
    hand:list[int]=Field(default_factory=list,max_length=4)
    units:list[VisionUnitObservation]=Field(default_factory=list,max_length=12)
    @model_validator(mode="after")
    def consistent_observation(self):
        if any(isinstance(x,bool) or x<1 or x>1_000_000_000 for x in self.hand) or len(set(self.hand))!=len(self.hand):
            raise ValueError("Invalid visible hand.")
        if self.screen!="battle" and (self.game_clock_s is not None or self.elixir is not None or self.hand or self.units):
            raise ValueError("Non-battle frames cannot contain battle observations.")
        return self

class VisionFrameObservation(BaseModel):
    model_config=ConfigDict(extra="forbid")
    at_ms:int=Field(ge=0,lt=MAX_CAPTURE_MS)
    status:Literal["unverified","invalid_output","provider_error"]
    observation:VisionObservation|None=None
    @model_validator(mode="after")
    def status_matches_observation(self):
        if (self.status=="unverified") != (self.observation is not None):
            raise ValueError("Observation status and payload do not match.")
        return self

class VisionWorkerResult(BaseModel):
    model_config=ConfigDict(extra="forbid")
    version:Literal["crc-vision-lab-v1"]
    model:Literal["@cf/google/gemma-4-26b-a4b-it"]
    replay_analyzed:Literal[False]
    selected:list[int]=Field(min_length=1,max_length=MAX_FRAMES)
    calls:int=Field(ge=1,le=MAX_FRAMES)
    results:list[VisionFrameObservation]=Field(min_length=1,max_length=MAX_FRAMES)
    @model_validator(mode="after")
    def bounded_result(self):
        if any(isinstance(t,bool) or t<0 or t>=MAX_CAPTURE_MS for t in self.selected):
            raise ValueError("Invalid selected frame times.")
        if any(b<=a for a,b in zip(self.selected,self.selected[1:])):
            raise ValueError("Selected frame times must be strictly increasing.")
        if self.calls!=len(self.results):
            raise ValueError("Model call count must match returned frame results.")
        times=[r.at_ms for r in self.results]
        if len(set(times))!=len(times) or any(t not in self.selected for t in times):
            raise ValueError("Result frames must be a unique subset of selected times.")
        return self


class VisionWorkerCompleteRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    job_id:UUID
    lease_token:UUID
    result:VisionWorkerResult

class VisionWorkerFailRequest(BaseModel):
    model_config=ConfigDict(extra="forbid")
    job_id:UUID
    lease_token:UUID
    error_code:Literal["VISION_PROVIDER_UNAVAILABLE","VISION_PROVIDER_REJECTED",
        "VISION_PROCESSOR_INTERRUPTED","VISION_CATALOG_UNAVAILABLE","VISION_INVALID_MODEL_RESPONSE"]

class PostgresVisionJobs:
    """Atomic one-credit reservation, idempotent enqueue and owner-scoped status."""
    def __init__(self,hmac_secret:bytes):
        if not isinstance(hmac_secret,bytes) or len(hmac_secret)<32: raise ValueError("Vision HMAC key must contain at least 32 bytes.")
        self._secret=hmac_secret
    def subject_key(self,verified_subject:str)->str:
        if not isinstance(verified_subject,str) or not ACCOUNT_SUBJECT.fullmatch(verified_subject):
            raise ValueError("A stable account identity is required.")
        return hmac.new(self._secret,("vision-account:"+verified_subject).encode(),"sha256").hexdigest()
    @staticmethod
    def _payload_hash(frames):
        digest=sha256(b"crc-vision-upload-v1\x00")
        for frame in frames:
            digest.update(frame["at_ms"].to_bytes(4,"big"))
            digest.update(frame["width"].to_bytes(2,"big"))
            digest.update(frame["height"].to_bytes(2,"big"))
            digest.update(bytes.fromhex(frame["sha256"]))
        return digest.hexdigest()
    @staticmethod
    def _public(row,reused=False):
        def stamp(value): return value.isoformat() if isinstance(value,datetime) else None
        result={"job_id":str(row["id"]),"status":row["status"],"frame_count":int(row["frame_count"]),
                "total_bytes":int(row["total_bytes"]),"created_at":stamp(row.get("created_at")),
                "updated_at":stamp(row.get("updated_at")),"expires_at":stamp(row.get("expires_at")),"reused":reused}
        raw=row.get("result_json")
        if raw is not None:
            if isinstance(raw,str):
                try: raw=json.loads(raw)
                except (TypeError,ValueError): raw=None
            if isinstance(raw,dict): result["result"]=raw
        if row.get("error_code"): result["error_code"]=row["error_code"]
        return result
    async def submit(self,connection:Any,verified_subject:str,payload:VisionJobRequest)->dict[str,Any]:
        if not isinstance(payload,VisionJobRequest): raise VisionInputError("Invalid vision job request.")
        frames=payload.sanitized_frames()
        total_bytes=sum(len(frame["image_bytes"]) for frame in frames)
        payload_hash=self._payload_hash(frames)
        subject_key=self.subject_key(verified_subject)
        async with connection.transaction():
            existing=await connection.fetchrow(
                """SELECT id,status,frame_count,total_bytes,payload_sha256,created_at,updated_at,expires_at,result_json,error_code
                   FROM vision_jobs WHERE subject_key=$1 AND client_request_id=$2""",subject_key,payload.client_request_id)
            if existing is not None:
                if existing["payload_sha256"]!=payload_hash: raise VisionIdempotencyConflict()
                return self._public(existing,True)
            account=await connection.fetchrow(
                "SELECT balance FROM vision_credit_accounts WHERE subject_key=$1 FOR UPDATE",subject_key)
            # The account row lock serializes submissions; recheck idempotency
            # before checking balance because a concurrent retry may have used
            # the last credit while this transaction waited.
            existing=await connection.fetchrow(
                """SELECT id,status,frame_count,total_bytes,payload_sha256,created_at,updated_at,expires_at,result_json,error_code
                   FROM vision_jobs WHERE subject_key=$1 AND client_request_id=$2""",subject_key,payload.client_request_id)
            if existing is not None:
                if existing["payload_sha256"]!=payload_hash: raise VisionIdempotencyConflict()
                return self._public(existing,True)
            if account is None or int(account["balance"])<1: raise VisionCreditsExhausted()
            job_id=uuid4()
            row=await connection.fetchrow(
                """INSERT INTO vision_jobs(id,subject_key,client_request_id,status,frame_count,total_bytes,payload_sha256)
                   VALUES($1,$2,$3,'queued',$4,$5,$6)
                   RETURNING id,status,frame_count,total_bytes,created_at,updated_at,expires_at,result_json,error_code""",
                job_id,subject_key,payload.client_request_id,len(frames),total_bytes,payload_hash)
            balance_after=await connection.fetchval(
                """UPDATE vision_credit_accounts SET balance=balance-1,updated_at=now()
                   WHERE subject_key=$1 AND balance>=1 RETURNING balance""",subject_key)
            if balance_after is None: raise VisionCreditsExhausted()
            await connection.execute(
                """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                   VALUES($1,$2,'reserve',-1,$3,$4)""",subject_key,job_id,int(balance_after),
                "reserve:"+str(payload.client_request_id))
            for index,frame in enumerate(frames):
                await connection.execute(
                    """INSERT INTO vision_job_frames(job_id,frame_index,at_ms,width,height,mime,sha256,image_bytes)
                       VALUES($1,$2,$3,$4,$5,'image/jpeg',$6,$7)""",job_id,index,frame["at_ms"],
                    frame["width"],frame["height"],frame["sha256"],frame["image_bytes"])
        return self._public(row)
    async def get(self,connection:Any,verified_subject:str,job_id:UUID)->dict[str,Any]|None:
        key=self.subject_key(verified_subject)
        row=await connection.fetchrow(
            """SELECT id,status,frame_count,total_bytes,created_at,updated_at,expires_at,result_json,error_code
               FROM vision_jobs WHERE id=$1 AND subject_key=$2""",job_id,key)
        return self._public(row) if row is not None else None
    async def cancel(self,connection:Any,verified_subject:str,job_id:UUID)->dict[str,Any]|None:
        key=self.subject_key(verified_subject)
        async with connection.transaction():
            row=await connection.fetchrow(
                """SELECT id,status,frame_count,total_bytes,created_at,updated_at,expires_at,result_json,error_code
                   FROM vision_jobs WHERE id=$1 AND subject_key=$2 FOR UPDATE""",job_id,key)
            if row is None: return None
            if row["status"]=="cancelled": return self._public(row)
            if row["status"]!="queued": raise VisionJobStateConflict()
            await connection.execute("DELETE FROM vision_job_frames WHERE job_id=$1",job_id)
            balance=await connection.fetchval(
                """UPDATE vision_credit_accounts SET balance=balance+1,updated_at=now()
                   WHERE subject_key=$1 RETURNING balance""",key)
            if balance is None: raise RuntimeError("Vision credit account is unavailable.")
            await connection.execute(
                """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                   VALUES($1,$2,'release',1,$3,$4) ON CONFLICT(subject_key,idempotency_key) DO NOTHING""",
                key,job_id,int(balance),"release:"+str(job_id))
            updated=await connection.fetchrow(
                """UPDATE vision_jobs SET status='cancelled',total_bytes=0,updated_at=now()
                   WHERE id=$1 RETURNING id,status,frame_count,total_bytes,created_at,updated_at,expires_at,result_json,error_code""",
                job_id)
        return self._public(updated)

    async def claim_next(self,connection:Any,*,lease_seconds:int=900)->dict[str,Any]|None:
        """Atomically lease one queued job; frame bytes are returned only to the private processor."""
        if isinstance(lease_seconds,bool) or not 60<=lease_seconds<=900:
            raise ValueError("Vision worker lease must be between 60 and 900 seconds.")
        async with connection.transaction():
            row=await connection.fetchrow(
                """SELECT id,subject_key,frame_count,total_bytes,expires_at
                   FROM vision_jobs
                   WHERE status='queued' AND expires_at>now()
                   ORDER BY created_at,id LIMIT 1
                   FOR UPDATE SKIP LOCKED"""
            )
            if row is None:return None
            lease=uuid4()
            updated=await connection.fetchrow(
                """UPDATE vision_jobs SET status='processing',attempt_count=attempt_count+1,
                   lease_token=$2,lease_expires_at=now()+($3 * interval '1 second'),
                   started_at=COALESCE(started_at,now()),updated_at=now()
                   WHERE id=$1 AND status='queued'
                   RETURNING id,frame_count,total_bytes,attempt_count,lease_expires_at""",
                row["id"],lease,lease_seconds)
            if updated is None:return None
            frames=await connection.fetch(
                """SELECT at_ms,width,height,mime,image_bytes FROM vision_job_frames
                   WHERE job_id=$1 ORDER BY frame_index""",row["id"])
            if len(frames)!=int(updated["frame_count"]):
                raise RuntimeError("Vision job frame set is incomplete.")
            return {
                "job_id":str(updated["id"]),"lease_token":str(lease),
                "attempt_count":int(updated["attempt_count"]),
                "frames":[{"at_ms":int(f["at_ms"]),"width":int(f["width"]),
                    "height":int(f["height"]),"mime":f["mime"],
                    "data_base64":base64.b64encode(bytes(f["image_bytes"])).decode("ascii")}
                    for f in frames],
            }

    async def complete(self,connection:Any,job_id:UUID,lease_token:UUID,
                       result:VisionWorkerResult)->dict[str,Any]:
        """Commit a validated evidence report and erase source images atomically."""
        if not isinstance(result,VisionWorkerResult):raise VisionInputError("Invalid worker result.")
        encoded=json.dumps(result.model_dump(mode="json"),separators=(",",":"),ensure_ascii=True)
        if len(encoded.encode("utf-8"))>48*1024:raise VisionInputError("Vision result is too large.")
        async with connection.transaction():
            row=await connection.fetchrow(
                """SELECT id,subject_key,status,frame_count,total_bytes,created_at,updated_at,expires_at
                   FROM vision_jobs WHERE id=$1 FOR UPDATE""",job_id)
            if row is None:raise VisionJobNotFound()
            if row["status"]!="processing":raise VisionJobStateConflict()
            lease=await connection.fetchval("SELECT lease_token FROM vision_jobs WHERE id=$1",job_id)
            if lease is None or str(lease)!=str(lease_token):raise VisionJobStateConflict()
            expected=await connection.fetch(
                "SELECT at_ms FROM vision_job_frames WHERE job_id=$1 ORDER BY frame_index",job_id)
            if [int(x["at_ms"]) for x in expected]!=result.selected:
                raise VisionInputError("Worker result does not match the claimed frames.")
            key=row["subject_key"]
            await connection.execute("DELETE FROM vision_job_frames WHERE job_id=$1",job_id)
            await connection.execute(
                """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                   SELECT $1,$2,'consume',0,balance,$3 FROM vision_credit_accounts WHERE subject_key=$1
                   ON CONFLICT(subject_key,idempotency_key) DO NOTHING""",
                key,job_id,"consume:"+str(job_id))
            updated=await connection.fetchrow(
                """UPDATE vision_jobs SET status='succeeded',result_json=$2::jsonb,total_bytes=0,
                   error_code=NULL,model_name=$3,lease_token=NULL,lease_expires_at=NULL,
                   completed_at=now(),updated_at=now()
                   WHERE id=$1 RETURNING id,status,frame_count,total_bytes,created_at,updated_at,
                   expires_at,result_json,error_code""",job_id,encoded,result.model)
        return self._public(updated)

    async def fail(self,connection:Any,job_id:UUID,lease_token:UUID,error_code:str)->dict[str,Any]:
        """Terminal, non-retrying failure: erase frames and release the reserved credit exactly once."""
        allowed={"VISION_PROVIDER_UNAVAILABLE","VISION_PROVIDER_REJECTED",
                 "VISION_PROCESSOR_INTERRUPTED","VISION_CATALOG_UNAVAILABLE",
                 "VISION_INVALID_MODEL_RESPONSE"}
        if error_code not in allowed:raise ValueError("Unsupported vision worker error code.")
        async with connection.transaction():
            row=await connection.fetchrow(
                """SELECT id,subject_key,status,frame_count,total_bytes,created_at,updated_at,expires_at
                   FROM vision_jobs WHERE id=$1 FOR UPDATE""",job_id)
            if row is None:raise VisionJobNotFound()
            if row["status"]=="failed":return self._public(row)
            if row["status"]!="processing":raise VisionJobStateConflict()
            lease=await connection.fetchval("SELECT lease_token FROM vision_jobs WHERE id=$1",job_id)
            if lease is None or str(lease)!=str(lease_token):raise VisionJobStateConflict()
            key=row["subject_key"]
            balance=await connection.fetchval(
                """UPDATE vision_credit_accounts SET balance=balance+1,updated_at=now()
                   WHERE subject_key=$1 RETURNING balance""",key)
            if balance is None:raise RuntimeError("Vision credit account is unavailable.")
            await connection.execute(
                """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                   VALUES($1,$2,'release',1,$3,$4) ON CONFLICT(subject_key,idempotency_key) DO NOTHING""",
                key,job_id,int(balance),"release:"+str(job_id))
            await connection.execute("DELETE FROM vision_job_frames WHERE job_id=$1",job_id)
            updated=await connection.fetchrow(
                """UPDATE vision_jobs SET status='failed',total_bytes=0,error_code=$2,
                   lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now()
                   WHERE id=$1 RETURNING id,status,frame_count,total_bytes,created_at,updated_at,
                   expires_at,result_json,error_code""",job_id,error_code)
        return self._public(updated)

    async def recover_stale(self,connection:Any,*,limit:int=20)->int:
        """Fail expired worker leases and refund credits; never replay a possibly billed inference."""
        if isinstance(limit,bool) or not 1<=limit<=100:raise ValueError("Invalid stale-job batch limit.")
        recovered=0
        async with connection.transaction():
            rows=await connection.fetch(
                """SELECT id,subject_key FROM vision_jobs
                   WHERE status='processing' AND lease_expires_at<=now()
                   ORDER BY lease_expires_at LIMIT $1 FOR UPDATE SKIP LOCKED""",limit)
            for row in rows:
                key=row["subject_key"]
                balance=await connection.fetchval(
                    """UPDATE vision_credit_accounts SET balance=balance+1,updated_at=now()
                       WHERE subject_key=$1 RETURNING balance""",key)
                if balance is None:raise RuntimeError("Vision credit account is unavailable.")
                await connection.execute(
                    """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                       VALUES($1,$2,'release',1,$3,$4) ON CONFLICT(subject_key,idempotency_key) DO NOTHING""",
                    key,row["id"],int(balance),"release:"+str(row["id"]))
                await connection.execute("DELETE FROM vision_job_frames WHERE job_id=$1",row["id"])
                await connection.execute(
                    """UPDATE vision_jobs SET status='failed',total_bytes=0,error_code='VISION_PROCESSOR_INTERRUPTED',
                       lease_token=NULL,lease_expires_at=NULL,completed_at=now(),updated_at=now() WHERE id=$1""",
                    row["id"])
                recovered+=1
        return recovered

    async def expire_due(self,connection:Any,*,limit:int=50)->int:
        """Delete expired report/image material and refund only still-reserved jobs."""
        if isinstance(limit,bool) or not 1<=limit<=200:raise ValueError("Invalid expiry batch limit.")
        expired=0
        async with connection.transaction():
            rows=await connection.fetch(
                """SELECT id,subject_key,status FROM vision_jobs
                   WHERE status<>'expired' AND expires_at<=now()
                   ORDER BY expires_at LIMIT $1 FOR UPDATE SKIP LOCKED""",limit)
            for row in rows:
                key=row["subject_key"]
                if row["status"] in ("queued","processing"):
                    balance=await connection.fetchval(
                        """UPDATE vision_credit_accounts SET balance=balance+1,updated_at=now()
                           WHERE subject_key=$1 RETURNING balance""",key)
                    if balance is None:raise RuntimeError("Vision credit account is unavailable.")
                    await connection.execute(
                        """INSERT INTO vision_credit_ledger(subject_key,job_id,event_type,delta,balance_after,idempotency_key)
                           VALUES($1,$2,'release',1,$3,$4) ON CONFLICT(subject_key,idempotency_key) DO NOTHING""",
                        key,row["id"],int(balance),"release:"+str(row["id"]))
                await connection.execute("DELETE FROM vision_job_frames WHERE job_id=$1",row["id"])
                await connection.execute(
                    """UPDATE vision_jobs SET status='expired',total_bytes=0,result_json=NULL,
                       lease_token=NULL,lease_expires_at=NULL,updated_at=now() WHERE id=$1""",row["id"])
                expired+=1
        return expired
