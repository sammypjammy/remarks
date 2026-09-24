-- Development Phase 2. Never run as part of an application build.
ALTER TABLE toolkit_rc_v3.fax_attempts
  ADD COLUMN connection_generation bigint,
  ADD COLUMN retry_of uuid,
  ADD COLUMN provider_status text CHECK(provider_status IN ('Queued','Processing','Sent','SendingFailed','Unknown')),
  ADD CONSTRAINT fax_attempt_owned_id UNIQUE(id,user_id,environment),
  ADD CONSTRAINT fax_retry_owner FOREIGN KEY(retry_of,user_id,environment)
    REFERENCES toolkit_rc_v3.fax_attempts(id,user_id,environment),
  ADD CONSTRAINT fax_single_retry UNIQUE(retry_of);
