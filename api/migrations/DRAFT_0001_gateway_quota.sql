-- SP-BETA-01: sample shared quota table, NOT deployed to a live database.
-- Run only on an owner-approved PostgreSQL instance after retention review.
-- Does not contain player tags, emails, JWTs, API keys, or raw Access subjects.
CREATE TABLE IF NOT EXISTS gateway_quota_windows (
    scope TEXT NOT NULL CHECK (scope IN ('member', 'global')),
    subject_key CHAR(64) NOT NULL,
    bucket_start BIGINT NOT NULL,
    used INTEGER NOT NULL CHECK (used >= 1),
    PRIMARY KEY (scope, subject_key, bucket_start)
);

-- Optional MANUAL cleanup example: retention after a few hours.
-- A background cleanup job is NOT installed or running.
-- DELETE FROM gateway_quota_windows
-- WHERE bucket_start < floor(extract(epoch FROM clock_timestamp()) / 60)::bigint - 180;
