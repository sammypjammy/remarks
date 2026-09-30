CREATE TABLE toolkit_auth.user_preferences (
  user_id uuid PRIMARY KEY REFERENCES toolkit_auth.users(id) ON DELETE CASCADE,
  preferences jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(preferences) = 'object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);
