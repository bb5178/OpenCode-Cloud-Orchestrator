#!/usr/bin/env node
// ============================================================
// OCO Pool Runner — TUI dashboard with warm OpenCode server pool
// ============================================================
//
// Usage:
//   node runner-pool.mjs              # 4 servers (default)
//   node runner-pool.mjs --pool 6     # 6 servers
//   node runner-pool.mjs --pool 2     # 2 servers
//
// Requires: OCO_URL, OCO_API_TOKEN, OCO_ACCESS_CLIENT_ID, OCO_ACCESS_CLIENT_SECRET

import { spawn } from "node:child_process";
import { hostname } from "node:os";

// ── Config ──

const args = process.argv.slice(2);
const OCO_URL = process.env.OCO_URL || "";
const OCO_API_TOKEN = process.env.OCO_API_TOKEN || "";
const OCO_ACCESS_CLIENT_ID = process.env.OCO_ACCESS_CLIENT_ID || "";
const OCO_ACCESS_CLIENT_SECRET = process.env.OCO_ACCESS_CLIENT_SECRET || "";
const CLIENT_ID = `${hostname()}-${process.pid}`;
const WORK_DIR = process.env.OCO_DIR || process.cwd();
const POOL_SIZE = parseInt(getArg("--pool") || "4", 10);
const POLL_INTERVAL = 3000;
const BASE_PORT = 14100;
const SERVER_WARMUP_MS = 8000;

function getArg(name) {
  const idx = args.indexOf(name);
  return idx >= 0 && idx + 1 < args.length ? args[idx + 1] : null;
}

// ── State ──

const servers = [];      // { id, port, pid, process, status, taskId, taskPrompt, startedAt, tasksCompleted, lastActivity, error }
let totalCompleted = 0;
let totalFailed = 0;
let shuttingDown = false;
let screenRows = process.stdout.rows || 40;
let screenCols = process.stdout.columns || 120;

process.stdout.on("resize", () => {
  screenRows = process.stdout.rows || 40;
  screenCols = process.stdout.columns || 120;
});

// ── API ──

async function ocoFetch(path, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(OCO_API_TOKEN ? { Authorization: `Bearer ${OCO_API_TOKEN}` } : {}),
    ...(OCO_ACCESS_CLIENT_ID ? { "CF-Access-Client-Id": OCO_ACCESS_CLIENT_ID } : {}),
    ...(OCO_ACCESS_CLIENT_SECRET ? { "CF-Access-Client-Secret": OCO_ACCESS_CLIENT_SECRET } : {}),
  };
  const res = await fetch(`${OCO_URL}${path}`, { ...options, headers });
  if (res.status === 401 || res.status === 403) throw new Error("Unauthorized");
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("application/json")) {
    const text = await res.text();
    throw new Error(`Expected JSON, got ${ct}: ${text.slice(0, 100)}`);
  }
  return res.json();
}

async function poll() { return ocoFetch(`/api/poll?client=${encodeURIComponent(CLIENT_ID)}`); }
async function updateStatus(taskId, status, progress) {
  return ocoFetch("/api/status", { method: "POST", body: JSON.stringify({ taskId, status, progress }) });
}
async function completeTask(taskId, result) {
  return ocoFetch("/api/complete", { method: "POST", body: JSON.stringify({ taskId, result }) });
}

// ── Server Pool ──

function startServer(id) {
  const port = BASE_PORT + id;
  const srv = {
    id,
    port,
    pid: null,
    process: null,
    status: "starting",
    taskId: null,
    taskPrompt: null,
    startedAt: Date.now(),
    tasksCompleted: 0,
    lastActivity: Date.now(),
    error: null,
    output: "",
  };

  const proc = spawn("opencode", ["serve", "--port", String(port)], {
    stdio: ["ignore", "pipe", "pipe"],
    cwd: WORK_DIR,
    env: { ...process.env },
  });

  srv.pid = proc.pid;
  srv.process = proc;

  proc.stdout.on("data", (d) => { srv.output += d.toString(); srv.lastActivity = Date.now(); });
  proc.stderr.on("data", (d) => { srv.output += d.toString(); srv.lastActivity = Date.now(); });

  proc.on("close", (code) => {
    if (!shuttingDown) {
      srv.status = "crashed";
      srv.error = `Exit code ${code}`;
      // Auto-restart after 3 seconds
      setTimeout(() => {
        if (!shuttingDown) {
          const idx = servers.findIndex((s) => s.id === id);
          if (idx >= 0) {
            servers[idx] = startServer(id);
            // Wait for warmup
            setTimeout(() => {
              if (servers[idx] && servers[idx].status === "starting") {
                servers[idx].status = "idle";
              }
            }, SERVER_WARMUP_MS);
          }
        }
      }, 3000);
    }
  });

  servers[id] = srv;

  // Mark ready after warmup
  setTimeout(() => {
    if (srv.status === "starting") srv.status = "idle";
  }, SERVER_WARMUP_MS);

  return srv;
}

function getIdleServer() {
  return servers.find((s) => s.status === "idle");
}

// ── Task Execution ──

async function executeTask(server, task) {
  server.status = "running";
  server.taskId = task.id;
  server.taskPrompt = task.prompt;
  server.lastActivity = Date.now();
  server.output = "";

  // Build prompt with context
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

  try {
    await updateStatus(task.id, "running", `Executing on server ${server.id} (port ${server.port})`);

    const result = await new Promise((resolve, reject) => {
      const child = spawn("opencode", [
        "run",
        "--attach", `http://localhost:${server.port}`,
        "--dangerously-skip-permissions",
        "--title", `OCO: ${task.id}`,
        prompt,
      ], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env },
      });

      let stdout = "";
      let stderr = "";

      child.stdout.on("data", (d) => {
        const chunk = d.toString();
        stdout += chunk;
        server.output = stdout.slice(-2000);
        server.lastActivity = Date.now();
      });
      child.stderr.on("data", (d) => { stderr += d.toString(); server.lastActivity = Date.now(); });

      child.on("close", (code) => {
        if (code === 0) {
          const clean = stdout.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").trim();
          const lines = clean.split("\n").filter((l) => l.trim().length > 0);
          resolve(lines.join("\n"));
        } else {
          reject(new Error(`Exit ${code}: ${stderr.slice(-500)}`));
        }
      });

      child.on("error", (err) => reject(err));
    });

    await completeTask(task.id, result);
    server.tasksCompleted++;
    totalCompleted++;
  } catch (err) {
    totalFailed++;
    try { await updateStatus(task.id, "failed", err.message?.slice(0, 500)); } catch {}
  } finally {
    server.status = "idle";
    server.taskId = null;
    server.taskPrompt = null;
    server.lastActivity = Date.now();
  }
}

// ── TUI Rendering ──

const C = {
  reset: "\x1b[0m", bold: "\x1b[1m", dim: "\x1b[2m", italic: "\x1b[3m",
  red: "\x1b[31m", green: "\x1b[32m", yellow: "\x1b[33m", blue: "\x1b[34m",
  magenta: "\x1b[35m", cyan: "\x1b[36m", white: "\x1b[37m", gray: "\x1b[90m",
  bgBlack: "\x1b[40m", bgBlue: "\x1b[44m", bgGreen: "\x1b[42m",
};

function clearScreen() { process.stdout.write("\x1b[2J\x1b[H"); }
function moveTo(row, col) { process.stdout.write(`\x1b[${row};${col}H`); }
function truncate(s, max) { return s.length > max ? s.slice(0, max - 1) + "…" : s; }

function formatDuration(ms) {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m${s % 60}s`;
  return `${Math.floor(s / 3600)}h${Math.floor((s % 3600) / 60)}m`;
}

function renderHeader() {
  const now = new Date().toLocaleTimeString("en-GB");
  const uptime = formatDuration(Date.now() - startTime);
  const active = servers.filter((s) => s.status === "running").length;
  const idle = servers.filter((s) => s.status === "idle").length;
  const starting = servers.filter((s) => s.status === "starting").length;
  const crashed = servers.filter((s) => s.status === "crashed").length;

  const w = screenCols;

  // Title bar
  const title = ` OCO Pool Runner `;
  const stats = ` ${now}  Up: ${uptime}  Done: ${totalCompleted}  Failed: ${totalFailed} `;
  const pad = w - title.length - stats.length;
  process.stdout.write(
    `${C.bgBlue}${C.white}${C.bold}${title}${" ".repeat(Math.max(0, pad))}${stats}${C.reset}\n`
  );

  // Status bar
  const statusBar = ` Servers: ${C.green}${active} active${C.reset}${C.gray} │ ${C.cyan}${idle} idle${C.reset}${C.gray} │ ${C.yellow}${starting} starting${C.reset}${C.gray} │ ${C.red}${crashed} crashed${C.reset}${C.gray}  │  Pool: ${POOL_SIZE}  │  API: ${OCO_URL}${C.reset}`;
  process.stdout.write(statusBar + "\n");
  process.stdout.write(`${C.gray}${"─".repeat(w)}${C.reset}\n`);
}

function renderServers() {
  const w = screenCols;
  const now = Date.now();

  // Column headers
  const hdr = ` ${pad("ID", 4)}${pad("PORT", 7)}${pad("STATUS", 12)}${pad("PID", 8)}${pad("TASKS", 7)}${pad("ELAPSED", 10)}${pad("TASK / OUTPUT", w - 52)} `;
  process.stdout.write(`${C.gray}${C.bold}${hdr}${C.reset}\n`);

  for (const srv of servers) {
    let statusColor = C.gray;
    let statusText = srv.status;
    let elapsed = "";
    let detail = "";

    switch (srv.status) {
      case "starting":
        statusColor = C.yellow;
        statusText = "STARTING";
        elapsed = formatDuration(now - srv.startedAt);
        detail = `${C.dim}Warming up MCP servers...${C.reset}`;
        break;

      case "idle":
        statusColor = C.cyan;
        statusText = "IDLE";
        elapsed = formatDuration(now - srv.lastActivity);
        detail = `${C.dim}Waiting for task${C.reset}`;
        break;

      case "running":
        statusColor = C.green;
        statusText = "RUNNING";
        elapsed = formatDuration(now - srv.lastActivity);
        // Show task ID and last output line
        const taskShort = (srv.taskId || "").split("/").pop() || "";
        const lastLine = (srv.output || "")
          .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
          .split("\n")
          .filter((l) => l.trim())
          .pop() || "";
        detail = `${C.white}${taskShort}${C.reset} ${C.dim}${truncate(lastLine, w - 72)}${C.reset}`;
        break;

      case "crashed":
        statusColor = C.red;
        statusText = "CRASHED";
        detail = `${C.red}${srv.error || "Unknown error"}${C.reset} ${C.dim}(restarting...)${C.reset}`;
        break;
    }

    const line =
      ` ${pad(String(srv.id), 4)}` +
      `${pad(String(srv.port), 7)}` +
      `${statusColor}${pad(statusText, 12)}${C.reset}` +
      `${pad(String(srv.pid || "-"), 8)}` +
      `${pad(String(srv.tasksCompleted), 7)}` +
      `${pad(elapsed, 10)}` +
      detail;

    process.stdout.write(truncate(line.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "").length > w ? line : line, w * 3) + "\n");
  }

  process.stdout.write(`${C.gray}${"─".repeat(w)}${C.reset}\n`);
}

function renderFooter() {
  process.stdout.write(`${C.dim} Ctrl+C to stop  │  Polling every ${POLL_INTERVAL / 1000}s  │  Client: ${CLIENT_ID}${C.reset}\n`);
}

function pad(s, len) {
  return s.length >= len ? s.slice(0, len) : s + " ".repeat(len - s.length);
}

let startTime = Date.now();

function render() {
  clearScreen();
  renderHeader();
  renderServers();
  renderFooter();
}

// ── Main Loop ──

async function main() {
  // Validate
  if (!OCO_URL) { console.error("OCO_URL is not set"); process.exit(1); }
  if (!OCO_API_TOKEN) { console.error("OCO_API_TOKEN is not set"); process.exit(1); }

  startTime = Date.now();

  // Hide cursor
  process.stdout.write("\x1b[?25l");

  // Start server pool
  for (let i = 0; i < POOL_SIZE; i++) {
    startServer(i);
  }

  // Render loop
  const renderTimer = setInterval(render, 500);

  // Wait for servers to warm up
  await sleep(SERVER_WARMUP_MS + 1000);

  // Poll loop
  while (!shuttingDown) {
    try {
      const idle = getIdleServer();
      if (!idle) {
        await sleep(1000);
        continue;
      }

      const response = await poll();
      if (!response.task) {
        await sleep(POLL_INTERVAL);
        continue;
      }

      // Execute (non-blocking)
      executeTask(idle, response.task);
      await sleep(200);
    } catch (err) {
      await sleep(POLL_INTERVAL);
    }
  }

  clearInterval(renderTimer);
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

// ── Shutdown ──

process.on("SIGINT", () => {
  if (shuttingDown) process.exit(1);
  shuttingDown = true;
  process.stdout.write("\x1b[?25h"); // Show cursor
  clearScreen();
  console.log("Shutting down...");

  // Kill all servers
  for (const srv of servers) {
    if (srv.process) {
      try { srv.process.kill(); } catch {}
    }
  }

  // Wait for running tasks
  const running = servers.filter((s) => s.status === "running");
  if (running.length > 0) {
    console.log(`Waiting for ${running.length} running task(s)...`);
    const check = setInterval(() => {
      const still = servers.filter((s) => s.status === "running");
      if (still.length === 0) {
        clearInterval(check);
        console.log(`Done. ${totalCompleted} completed, ${totalFailed} failed.`);
        process.exit(0);
      }
    }, 1000);
    setTimeout(() => { console.log("Force exit."); process.exit(1); }, 30000);
  } else {
    console.log(`Done. ${totalCompleted} completed, ${totalFailed} failed.`);
    process.exit(0);
  }
});

main().catch((err) => {
  process.stdout.write("\x1b[?25h");
  console.error("Fatal:", err);
  process.exit(1);
});
