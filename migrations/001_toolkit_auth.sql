CREATE SCHEMA IF NOT EXISTS toolkit_auth;

CREATE TABLE toolkit_auth.users (
  id uuid PRIMARY KEY,
  entra_tenant_id uuid NOT NULL,
  entra_object_id uuid NOT NULL,
  display_name varchar(160) NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (entra_tenant_id, entra_object_id)
);

CREATE TABLE toolkit_auth.sessions (
  token_hash char(64) PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES toolkit_auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX sessions_user_id ON toolkit_auth.sessions(user_id);
CREATE INDEX sessions_expiration ON toolkit_auth.sessions(expires_at);

CREATE TABLE toolkit_auth.oauth_transactions (
  state_hash char(64) PRIMARY KEY CHECK (state_hash ~ '^[0-9a-f]{64}$'),
  provider varchar(40) NOT NULL,
  purpose varchar(40) NOT NULL,
  binding_hash char(64) NOT NULL CHECK (binding_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid REFERENCES toolkit_auth.users(id),
  session_hash char(64) REFERENCES toolkit_auth.sessions(token_hash),
  nonce_hash char(64) NOT NULL CHECK (nonce_hash ~ '^[0-9a-f]{64}$'),
  pkce_verifier text,
  redirect_uri text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  CHECK (expires_at > created_at),
  CHECK ((user_id IS NULL) = (session_hash IS NULL))
);
CREATE INDEX oauth_transactions_expiration ON toolkit_auth.oauth_transactions(expires_at);
