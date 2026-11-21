-- Private beta optional AI budget. REVIEW and manually apply before enabling AI.
-- Keep independent of gateway_quota_windows (60-second windows).
CREATE TABLE IF NOT EXISTS ai_daily_quota_windows (
  scope TEXT NOT NULL CHECK (scope IN ('member', 'global')),
  subject_key CHAR(64) NOT NULL,
  day_number BIGINT NOT NULL,
  used INTEGER NOT NULL CHECK (used >= 1),
  PRIMARY KEY (scope, subject_key, day_number)
);

-- Manual retention cleanup example; never use without owner review:
-- DELETE FROM ai_daily_quota_windows
-- WHERE day_number < floor(extract(epoch FROM clock_timestamp()) / 86400)::bigint - 7;
