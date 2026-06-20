#!/usr/bin/env node
// ============================================================
// OCO MCP Server — Bridge between OpenCode and OCO cloud
// ============================================================
//
// Tools exposed to OpenCode agents:
//   oco_submit_job   — Submit a decomposed job with tasks
//   oco_poll         — Poll for the next available task
//   oco_update       — Update task status (running/failed)
//   oco_complete     — Mark task completed and signal workflow
//   oco_job_status   — Get job status with all tasks
//   oco_board        — Get all jobs for overview

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const OCO_URL = process.env.OCO_URL || "";
const OCO_API_TOKEN = process.env.OCO_API_TOKEN || "";
const OCO_ACCESS_CLIENT_ID = process.env.OCO_ACCESS_CLIENT_ID || "";
const OCO_ACCESS_CLIENT_SECRET = process.env.OCO_ACCESS_CLIENT_SECRET || "";
const CLIENT_ID = process.env.OCO_CLIENT_ID || `opencode-${process.env.USER || "anon"}-${process.pid}`;

const server = new McpServer({
  name: "oco",
  version: "0.1.0",
});

// ── Helper ──

async function ocoFetch(path, options = {}) {
  const url = `${OCO_URL}${path}`;
  const headers = {
    "Content-Type": "application/json",
    ...(OCO_API_TOKEN ? { "Authorization": `Bearer ${OCO_API_TOKEN}` } : {}),
    ...(OCO_ACCESS_CLIENT_ID ? { "CF-Access-Client-Id": OCO_ACCESS_CLIENT_ID } : {}),
    ...(OCO_ACCESS_CLIENT_SECRET ? { "CF-Access-Client-Secret": OCO_ACCESS_CLIENT_SECRET } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  if (res.status === 401 || res.status === 403) {
    return { error: "Unauthorized — check OCO_API_TOKEN and Access credentials" };
  }
  return res.json();
}

// ── Tools ──

server.tool(
  "oco_submit_job",
  "Submit a job to OCO with decomposed tasks and dependencies. Each task has an id, prompt, and optional dependencies (array of task IDs that must complete first). The rollup defines how results are combined after all tasks complete.",
  {
    prompt: z.string().describe("The original user prompt that was decomposed"),
    tasks: z.array(z.object({
      id: z.string().describe("Unique task ID (e.g. t1, t2)"),
      prompt: z.string().describe("The prompt/instruction for this task"),
      dependencies: z.array(z.string()).optional().describe("Task IDs that must complete before this task"),
    })).describe("Array of tasks to execute"),
    rollup_strategy: z.enum(["sequential_merge", "summary", "git_branch_per_task", "custom"]).optional()
      .describe("How to combine results: summary (default), sequential_merge, git_branch_per_task, custom"),
    rollup_instruction: z.string().optional()
      .describe("LLM-readable instruction for combining results after all tasks complete"),
  },
  async ({ prompt, tasks, rollup_strategy, rollup_instruction }) => {
    const body = {
      prompt,
      tasks,
      rollup: {
        strategy: rollup_strategy || "summary",
        instruction: rollup_instruction || "Summarize the results of all completed tasks.",
      },
    };
    const result = await ocoFetch("/api/job", {
      method: "POST",
      body: JSON.stringify(body),
    });
    return {
      content: [{
        type: "text",
        text: JSON.stringify(result, null, 2),
      }],
    };
  }
);

server.tool(
  "oco_poll",
  "Poll OCO for the next available task to execute. Returns null if no tasks are queued. The task includes the prompt and context (results from dependency tasks).",
  {},
  async () => {
    const result = await ocoFetch(`/api/poll?client=${encodeURIComponent(CLIENT_ID)}`);
    const text = result.task
      ? `Task claimed:\n${JSON.stringify(result.task, null, 2)}`
      : "No tasks available right now.";
    return {
      content: [{ type: "text", text }],
    };
  }
);

server.tool(
  "oco_update",
  "Update a task's status to 'running' or 'failed'. Use this to report progress while executing a task.",
  {
    taskId: z.string().describe("The task ID to update"),
    status: z.enum(["running", "failed"]).describe("New status"),
    progress: z.string().optional().describe("Freeform progress text shown on dashboard"),
  },
  async ({ taskId, status, progress }) => {
    const result = await ocoFetch("/api/status", {
      method: "POST",
      body: JSON.stringify({ taskId, status, progress }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(result) }],
    };
  }
);

server.tool(
  "oco_complete",
  "Mark a task as completed with its result. This signals the OCO Workflow to advance — downstream tasks that depend on this one will become available.",
  {
    taskId: z.string().describe("The task ID to complete"),
    result: z.string().describe("The result/output of the completed task"),
  },
  async ({ taskId, result }) => {
    const res = await ocoFetch("/api/complete", {
      method: "POST",
      body: JSON.stringify({ taskId, result }),
    });
    return {
      content: [{ type: "text", text: JSON.stringify(res) }],
    };
  }
);

server.tool(
  "oco_job_status",
  "Get the status of a specific job including all its tasks, progress, and completion state.",
  {
    jobId: z.string().describe("The job ID to check"),
  },
  async ({ jobId }) => {
    const result = await ocoFetch(`/api/job/${jobId}`);
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  }
);

server.tool(
  "oco_board",
  "Get all recent jobs and their tasks — the full orchestration board. Shows status of all jobs and tasks across the system.",
  {},
  async () => {
    const result = await ocoFetch("/api/board");
    const jobs = result.jobs || [];
    if (jobs.length === 0) {
      return { content: [{ type: "text", text: "No jobs on the board." }] };
    }

    // Format as readable summary
    let text = `OCO Board — ${jobs.length} job(s)\n\n`;
    for (const job of jobs) {
      const tasks = job.tasks || [];
      const completed = tasks.filter(t => t.status === "completed").length;
      text += `Job ${job.id.slice(0, 12)} [${job.status}] — ${completed}/${tasks.length} tasks\n`;
      for (const t of tasks) {
        const progress = t.progress ? ` (${t.progress})` : "";
        text += `  W${t.wave} ${t.id}: ${t.status}${progress}\n`;
      }
      text += "\n";
    }
    return { content: [{ type: "text", text }] };
  }
);

// ── Start ──

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch(console.error);
