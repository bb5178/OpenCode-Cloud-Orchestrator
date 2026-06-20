// ============================================================
// OpenCode Cloud Orchestrator (OCO) — Worker Entry Point
// ============================================================
//
// API Routes:
//   POST /api/job              — Submit a new job with tasks
//   GET  /api/poll?client=     — Poll for next available task
//   POST /api/status           — Update task status (running/failed)
//   POST /api/complete         — Mark task completed, advance DAG
//   GET  /api/job/:id          — Get job status with tasks + events + result
//   POST /api/job/:id/action   — Pause, resume, stop, delete, retry_stalled
//   GET  /api/job/:id/events   — Get event log for a job
//   GET  /api/board            — Dashboard data (all recent jobs)
//   POST /api/watchdog         — Run watchdog check (stall detection)
//   GET  /                     — Dashboard UI

import type { Env, SubmitJobRequest, TaskStatusUpdate, TaskCompleteRequest, JobActionRequest, PlanJobRequest } from "./types";
import * as db from "./db";
import { resolveWaves } from "./dag";
import { renderDashboard } from "./dashboard";
import { planJob, buildSynthesisPrompt } from "./planner";

// Re-export the Workflow class so Wrangler can find it
export { OcoJobWorkflow } from "./workflow";

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, DELETE, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    try {
      // ── Auth check — applies to ALL routes ──
      // Layer 1: Cloudflare Access protects the custom domain
      // Layer 2: Worker-level check on every request (defense-in-depth)
      //   - Access JWT (Cf-Access-Jwt-Assertion header) = browser session via Access
      //   - Bearer token = runner/MCP programmatic access
      const authHeader = request.headers.get("Authorization") || "";
      const bearerToken = authHeader.replace(/^Bearer\s+/i, "");
      const hasAccessJwt = !!request.headers.get("Cf-Access-Jwt-Assertion");
      const hasValidBearer = bearerToken === env.OCO_API_TOKEN;
      const isAuthenticated = hasAccessJwt || hasValidBearer;

      // Dashboard
      if (path === "/" && request.method === "GET") {
        if (!isAuthenticated) {
          return new Response("Unauthorized. Access this dashboard via your configured custom domain.", {
            status: 401,
            headers: { "Content-Type": "text/plain" },
          });
        }
        return new Response(renderDashboard(), {
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }

      // API routes
      if (path.startsWith("/api/") && !isAuthenticated) {
        return json({ error: "Unauthorized" }, 401, corsHeaders);
      }

      // ── POST /api/plan — Decompose prompt into tasks using AI ──
      if (path === "/api/plan" && request.method === "POST") {
        const body = await request.json<PlanJobRequest>();
        return await handlePlanJob(env, body, corsHeaders);
      }

      // ── POST /api/job ──
      if (path === "/api/job" && request.method === "POST") {
        const body = await request.json<SubmitJobRequest>();
        return await handleSubmitJob(env, body, corsHeaders);
      }

      // ── GET /api/poll ──
      if (path === "/api/poll" && request.method === "GET") {
        const clientId = url.searchParams.get("client") || "anonymous";
        return await handlePoll(env, clientId, corsHeaders);
      }

      // ── POST /api/status ──
      if (path === "/api/status" && request.method === "POST") {
        const body = await request.json<TaskStatusUpdate>();
        return await handleStatusUpdate(env, body, corsHeaders);
      }

      // ── POST /api/complete ──
      if (path === "/api/complete" && request.method === "POST") {
        const body = await request.json<TaskCompleteRequest>();
        return await handleComplete(env, body, corsHeaders);
      }

      // ── GET /api/plan/:id — Check plan status and get parsed tasks ──
      const planMatch = path.match(/^\/api\/plan\/([a-zA-Z0-9_-]+)$/);
      if (planMatch && request.method === "GET") {
        return await handleGetPlan(env, planMatch[1], corsHeaders);
      }

      // ── POST /api/watchdog ──
      if (path === "/api/watchdog" && request.method === "POST") {
        return await handleWatchdog(env, corsHeaders);
      }

      // ── Job-specific routes: /api/job/:id/* ──
      const jobActionMatch = path.match(/^\/api\/job\/([a-zA-Z0-9_-]+)\/action$/);
      if (jobActionMatch && request.method === "POST") {
        const body = await request.json<JobActionRequest>();
        return await handleJobAction(env, jobActionMatch[1], body, corsHeaders);
      }

      const jobEventsMatch = path.match(/^\/api\/job\/([a-zA-Z0-9_-]+)\/events$/);
      if (jobEventsMatch && request.method === "GET") {
        return await handleGetEvents(env, jobEventsMatch[1], corsHeaders);
      }

      const jobMatch = path.match(/^\/api\/job\/([a-zA-Z0-9_-]+)$/);
      if (jobMatch && request.method === "GET") {
        return await handleGetJob(env, jobMatch[1], corsHeaders);
      }

      // ── GET /api/board ──
      if (path === "/api/board" && request.method === "GET") {
        return await handleBoard(env, corsHeaders);
      }

      return json({ error: "Not found" }, 404, corsHeaders);
    } catch (err) {
      console.error("OCO error:", err);
      return json({ error: String(err) }, 500, corsHeaders);
    }
  },
};

// ── Handlers ──────────────────────────────────────────────────────────────

async function handlePlanJob(
  env: Env,
  body: PlanJobRequest,
  headers: Record<string, string>
): Promise<Response> {
  if (!body || !body.prompt || typeof body.prompt !== "string" || body.prompt.trim().length === 0) {
    return json({ error: `Prompt is required. Received: ${JSON.stringify(body).slice(0, 200)}` }, 400, headers);
  }

  const planId = `plan-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const model = body.model || "anthropic/claude-opus-4-6";

  // Create a plan job — a single task that runs locally via the runner
  // with full OpenCode context (AGENTS.md, codebase, tools)
  const planPrompt = `You are a task planner for an orchestration system called OCO. Given the user request below, decompose it into discrete tasks with dependencies.

USER REQUEST:
"${body.prompt}"

PLANNING RULES:
1. Each task must be self-contained — an independent AI agent session will execute it with NO access to other tasks' work.
2. Use descriptive task IDs (lowercase, hyphens). E.g. "research-auth", "write-tests", "analyze-results".
3. Dependencies define execution order. A task only starts after ALL its dependencies complete. Results from dependencies are automatically passed as context to the dependent task.
4. Maximize parallelism — tasks with no data dependency should NOT depend on each other.
5. Aim for 3-20 tasks depending on complexity.
6. Each task prompt must be detailed and specific enough for an AI agent to execute without ambiguity.
7. Consider the local project context when planning — what files exist, what tools are available.

CRITICAL CONSTRAINTS:
- DO NOT call oco_submit_job or any OCO tools. You are ONLY planning, not executing.
- DO NOT actually execute the tasks yourself. Just plan them.
- DO NOT use any tools except for reading files or searching if needed for context.
- Your FINAL output must be ONLY a JSON object. No explanation, no markdown fences, no commentary.
- Format: {"tasks":[{"id":"task-id","prompt":"Detailed instruction","dependencies":[]}],"rollup":{"strategy":"summary","instruction":"How to combine results"}}

After you have gathered enough context to plan well, output ONLY the JSON object as your final response.`;

  // Create a lightweight plan job in D1
  await db.createJob(env.DB, planId, body.prompt, "summary", null, "", model, "planning");
  await db.createTask(env.DB, `${planId}/_plan`, planId, planPrompt, 0, [], model);
  await db.queueTasks(env.DB, [`${planId}/_plan`]);
  await env.TASK_QUEUE.put(`queued:${planId}/_plan`, `${planId}/_plan`);
  await db.logEvent(env.DB, planId, null, "plan_created", `Planning job created for: ${body.prompt.slice(0, 100)}`);

  return json({ planId, status: "planning", message: "Plan task queued for runner execution" }, 202, headers);
}

async function handleSubmitJob(
  env: Env,
  body: SubmitJobRequest,
  headers: Record<string, string>
): Promise<Response> {
  if (!body.tasks || body.tasks.length === 0) {
    return json({ error: "At least one task is required" }, 400, headers);
  }

  const jobId = `job-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const model = body.model || "anthropic/claude-opus-4-6";

  // Prefix all task IDs with jobId to guarantee global uniqueness
  const idPrefix = jobId + "/";
  const tasks = body.tasks.map((t) => ({
    id: idPrefix + t.id,
    prompt: t.prompt,
    dependencies: (t.dependencies ?? []).map((d) => idPrefix + d),
  }));

  // Auto-append synthesis task if not already present
  const hasSynthesis = tasks.some((t) => t.id.endsWith("_synthesize"));
  if (!hasSynthesis) {
    const allTaskIds = tasks.map((t) => t.id);
    tasks.push({
      id: idPrefix + "_synthesize",
      prompt: buildSynthesisPrompt(body.prompt || "", allTaskIds),
      dependencies: allTaskIds,
    });
  }

  const waves = resolveWaves(tasks);

  const instance = await env.OCO_WORKFLOW.create({
    id: jobId,
    params: { jobId },
  });

  const rollup = body.rollup ?? { strategy: "summary" as const, instruction: "Summarize the results of all completed tasks." };
  await db.createJob(env.DB, jobId, body.prompt || "", rollup.strategy, rollup.instruction, instance.id, model);
  await db.logEvent(env.DB, jobId, null, "job_created", `Job created with ${tasks.length} tasks in ${waves.length} waves, model: ${model}`);

  for (let waveIdx = 0; waveIdx < waves.length; waveIdx++) {
    for (const taskId of waves[waveIdx]) {
      const task = tasks.find((t) => t.id === taskId)!;
      await db.createTask(env.DB, task.id, jobId, task.prompt, waveIdx, task.dependencies, model);
    }
  }

  return json({ jobId, workflowInstanceId: instance.id, taskCount: tasks.length, waves, model }, 201, headers);
}

async function handlePoll(
  env: Env,
  clientId: string,
  headers: Record<string, string>
): Promise<Response> {
  // Only serve tasks from running jobs
  const task = await db.getNextQueuedTask(env.DB);
  if (!task) {
    return json({ task: null }, 200, headers);
  }

  // Check job is still running or planning (not paused/stopped)
  const job = await db.getJob(env.DB, task.job_id);
  if (!job || !["running", "planning"].includes(job.status)) {
    return json({ task: null }, 200, headers);
  }

  const claimed = await db.claimTask(env.DB, task.id, clientId);
  if (!claimed) {
    return json({ task: null }, 200, headers);
  }

  await env.TASK_QUEUE.delete(`queued:${task.id}`);
  await db.logEvent(env.DB, task.job_id, task.id, "task_claimed", `Claimed by ${clientId}`, clientId);

  // Mark job as started on first claim
  await db.setJobStarted(env.DB, task.job_id);

  return json({
    task: { id: task.id, job_id: task.job_id, prompt: task.prompt, context: task.context },
  }, 200, headers);
}

async function handleStatusUpdate(
  env: Env,
  body: TaskStatusUpdate,
  headers: Record<string, string>
): Promise<Response> {
  if (!body.taskId) {
    return json({ error: "taskId is required" }, 400, headers);
  }

  const task = await db.getTask(env.DB, body.taskId);
  if (!task) {
    return json({ error: "Task not found" }, 404, headers);
  }

  // Reject stale updates from pre-restart runs
  const jobGen = await db.getJobGeneration(env.DB, task.job_id);
  const taskGen = await db.getTaskGeneration(env.DB, body.taskId);
  if (taskGen !== jobGen) {
    return json({ ok: false, error: "Stale update — job was restarted" }, 409, headers);
  }

  await db.updateTaskStatus(env.DB, body.taskId, body.status, {
    progress: body.progress,
  });

  const eventType = body.status === "running" ? "task_running" : "task_failed";
  const message = body.progress || (body.status === "failed" ? "Task failed" : "Task started running");
  await db.logEvent(env.DB, task.job_id, body.taskId, eventType, message);

  return json({ ok: true }, 200, headers);
}

async function handleComplete(
  env: Env,
  body: TaskCompleteRequest,
  headers: Record<string, string>
): Promise<Response> {
  if (!body.taskId || body.result === undefined) {
    return json({ error: "taskId and result are required" }, 400, headers);
  }

  const task = await db.getTask(env.DB, body.taskId);
  if (!task) {
    return json({ error: "Task not found" }, 404, headers);
  }

  // Check generation — reject completions from pre-restart runs
  const jobGen = await db.getJobGeneration(env.DB, task.job_id);
  const taskGen = await db.getTaskGeneration(env.DB, body.taskId);
  if (taskGen !== jobGen) {
    await db.logEvent(env.DB, task.job_id, body.taskId, "task_rejected",
      `Stale completion rejected (task gen=${taskGen}, job gen=${jobGen})`);
    return json({ ok: false, error: "Stale task completion — job was restarted" }, 409, headers);
  }

  await db.updateTaskStatus(env.DB, body.taskId, "completed", { result: body.result });
  await db.logEvent(env.DB, task.job_id, body.taskId, "task_completed",
    `Completed (result: ${body.result.length} chars)`);

  // Advance DAG
  const newlyQueued = await advanceDag(env, task.job_id);
  for (const qId of newlyQueued) {
    await db.logEvent(env.DB, task.job_id, qId, "task_queued", "Dependencies satisfied, queued for execution");
  }

  // Check if all tasks done
  const counts = await db.getTaskCounts(env.DB, task.job_id);
  const allDone = counts.total > 0 && counts.completed === counts.total;

  if (allDone) {
    // Use synthesis task output as the primary result if available
    const allTasks = await db.getTasksByJob(env.DB, task.job_id);
    const synthesisTask = allTasks.find((t) => t.id.endsWith("_synthesize"));
    let finalResult: string;

    if (synthesisTask?.result) {
      // Synthesis task produced a clean, merged document
      finalResult = synthesisTask.result;
    } else {
      // Fallback: concatenate all task results
      finalResult = allTasks
        .filter((t) => t.result && !t.id.endsWith("_synthesize"))
        .map((t) => `## ${t.id}\n${t.result}`)
        .join("\n\n---\n\n");
    }
    await db.saveJobResult(env.DB, task.job_id, finalResult);

    // Update job status
    const job = await db.getJob(env.DB, task.job_id);
    if (job?.workflow_instance_id) {
      try {
        const instance = await env.OCO_WORKFLOW.get(job.workflow_instance_id);
        await instance.sendEvent({
          type: `job-done-${task.job_id}`,
          payload: { jobId: task.job_id },
        });
      } catch {
        await db.updateJobStatus(env.DB, task.job_id, "completed");
      }
    } else {
      await db.updateJobStatus(env.DB, task.job_id, "completed");
    }
    await db.logEvent(env.DB, task.job_id, null, "job_completed",
      `All ${counts.total} tasks completed`);
  }

  return json({ ok: true, newlyQueued }, 200, headers);
}

async function handleJobAction(
  env: Env,
  jobId: string,
  body: JobActionRequest,
  headers: Record<string, string>
): Promise<Response> {
  const job = await db.getJob(env.DB, jobId);
  if (!job) {
    return json({ error: "Job not found" }, 404, headers);
  }

  switch (body.action) {
    case "pause": {
      if (job.status !== "running") {
        return json({ error: "Can only pause running jobs" }, 400, headers);
      }
      await db.pauseJob(env.DB, jobId);
      await db.logEvent(env.DB, jobId, null, "job_paused", "Job paused by user");
      return json({ ok: true, status: "paused" }, 200, headers);
    }

    case "resume": {
      if (job.status !== "paused") {
        return json({ error: "Can only resume paused jobs" }, 400, headers);
      }
      await db.resumeJob(env.DB, jobId);
      await db.logEvent(env.DB, jobId, null, "job_resumed", "Job resumed by user");
      // Re-advance DAG to queue eligible tasks
      const queued = await advanceDag(env, jobId);
      for (const qId of queued) {
        await db.logEvent(env.DB, jobId, qId, "task_queued", "Queued after job resume");
      }
      return json({ ok: true, status: "running", newlyQueued: queued }, 200, headers);
    }

    case "stop": {
      if (!["running", "paused"].includes(job.status)) {
        return json({ error: "Can only stop running or paused jobs" }, 400, headers);
      }
      await db.stopJob(env.DB, jobId);
      await db.logEvent(env.DB, jobId, null, "job_stopped", "Job stopped by user");
      return json({ ok: true, status: "stopped" }, 200, headers);
    }

    case "restart": {
      if (!["stopped", "completed", "failed"].includes(job.status)) {
        return json({ error: "Can only restart stopped, completed, or failed jobs" }, 400, headers);
      }
      await db.restartJob(env.DB, jobId);
      await db.logEvent(env.DB, jobId, null, "job_restarted", "Job restarted by user — all tasks reset");
      // Re-advance DAG to queue wave-0 tasks
      const requeued = await advanceDag(env, jobId);
      for (const qId of requeued) {
        await db.logEvent(env.DB, jobId, qId, "task_queued", "Queued after job restart");
      }
      return json({ ok: true, status: "running", newlyQueued: requeued }, 200, headers);
    }

    case "delete": {
      await db.logEvent(env.DB, jobId, null, "job_deleted", "Job deleted by user");
      await db.deleteJob(env.DB, jobId);
      return json({ ok: true, deleted: true }, 200, headers);
    }

    case "retry_stalled": {
      // If job is stopped, resume it first so retried tasks can be polled
      if (job.status === "stopped" || job.status === "failed") {
        await db.updateJobStatus(env.DB, jobId, "running");
        await db.logEvent(env.DB, jobId, null, "job_resumed", "Job resumed for task retry");
      }

      const tasks = await db.getTasksByJob(env.DB, jobId);
      const failedTasks = tasks.filter((t) => t.status === "stalled" || t.status === "failed");
      let retried = 0;
      for (const t of failedTasks) {
        // Reset retry count if exhausted, then retry
        await db.resetRetryCount(env.DB, t.id);
        const ok = await db.retryTask(env.DB, t.id);
        if (ok) {
          retried++;
          await db.logEvent(env.DB, jobId, t.id, "task_retried", "Manual retry via dashboard");
          await env.TASK_QUEUE.put(`queued:${t.id}`, t.id);
        }
      }

      // Also advance DAG in case pending tasks now have deps met
      const queued = await advanceDag(env, jobId);
      for (const qId of queued) {
        await db.logEvent(env.DB, jobId, qId, "task_queued", "Queued after retry");
      }

      return json({ ok: true, retriedCount: retried, newlyQueued: queued, status: "running" }, 200, headers);
    }

    default:
      return json({ error: `Unknown action: ${body.action}` }, 400, headers);
  }
}

async function handleGetPlan(
  env: Env,
  planId: string,
  headers: Record<string, string>
): Promise<Response> {
  const job = await db.getJob(env.DB, planId);
  if (!job) {
    return json({ error: "Plan not found" }, 404, headers);
  }

  const tasks = await db.getTasksByJob(env.DB, planId);
  const planTask = tasks.find((t) => t.id.endsWith("/_plan"));

  if (!planTask) {
    return json({ error: "Plan task not found" }, 404, headers);
  }

  // Still running?
  if (planTask.status !== "completed") {
    return json({
      planId,
      status: planTask.status,
      progress: planTask.progress,
      tasks: null,
    }, 200, headers);
  }

  // Parse the plan result into structured tasks
  // The agent may wrap JSON in conversation, markdown fences, or tool output.
  // Try multiple extraction strategies.
  const raw = planTask.result || "";
  try {
    let parsed: any = null;

    // Strategy 1: Try parsing the entire output as JSON
    try {
      parsed = JSON.parse(raw.trim());
    } catch {}

    // Strategy 2: Extract from markdown code fences
    if (!parsed) {
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try { parsed = JSON.parse(fenceMatch[1].trim()); } catch {}
      }
    }

    // Strategy 3: Find the largest JSON object in the text
    if (!parsed) {
      const jsonObjects: string[] = [];
      let depth = 0, start = -1;
      for (let i = 0; i < raw.length; i++) {
        if (raw[i] === '{') { if (depth === 0) start = i; depth++; }
        if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) { jsonObjects.push(raw.slice(start, i + 1)); start = -1; } }
      }
      // Try each JSON object, largest first (most likely to be the full plan)
      jsonObjects.sort((a, b) => b.length - a.length);
      for (const candidate of jsonObjects) {
        try {
          const obj = JSON.parse(candidate);
          if (obj.tasks && Array.isArray(obj.tasks)) { parsed = obj; break; }
        } catch {}
      }
    }

    if (!parsed || !parsed.tasks) {
      throw new Error("No valid JSON with 'tasks' array found in agent output");
    }
    const plannedTasks = (parsed.tasks || []).map((t: any, i: number) => ({
      id: t.id || `task-${i + 1}`,
      prompt: t.prompt || "",
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
    }));

    const rollup = parsed.rollup || {
      strategy: "summary",
      instruction: "Summarize the results of all completed tasks.",
    };

    // Clean up the plan job (it served its purpose)
    await db.deleteJob(env.DB, planId);

    return json({
      planId,
      status: "completed",
      prompt: job.original_prompt,
      model: job.model,
      tasks: plannedTasks,
      rollup,
    }, 200, headers);
  } catch (err) {
    return json({
      planId,
      status: "completed",
      error: `Failed to parse plan output: ${err}`,
      raw: raw.slice(0, 2000),
    }, 200, headers);
  }
}

async function handleGetEvents(
  env: Env,
  jobId: string,
  headers: Record<string, string>
): Promise<Response> {
  const events = await db.getEventLog(env.DB, jobId, 200);
  return json({ events }, 200, headers);
}

async function handleWatchdog(
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const stalledTasks = await db.findStalledTasks(env.DB, 1800); // 30 min threshold
  const results: { taskId: string; action: string }[] = [];

  for (const task of stalledTasks) {
    // Check if job is still running
    const job = await db.getJob(env.DB, task.job_id);
    if (!job || !["running"].includes(job.status)) continue;

    if (task.retry_count < task.max_retries) {
      // Retry
      const ok = await db.retryTask(env.DB, task.id);
      if (ok) {
        await db.logEvent(env.DB, task.job_id, task.id, "task_retried",
          `Watchdog auto-retry ${task.retry_count + 1}/${task.max_retries}`, "watchdog");
        results.push({ taskId: task.id, action: "retried" });
      }
    } else {
      // Mark stalled permanently
      await db.markTaskStalled(env.DB, task.id);
      await db.logEvent(env.DB, task.job_id, task.id, "task_stalled",
        `Stalled after ${task.retry_count} retries, no update for 30+ min`, "watchdog");
      results.push({ taskId: task.id, action: "stalled" });
    }
  }

  return json({ checked: stalledTasks.length, results }, 200, headers);
}

// ── DAG Advancement ──

async function advanceDag(env: Env, jobId: string): Promise<string[]> {
  // Don't advance paused/stopped jobs
  const job = await db.getJob(env.DB, jobId);
  if (!job || !["running"].includes(job.status)) return [];

  const allTasks = await db.getTasksByJob(env.DB, jobId);
  const completedIds = new Set(
    allTasks.filter((t) => t.status === "completed").map((t) => t.id)
  );

  const newlyQueued: string[] = [];

  for (const task of allTasks) {
    if (task.status !== "pending") continue;

    const deps = task.dependencies;
    const allDepsMet = deps.length === 0 || deps.every((depId) => completedIds.has(depId));
    if (!allDepsMet) continue;

    // Gather context from dependencies
    const context: Record<string, unknown> = {};
    for (const depId of deps) {
      const depTask = allTasks.find((t) => t.id === depId);
      if (depTask?.result) {
        context[depId] = depTask.result;
      }
    }

    if (Object.keys(context).length > 0) {
      await db.setTaskContext(env.DB, task.id, context);
    }

    await db.queueTasks(env.DB, [task.id]);
    await env.TASK_QUEUE.put(`queued:${task.id}`, task.id);
    newlyQueued.push(task.id);
  }

  return newlyQueued;
}

// ── Handlers (continued) ──

async function handleGetJob(
  env: Env,
  jobId: string,
  headers: Record<string, string>
): Promise<Response> {
  const job = await db.getJob(env.DB, jobId);
  if (!job) {
    return json({ error: "Job not found" }, 404, headers);
  }

  const tasks = await db.getTasksByJob(env.DB, jobId);
  const counts = await db.getTaskCounts(env.DB, jobId);
  const events = await db.getEventLog(env.DB, jobId, 50);
  const result = await db.getJobResult(env.DB, jobId);

  return json({ job, tasks, summary: counts, events, result }, 200, headers);
}

async function handleBoard(
  env: Env,
  headers: Record<string, string>
): Promise<Response> {
  const jobs = await db.listJobs(env.DB, 50);
  const jobsWithTasks = await Promise.all(
    jobs.map(async (job) => {
      const tasks = await db.getTasksByJob(env.DB, job.id);
      return { ...job, tasks };
    })
  );

  return json({ jobs: jobsWithTasks }, 200, headers);
}

// ── Utilities ──

function json(data: unknown, status: number, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { "Content-Type": "application/json", ...extraHeaders },
  });
}
