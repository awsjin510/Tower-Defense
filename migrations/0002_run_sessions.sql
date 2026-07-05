CREATE TABLE IF NOT EXISTS run_sessions (
  run_id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  completed_at INTEGER
);

CREATE INDEX IF NOT EXISTS run_sessions_user_idx
  ON run_sessions (user_id, started_at DESC);
