CREATE TABLE IF NOT EXISTS player_saves (
  user_id TEXT PRIMARY KEY NOT NULL,
  save_version INTEGER NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  save_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS leaderboard (
  season_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  player_name TEXT NOT NULL DEFAULT 'Anonymous',
  best_wave INTEGER NOT NULL DEFAULT 0,
  total_runs INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (season_id, user_id)
);

CREATE INDEX IF NOT EXISTS leaderboard_rank_idx
  ON leaderboard (season_id, best_wave DESC, updated_at ASC);
