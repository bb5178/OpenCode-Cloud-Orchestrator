-- Migration: Advanced features — event log, job results, job lifecycle

-- Event log for full observability
CREATE TABLE IF NOT EXISTS event_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  task_id TEXT,
  event_type TEXT NOT NULL,  -- job_created | job_started | job_paused | job_resumed | job_stopped | job_completed | job_failed | job_deleted | task_queued | task_claimed | task_running | task_completed | task_failed | task_stalled | task_retried | task_timeout | watchdog_check
  message TEXT,
  actor TEXT,                -- client ID or 'system' or 'watchdog'
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX IF NOT EXISTS idx_event_log_job ON event_log(job_id);
CREATE INDEX IF NOT EXISTS idx_event_log_task ON event_log(task_id);
CREATE INDEX IF NOT EXISTS idx_event_log_time ON event_log(created_at);

-- Job results storage
CREATE TABLE IF NOT EXISTS job_results (
  job_id TEXT PRIMARY KEY REFERENCES jobs(id),
  result TEXT NOT NULL,          -- final aggregated result
  created_at INTEGER NOT NULL DEFAULT (unixepoch())
);

-- Add started_at and error to existing tables
ALTER TABLE jobs ADD COLUMN started_at INTEGER;
ALTER TABLE tasks ADD COLUMN error TEXT;
