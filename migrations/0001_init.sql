-- OCO schema: jobs and tasks

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  original_prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'planning',  -- planning | running | completed | failed
  rollup_strategy TEXT NOT NULL DEFAULT 'summary',
  rollup_instruction TEXT,
  workflow_instance_id TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
  completed_at INTEGER
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  job_id TEXT NOT NULL REFERENCES jobs(id),
  prompt TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',  -- pending | queued | claimed | running | completed | failed | stalled
  wave INTEGER NOT NULL DEFAULT 0,
  dependencies TEXT NOT NULL DEFAULT '[]',  -- JSON array of task IDs
  claimed_by TEXT,
  claimed_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  result TEXT,
  progress TEXT,
  context TEXT NOT NULL DEFAULT '{}',  -- JSON: outputs from dependency tasks
  retry_count INTEGER NOT NULL DEFAULT 0,
  max_retries INTEGER NOT NULL DEFAULT 2,
  timeout_seconds INTEGER NOT NULL DEFAULT 14400,  -- 4 hours default
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_tasks_job_id ON tasks(job_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_wave ON tasks(job_id, wave);
