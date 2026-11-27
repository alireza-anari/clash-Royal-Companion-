-- Stage 15 draft only. No production migration is applied by CI or deployment.
-- Bounded MVP storage: sanitized JPEG samples as BYTEA, maximum 2 MiB per job.
CREATE TABLE IF NOT EXISTS vision_credit_accounts (
  subject_key CHAR(64) PRIMARY KEY,
  balance INTEGER NOT NULL DEFAULT 0 CHECK(balance>=0 AND balance<=100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS vision_jobs (
  id UUID PRIMARY KEY,
  subject_key CHAR(64) NOT NULL REFERENCES vision_credit_accounts(subject_key),
  client_request_id UUID NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('queued','processing','succeeded','failed','cancelled','expired')),
  frame_count SMALLINT NOT NULL CHECK(frame_count BETWEEN 1 AND 8),
  total_bytes INTEGER NOT NULL CHECK(total_bytes BETWEEN 0 AND 2097152),
  payload_sha256 CHAR(64) NOT NULL,
  result_json JSONB,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT(now()+interval '24 hours'),
  UNIQUE(subject_key,client_request_id),
  UNIQUE(id,subject_key)
);
CREATE INDEX IF NOT EXISTS vision_jobs_queue_idx ON vision_jobs(status,created_at) WHERE status='queued';
CREATE INDEX IF NOT EXISTS vision_jobs_expiry_idx ON vision_jobs(expires_at);
CREATE TABLE IF NOT EXISTS vision_job_frames (
  job_id UUID NOT NULL REFERENCES vision_jobs(id) ON DELETE CASCADE,
  frame_index SMALLINT NOT NULL CHECK(frame_index BETWEEN 0 AND 7),
  at_ms INTEGER NOT NULL CHECK(at_ms BETWEEN 0 AND 239999),
  width SMALLINT NOT NULL CHECK(width BETWEEN 1 AND 320),
  height SMALLINT NOT NULL CHECK(height BETWEEN 1 AND 320),
  mime TEXT NOT NULL CHECK(mime='image/jpeg'),
  sha256 CHAR(64) NOT NULL,
  image_bytes BYTEA NOT NULL CHECK(octet_length(image_bytes) BETWEEN 4 AND 262144),
  PRIMARY KEY(job_id,frame_index),
  UNIQUE(job_id,at_ms)
);
CREATE TABLE IF NOT EXISTS vision_credit_ledger (
  id BIGSERIAL PRIMARY KEY,
  subject_key CHAR(64) NOT NULL REFERENCES vision_credit_accounts(subject_key),
  job_id UUID REFERENCES vision_jobs(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL CHECK(event_type IN ('grant','reserve','release','consume')),
  delta INTEGER NOT NULL CHECK(
    (event_type='grant' AND delta>0) OR (event_type='reserve' AND delta=-1) OR
    (event_type='release' AND delta=1) OR (event_type='consume' AND delta=0)),
  balance_after INTEGER NOT NULL CHECK(balance_after>=0),
  idempotency_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(subject_key,idempotency_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS vision_credit_job_event_idx
  ON vision_credit_ledger(job_id,event_type) WHERE job_id IS NOT NULL;
-- Credit grants require owner-only DB access; no public grant endpoint exists.
-- Images have a 24h expiry timestamp, but no cleanup scheduler is installed in this stage.
