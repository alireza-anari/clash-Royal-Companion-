"""Fail-closed, PostgreSQL-backed vision upload queue and credit reservation.

Stores only sanitized, bounded JPEG samples. It does not run inference.
"""
from __future__ import annotations
import base64, binascii, hmac, json, re
from datetime import datetime
from hashlib import sha256
from io import BytesIO
from typing import Any, Literal
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
    data_base64:str=Field(min_length=16,max_length=MAX_BASE64_FRAME_CHARS)
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
            if account is None or int(account["balance"])<1: raise VisionCreditsExhausted()
            # The account row lock serializes submissions; recheck idempotency after waiting.
            existing=await connection.fetchrow(
                """SELECT id,status,frame_count,total_bytes,payload_sha256,created_at,updated_at,expires_at,result_json,error_code
                   FROM vision_jobs WHERE subject_key=$1 AND client_request_id=$2""",subject_key,payload.client_request_id)
            if existing is not None:
                if existing["payload_sha256"]!=payload_hash: raise VisionIdempotencyConflict()
                return self._public(existing,True)
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
