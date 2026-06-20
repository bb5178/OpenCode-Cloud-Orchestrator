// ============================================================
// D1 database helpers — CRUD for jobs and tasks
// ============================================================

import type { Job, Task, TaskDefinition, TaskStatus } from "./types";

// ----- Jobs -----

export async function createJob(
  db: D1Database,
  id: string,
  originalPrompt: string,
  rollupStrategy: string,
  rollupInstruction: string | null,
  workflowInstanceId: string,
  model: string = "anthropic/claude-opus-4-6",
  status: string = "running"
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO jobs (id, original_prompt, status, rollup_strategy, rollup_instruction, workflow_instance_id, model)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(id, originalPrompt, status, rollupStrategy, rollupInstruction, workflowInstanceId, model)
    .run();
}

export async function getJob(db: D1Database, jobId: string): Promise<Job | null> {
  return db
    .prepare("SELECT * FROM jobs WHERE id = ?")
    .bind(jobId)
    .first<Job>();
}

export async function updateJobStatus(
  db: D1Database,
  jobId: string,
  status: string
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(
      `UPDATE jobs SET status = ?, updated_at = ?, completed_at = CASE WHEN ? IN ('completed','failed') THEN ? ELSE completed_at END WHERE id = ?`
    )
    .bind(status, now, status, now, jobId)
    .run();
}

export async function listJobs(db: D1Database, limit = 50): Promise<Job[]> {
  const result = await db
    .prepare("SELECT * FROM jobs WHERE id NOT LIKE 'plan-%' ORDER BY created_at DESC LIMIT ?")
    .bind(limit)
    .all<Job>();
  return result.results;
}

// ----- Tasks -----

export async function createTask(
  db: D1Database,
  id: string,
  jobId: string,
  prompt: string,
  wave: number,
  dependencies: string[],
  model: string | null = null
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO tasks (id, job_id, prompt, status, wave, dependencies, model)
       VALUES (?, ?, ?, 'pending', ?, ?, ?)`
    )
    .bind(id, jobId, prompt, wave, JSON.stringify(dependencies), model)
    .run();
}

export async function getTask(db: D1Database, taskId: string): Promise<Task | null> {
  const row = await db
    .prepare("SELECT * FROM tasks WHERE id = ?")
    .bind(taskId)
    .first<Record<string, unknown>>();
  if (!row) return null;
  return deserializeTask(row);
}

export async function getTasksByJob(db: D1Database, jobId: string): Promise<Task[]> {
  const result = await db
    .prepare("SELECT * FROM tasks WHERE job_id = ? ORDER BY wave, id")
    .bind(jobId)
    .all<Record<string, unknown>>();
  return result.results.map(deserializeTask);
}

export async function getTasksByWave(
  db: D1Database,
  jobId: string,
  wave: number
): Promise<Task[]> {
  const result = await db
    .prepare("SELECT * FROM tasks WHERE job_id = ? AND wave = ? ORDER BY id")
    .bind(jobId, wave)
    .all<Record<string, unknown>>();
  return result.results.map(deserializeTask);
}

export async function queueTasks(db: D1Database, taskIds: string[]): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  const placeholders = taskIds.map(() => "?").join(",");
  await db
    .prepare(
      `UPDATE tasks SET status = 'queued', updated_at = ? WHERE id IN (${placeholders})`
    )
    .bind(now, ...taskIds)
    .run();
}

export async function claimTask(
  db: D1Database,
  taskId: string,
  clientId: string
): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE tasks SET status = 'claimed', claimed_by = ?, claimed_at = ?, updated_at = ?
       WHERE id = ? AND status = 'queued'`
    )
    .bind(clientId, now, now, taskId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function updateTaskStatus(
  db: D1Database,
  taskId: string,
  status: TaskStatus,
  extra: { progress?: string; result?: string; error?: string } = {}
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);

  let sql = `UPDATE tasks SET status = ?, updated_at = ?`;
  const binds: unknown[] = [status, now];

  if (extra.progress !== undefined) {
    sql += `, progress = ?`;
    binds.push(extra.progress);
  }
  if (extra.result !== undefined) {
    sql += `, result = ?`;
    binds.push(extra.result);
  }
  if (status === "running") {
    sql += `, started_at = COALESCE(started_at, ?)`;
    binds.push(now);
  }
  if (status === "completed" || status === "failed") {
    sql += `, completed_at = ?`;
    binds.push(now);
  }

  sql += ` WHERE id = ?`;
  binds.push(taskId);

  await db.prepare(sql).bind(...binds).run();
}

export async function setTaskContext(
  db: D1Database,
  taskId: string,
  context: Record<string, unknown>
): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE tasks SET context = ?, updated_at = ? WHERE id = ?`)
    .bind(JSON.stringify(context), now, taskId)
    .run();
}

export async function getNextQueuedTask(db: D1Database): Promise<Task | null> {
  const row = await db
    .prepare(
      `SELECT * FROM tasks WHERE status = 'queued' ORDER BY wave, created_at LIMIT 1`
    )
    .first<Record<string, unknown>>();
  if (!row) return null;
  return deserializeTask(row);
}

export async function getTaskCounts(
  db: D1Database,
  jobId: string
): Promise<Record<string, number>> {
  const result = await db
    .prepare(
      `SELECT status, COUNT(*) as count FROM tasks WHERE job_id = ? GROUP BY status`
    )
    .bind(jobId)
    .all<{ status: string; count: number }>();

  const counts: Record<string, number> = {
    total: 0, pending: 0, queued: 0, claimed: 0, running: 0, completed: 0, failed: 0, stalled: 0,
  };
  for (const row of result.results) {
    counts[row.status] = row.count;
    counts.total += row.count;
  }
  return counts;
}

// ----- Event Log -----

export async function logEvent(
  db: D1Database,
  jobId: string,
  taskId: string | null,
  eventType: string,
  message: string | null,
  actor: string = "system"
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO event_log (job_id, task_id, event_type, message, actor) VALUES (?, ?, ?, ?, ?)`
    )
    .bind(jobId, taskId, eventType, message, actor)
    .run();
}

export async function getEventLog(
  db: D1Database,
  jobId: string,
  limit = 100
): Promise<{ id: number; job_id: string; task_id: string | null; event_type: string; message: string | null; actor: string | null; created_at: number }[]> {
  const result = await db
    .prepare("SELECT * FROM event_log WHERE job_id = ? ORDER BY created_at DESC, id DESC LIMIT ?")
    .bind(jobId, limit)
    .all();
  return result.results as any[];
}

// ----- Job Results -----

export async function saveJobResult(
  db: D1Database,
  jobId: string,
  result: string
): Promise<void> {
  await db
    .prepare(
      `INSERT OR REPLACE INTO job_results (job_id, result) VALUES (?, ?)`
    )
    .bind(jobId, result)
    .run();
}

export async function getJobResult(
  db: D1Database,
  jobId: string
): Promise<string | null> {
  const row = await db
    .prepare("SELECT result FROM job_results WHERE job_id = ?")
    .bind(jobId)
    .first<{ result: string }>();
  return row?.result ?? null;
}

// ----- Job Lifecycle -----

export async function pauseJob(db: D1Database, jobId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE jobs SET status = 'paused', updated_at = ? WHERE id = ? AND status = 'running'`)
    .bind(now, jobId)
    .run();
  // Set queued tasks back to pending so they won't be claimed
  await db
    .prepare(`UPDATE tasks SET status = 'pending', updated_at = ? WHERE job_id = ? AND status = 'queued'`)
    .bind(now, jobId)
    .run();
}

export async function resumeJob(db: D1Database, jobId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE jobs SET status = 'running', updated_at = ? WHERE id = ? AND status = 'paused'`)
    .bind(now, jobId)
    .run();
  // Note: advanceDag will re-queue eligible tasks after this
}

export async function stopJob(db: D1Database, jobId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE jobs SET status = 'stopped', updated_at = ? WHERE id = ? AND status IN ('running', 'paused')`)
    .bind(now, jobId)
    .run();
  // Cancel all non-completed tasks
  await db
    .prepare(`UPDATE tasks SET status = 'failed', updated_at = ?, error = 'Job stopped by user' WHERE job_id = ? AND status NOT IN ('completed', 'failed')`)
    .bind(now, jobId)
    .run();
}

export async function deleteJob(db: D1Database, jobId: string): Promise<void> {
  // Delete in order: event_log -> job_results -> tasks -> jobs
  await db.prepare("DELETE FROM event_log WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM job_results WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM tasks WHERE job_id = ?").bind(jobId).run();
  await db.prepare("DELETE FROM jobs WHERE id = ?").bind(jobId).run();
}

export async function restartJob(db: D1Database, jobId: string): Promise<number> {
  const now = Math.floor(Date.now() / 1000);
  // Increment generation and reset job status
  await db
    .prepare(
      `UPDATE jobs SET status = 'running', started_at = NULL, completed_at = NULL,
       generation = generation + 1, updated_at = ? WHERE id = ?`
    )
    .bind(now, jobId)
    .run();
  // Get the new generation
  const job = await db.prepare("SELECT generation FROM jobs WHERE id = ?").bind(jobId).first<{ generation: number }>();
  const gen = job?.generation ?? 1;
  // Reset all tasks: clear results, progress, claims, errors, retries; set new generation
  await db
    .prepare(
      `UPDATE tasks SET status = 'pending', claimed_by = NULL, claimed_at = NULL,
       started_at = NULL, completed_at = NULL, result = NULL, error = NULL,
       progress = NULL, context = '{}', retry_count = 0, generation = ?, updated_at = ?
       WHERE job_id = ?`
    )
    .bind(gen, now, jobId)
    .run();
  // Clear stored result
  await db.prepare("DELETE FROM job_results WHERE job_id = ?").bind(jobId).run();
  return gen;
}

export async function getJobGeneration(db: D1Database, jobId: string): Promise<number> {
  const row = await db.prepare("SELECT generation FROM jobs WHERE id = ?").bind(jobId).first<{ generation: number }>();
  return row?.generation ?? 1;
}

export async function getTaskGeneration(db: D1Database, taskId: string): Promise<number> {
  const row = await db.prepare("SELECT generation FROM tasks WHERE id = ?").bind(taskId).first<{ generation: number }>();
  return row?.generation ?? 1;
}

export async function setJobStarted(db: D1Database, jobId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE jobs SET started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`)
    .bind(now, now, jobId)
    .run();
}

// ----- Watchdog -----

export async function findStalledTasks(
  db: D1Database,
  stallThresholdSeconds: number = 1800  // 30 minutes default
): Promise<Task[]> {
  const cutoff = Math.floor(Date.now() / 1000) - stallThresholdSeconds;
  const result = await db
    .prepare(
      `SELECT * FROM tasks WHERE status IN ('claimed', 'running') AND updated_at < ? ORDER BY updated_at`
    )
    .bind(cutoff)
    .all<Record<string, unknown>>();
  return result.results.map(deserializeTask);
}

export async function markTaskStalled(db: D1Database, taskId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE tasks SET status = 'stalled', updated_at = ? WHERE id = ?`)
    .bind(now, taskId)
    .run();
}

export async function retryTask(db: D1Database, taskId: string): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const result = await db
    .prepare(
      `UPDATE tasks SET status = 'queued', claimed_by = NULL, claimed_at = NULL, started_at = NULL, 
       completed_at = NULL, retry_count = retry_count + 1, updated_at = ?, error = NULL, progress = NULL
       WHERE id = ? AND retry_count < max_retries`
    )
    .bind(now, taskId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function resetRetryCount(db: D1Database, taskId: string): Promise<void> {
  const now = Math.floor(Date.now() / 1000);
  await db
    .prepare(`UPDATE tasks SET retry_count = 0, updated_at = ? WHERE id = ?`)
    .bind(now, taskId)
    .run();
}

// ----- Helpers -----

function deserializeTask(row: Record<string, unknown>): Task {
  return {
    ...row,
    dependencies: JSON.parse((row.dependencies as string) || "[]"),
    context: JSON.parse((row.context as string) || "{}"),
  } as Task;
}
