CREATE SCHEMA toolkit_rc_v3;

-- Stable ownership survives disconnect. No automatic identity transfers.
CREATE TABLE toolkit_rc_v3.identities (
  environment text NOT NULL CHECK (environment IN ('development','production')),
  account_id text NOT NULL CHECK (account_id ~ '^[1-9][0-9]{0,29}$'),
  extension_id text NOT NULL CHECK (extension_id ~ '^[1-9][0-9]{0,29}$'),
  user_id uuid NOT NULL REFERENCES toolkit_auth.users(id),
  PRIMARY KEY (environment, account_id, extension_id),
  UNIQUE (environment, account_id, extension_id, user_id)
);
CREATE TABLE toolkit_rc_v3.connections (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES toolkit_auth.users(id),
  environment text NOT NULL CHECK (environment IN ('development','production')),
  state text NOT NULL DEFAULT 'disconnected' CHECK (state IN ('disconnected','connecting','connected','refreshing','needs_reconnect','disconnecting')),
  generation bigint NOT NULL DEFAULT 0,
  account_id text,
  extension_id text,
  display_name varchar(160),
  token_envelope jsonb,
  access_expires_at timestamptz,
  refresh_expires_at timestamptz,
  scopes text[],
  refresh_claim uuid,
  refresh_deadline timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (environment, user_id),
  UNIQUE (id, user_id, environment),
  FOREIGN KEY (environment, account_id, extension_id, user_id) REFERENCES toolkit_rc_v3.identities(environment, account_id, extension_id, user_id),
  CHECK ((account_id IS NULL) = (extension_id IS NULL)),
  CHECK (state NOT IN ('connected','refreshing') OR (token_envelope IS NOT NULL AND account_id IS NOT NULL AND access_expires_at IS NOT NULL AND refresh_expires_at IS NOT NULL)),
  CHECK ((state = 'refreshing') = (refresh_claim IS NOT NULL AND refresh_deadline IS NOT NULL))
);
CREATE TABLE toolkit_rc_v3.oauth_transactions (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[a-f0-9]{64}$'),
  binding_hash char(64) NOT NULL CHECK (binding_hash ~ '^[a-f0-9]{64}$'),
  user_id uuid NOT NULL REFERENCES toolkit_auth.users(id),
  session_hash char(64) NOT NULL REFERENCES toolkit_auth.sessions(token_hash),
  connection_id uuid NOT NULL,
  environment text NOT NULL,
  generation bigint NOT NULL,
  verifier_envelope jsonb,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL DEFAULT now() + interval '10 minutes',
  consumed_at timestamptz,
  FOREIGN KEY (connection_id,user_id,environment) REFERENCES toolkit_rc_v3.connections(id,user_id,environment)
);
CREATE INDEX rc_oauth_expiration ON toolkit_rc_v3.oauth_transactions(expires_at);

-- Reserved infrastructure only: Phase 1 exposes no send/history endpoints.
CREATE TABLE toolkit_rc_v3.fax_attempts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  connection_id uuid NOT NULL,
  environment text NOT NULL,
  account_id text NOT NULL,
  extension_id text NOT NULL,
  idempotency_key uuid NOT NULL,
  request_hash char(64) NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
  state text NOT NULL CHECK (state IN ('prepared','submitting','accepted','unknown','sent','failed')),
  message_id text CHECK (message_id ~ '^[1-9][0-9]{0,29}$'),
  metadata_envelope jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  tracking_deadline timestamptz,
  UNIQUE (environment,user_id,idempotency_key),
  UNIQUE (environment,account_id,extension_id,message_id),
  FOREIGN KEY (connection_id,user_id,environment) REFERENCES toolkit_rc_v3.connections(id,user_id,environment),
  FOREIGN KEY (environment,account_id,extension_id,user_id) REFERENCES toolkit_rc_v3.identities(environment,account_id,extension_id,user_id)
);
CREATE INDEX rc_fax_history ON toolkit_rc_v3.fax_attempts(user_id,environment,created_at DESC);
