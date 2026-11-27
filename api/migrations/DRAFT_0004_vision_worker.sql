-- Stage 16 draft only. Do not apply to production until the worker and retention review pass.
-- A single short lease prevents concurrent inference for the same job. Expired
-- leases are failed/refunded rather than replayed because provider billing may
-- have occurred before a worker crash.
ALTER TABLE vision_jobs
  ADD COLUMN IF NOT EXISTS attempt_count SMALLINT NOT NULL DEFAULT 0
    CHECK (attempt_count BETWEEN 0 AND 1),
  ADD COLUMN IF NOT EXISTS lease_token UUID,
  ADD COLUMN IF NOT EXISTS lease_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS completed_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS model_name TEXT;

CREATE INDEX IF NOT EXISTS vision_jobs_worker_claim_idx
  ON vision_jobs(status,created_at,id);

CREATE INDEX IF NOT EXISTS vision_jobs_worker_lease_idx
  ON vision_jobs(lease_expires_at)
  WHERE status='processing';

-- The worker receives only short-lived claims. It never has direct DB credentials.
-- Source JPEG bytes are erased atomically when a job succeeds, fails, is cancelled,
-- or expires. The public report contains observations only and replay_analyzed=false.
