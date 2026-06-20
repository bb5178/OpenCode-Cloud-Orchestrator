#!/usr/bin/env node
// ============================================================
// OCO Runner — Polls for tasks and executes them via opencode CLI
// ============================================================
//
// Usage:
//   node ~/dev/oco/runner.mjs                  # run with defaults
//   node ~/dev/oco/runner.mjs --parallel 3     # run up to 3 tasks concurrently
//   node ~/dev/oco/runner.mjs --dry-run        # poll and show tasks without executing
//   node ~/dev/oco/runner.mjs --once           # execute one task and exit
//
// Environment:
//   OCO_URL             — OCO API base URL (required)
//   OCO_API_TOKEN       — Bearer token for OCO API authentication (required)
//   OCO_ACCESS_CLIENT_ID     — Cloudflare Access service token client ID
//   OCO_ACCESS_CLIENT_SECRET — Cloudflare Access service token client secret
//   OCO_CLIENT_ID       — client identifier (default: hostname-pid)
//   OCO_MODEL           — model to use (default: uses opencode default)
//   OCO_DIR             — working directory for opencode (default: current dir)

import { spawn } from "node:child_process";
import { hostname } from "node:os";

// ── Config ──

const args = process.argv.slice(2);
const OCO_URL = process.env.OCO_URL || "";
const OCO_API_TOKEN = process.env.OCO_API_TOKEN || "";
const OCO_ACCESS_CLIENT_ID = process.env.OCO_ACCESS_CLIENT_ID || "";
const OCO_ACCESS_CLIENT_SECRET = process.env.OCO_ACCESS_CLIENT_SECRET || "";
const CLIENT_ID = process.env.OCO_CLIENT_ID || `${hostname()}-${process.pid}`;
const MODEL = process.env.OCO_MODEL || "";
const WORK_DIR = process.env.OCO_DIR || process.cwd();
const POLL_INTERVAL = 5000; // 5 seconds
const MAX_PARALLEL = parseInt(getArg("--parallel") || "1", 10);
const DRY_RUN = args.includes("--dry-run");
const ONCE = args.includes("--once");

let activeCount = 0;
let totalExecuted = 0;
let shuttingDown = false;

function getArg(name) {
  const idx = args.indexOf(name);
  if (idx === -1 || idx + 1 >= args.length) return null;
  return args[idx + 1];
}

// ── Logging ──

const C = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  bold: "\x1b[1m",
  blue: "\x1b[34m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  magenta: "\x1b[35m",
};

function log(color, prefix, msg) {
  const ts = new Date().toLocaleTimeString("en-GB");
  console.log(`${C.dim}${ts}${C.reset} ${color}${prefix}${C.reset} ${msg}`);
}

function logInfo(msg) { log(C.blue, "[OCO]", msg); }
function logTask(msg) { log(C.cyan, "[TASK]", msg); }
function logDone(msg) { log(C.green, "[DONE]", msg); }
function logErr(msg) { log(C.red, "[ERR]", msg); }
function logWarn(msg) { log(C.yellow, "[WAIT]", msg); }

// ── API Helpers ──

async function ocoFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(OCO_API_TOKEN ? { "Authorization": `Bearer ${OCO_API_TOKEN}` } : {}),
    ...(OCO_ACCESS_CLIENT_ID ? { "CF-Access-Client-Id": OCO_ACCESS_CLIENT_ID } : {}),
    ...(OCO_ACCESS_CLIENT_SECRET ? { "CF-Access-Client-Secret": OCO_ACCESS_CLIENT_SECRET } : {}),
    ...(options.headers || {}),
  };
  const res = await fetch(`${OCO_URL}${path}`, {
    ...options,
    headers,
  });
  if (res.status === 401 || res.status === 403) {
    throw new Error("Unauthorized — check OCO_API_TOKEN and OCO_ACCESS_CLIENT_ID/SECRET");
  }
  if (res.status === 302 || res.status === 301) {
    throw new Error("Redirected (likely Access login page) — set OCO_ACCESS_CLIENT_ID and OCO_ACCESS_CLIENT_SECRET");
  }
  const contentType = res.headers.get("content-type") || "";
  if (!contentType.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON but got ${contentType} (HTTP ${res.status}). Body: ${text.slice(0, 100)}`);
  }
  return res.json();
}

async function poll() {
  return ocoFetch(`/api/poll?client=${encodeURIComponent(CLIENT_ID)}`);
}

async function updateStatus(taskId, status, progress) {
  return ocoFetch("/api/status", {
    method: "POST",
    body: JSON.stringify({ taskId, status, progress }),
  });
}

async function completeTask(taskId, result) {
  return ocoFetch("/api/complete", {
    method: "POST",
    body: JSON.stringify({ taskId, result }),
  });
}

// ── Execute task via opencode CLI ──

function executeTask(task) {
  return new Promise((resolve, reject) => {
    // Build the prompt with context from dependencies
    let prompt = task.prompt;
    const ctx = task.context || {};
    if (Object.keys(ctx).length > 0) {
      prompt += "\n\n--- Context from completed dependency tasks ---\n";
      for (const [depId, depResult] of Object.entries(ctx)) {
        prompt += `\n### Result from [${depId}]:\n${depResult}\n`;
      }
      prompt += "\n--- End of context ---\n";
      prompt += "\nUse the above context to inform your work. Produce a thorough, detailed result.";
    }

    // Build opencode run command
    const cmdArgs = ["run"];
    if (MODEL) {
      cmdArgs.push("--model", MODEL);
    }
    cmdArgs.push("--dir", WORK_DIR);
    cmdArgs.push("--dangerously-skip-permissions");
    cmdArgs.push("--title", `OCO: ${task.id}`);
    cmdArgs.push(prompt);

    logTask(`Spawning opencode for ${C.bold}${task.id}${C.reset}`);

    const child = spawn("opencode", cmdArgs, {
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env },
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });

    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });

    child.on("close", (code) => {
      if (code === 0) {
        // Extract the meaningful output — take the last substantial chunk
        const result = extractResult(stdout) || stdout.slice(-50000) || "(completed with no output)";
        resolve(result);
      } else {
        reject(new Error(`opencode exited with code ${code}\n${stderr.slice(-2000)}`));
      }
    });

    child.on("error", (err) => {
      reject(new Error(`Failed to spawn opencode: ${err.message}`));
    });
  });
}

function extractResult(output) {
  // opencode run output includes ANSI codes and formatting.
  // Strip ANSI escape sequences.
  const clean = output.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
  if (!clean) return null;

  const lines = clean.split("\n").filter((l) => l.trim().length > 0);
  if (lines.length === 0) return null;

  // Return the full output — D1 TEXT columns have no practical size limit
  return lines.join("\n");
}

// ── Main Loop ──

async function processTask(task) {
  activeCount++;
  const startTime = Date.now();

  try {
    // Report running
    await updateStatus(task.id, "running", "Executing via opencode CLI...");
    logTask(
      `${C.bold}${task.id}${C.reset} ${C.dim}(job: ${task.job_id})${C.reset}\n` +
      `         ${C.dim}${task.prompt.slice(0, 120)}${task.prompt.length > 120 ? "..." : ""}${C.reset}`
    );

    if (DRY_RUN) {
      logWarn(`[DRY RUN] Would execute: ${task.id}`);
      activeCount--;
      return;
    }

    // Execute
    const result = await executeTask(task);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // Report complete
    await completeTask(task.id, result);
    totalExecuted++;
    logDone(`${C.bold}${task.id}${C.reset} completed in ${elapsed}s (${totalExecuted} total)`);
  } catch (err) {
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    logErr(`${task.id} failed after ${elapsed}s: ${err.message}`);

    try {
      await updateStatus(task.id, "failed", err.message.slice(0, 500));
    } catch {
      // ignore status update failure
    }
  } finally {
    activeCount--;
  }
}

async function mainLoop() {
  logInfo(`${C.bold}OCO Runner started${C.reset}`);
  if (!OCO_URL) {
    logErr("OCO_URL is not set. Export it before running:");
    logErr("  export OCO_URL=https://oco.yourdomain.com");
    process.exit(1);
  }

  if (!OCO_API_TOKEN) {
    logErr("OCO_API_TOKEN is not set. Export it before running:");
    logErr("  export OCO_API_TOKEN=<your-token>");
    process.exit(1);
  }
  logInfo(`  API:       ${OCO_URL}`);
  logInfo(`  Auth:      Bearer ***${OCO_API_TOKEN.slice(-8)}`);
  if (OCO_ACCESS_CLIENT_ID) {
    logInfo(`  Access:    ***${OCO_ACCESS_CLIENT_ID.slice(-12)}`);
  } else {
    logInfo(`  Access:    (not set — using direct endpoint)`)
  }
  logInfo(`  Client:    ${CLIENT_ID}`);
  logInfo(`  Parallel:  ${MAX_PARALLEL}`);
  logInfo(`  Model:     ${MODEL || "(default)"}`);
  logInfo(`  Directory: ${WORK_DIR}`);
  logInfo(`  Dry run:   ${DRY_RUN}`);
  logInfo("");

  while (!shuttingDown) {
    try {
      // Only poll if we have capacity
      if (activeCount >= MAX_PARALLEL) {
        await sleep(1000);
        continue;
      }

      const response = await poll();

      if (!response.task) {
        // No tasks available — wait and retry
        process.stdout.write(`\r${C.dim}${new Date().toLocaleTimeString("en-GB")} ${C.yellow}[WAIT]${C.reset} No tasks queued. Polling... (${totalExecuted} completed, ${activeCount} active)   `);
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Clear the waiting line
      process.stdout.write("\r" + " ".repeat(100) + "\r");

      // Execute task (non-blocking if parallel > 1)
      if (MAX_PARALLEL > 1) {
        processTask(response.task); // fire and forget
      } else {
        await processTask(response.task);
      }

      if (ONCE) {
        logInfo("--once flag set, exiting after first task.");
        break;
      }

      // Small delay before next poll to avoid hammering
      await sleep(500);
    } catch (err) {
      logErr(`Poll error: ${err.message}`);
      await sleep(POLL_INTERVAL);
    }
  }

  // Wait for active tasks to finish
  if (activeCount > 0) {
    logInfo(`Waiting for ${activeCount} active task(s) to finish...`);
    while (activeCount > 0) {
      await sleep(1000);
    }
  }

  logInfo(`${C.bold}Runner stopped.${C.reset} ${totalExecuted} tasks executed.`);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ── Graceful shutdown ──

process.on("SIGINT", () => {
  logWarn("\nShutting down gracefully (Ctrl+C again to force)...");
  shuttingDown = true;
  process.on("SIGINT", () => process.exit(1));
});

process.on("SIGTERM", () => {
  shuttingDown = true;
});

// ── Start ──

mainLoop().catch((err) => {
  logErr(`Fatal: ${err.message}`);
  process.exit(1);
});
