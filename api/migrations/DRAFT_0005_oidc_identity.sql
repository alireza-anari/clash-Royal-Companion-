-- Stage 16 draft only. Contains opaque HMAC-derived identifiers, never provider email or raw subject.
CREATE TABLE IF NOT EXISTS auth_accounts (
  account_subject CHAR(37) PRIMARY KEY
    CHECK(account_subject ~ '^acct_[0-9a-f]{32}$'),
  identity_key CHAR(64) NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_login_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS auth_identities (
  provider_key CHAR(64) PRIMARY KEY,
  account_subject CHAR(37) NOT NULL REFERENCES auth_accounts(account_subject) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS auth_oidc_nonce_uses (
  jti CHAR(32) PRIMARY KEY,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS auth_oidc_nonce_expiry_idx
  ON auth_oidc_nonce_uses(expires_at);

-- No email, display name, provider subject, refresh token or ID token is stored.
-- Vision credits are provisioned separately through a reviewed owner-only path.


CREATE TABLE IF NOT EXISTS vision_account_access (
  account_subject CHAR(37) PRIMARY KEY
    REFERENCES auth_accounts(account_subject) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  granted_at TIMESTAMPTZ,
  granted_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK ((enabled AND granted_at IS NOT NULL AND granted_by IS NOT NULL)
      OR (NOT enabled AND granted_at IS NULL AND granted_by IS NULL))
);
