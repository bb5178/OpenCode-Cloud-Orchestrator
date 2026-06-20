# OCO — OpenCode Cloud Orchestrator

A cloud-based job orchestrator for [OpenCode](https://opencode.ai) that decomposes prompts into parallel tasks with dependency management, distributes execution across multiple machines, and collects results — all with a real-time dashboard.

**Built entirely on Cloudflare:** Workers + Workflows + D1 + KV + Workers AI + Access.

## The Problem

AI coding agents (OpenCode, Claude Code, Codex, Aider) can only handle one task at a time within a session. There's no way to:

- Decompose a large task into subtasks with dependencies
- Execute subtasks in parallel across multiple sessions or machines
- Track progress with a dashboard
- Pause, resume, restart, or recover from failures
- Persist state across machine restarts or network outages

## How OCO Solves It

```
┌─────────────────────────────────────────────┐
│            Cloudflare Workers                │
│                                             │
│  Dashboard + API                            │
│  ├── POST /api/plan    → Task decomposition │
│  ├── POST /api/job     → Submit job         │
│  ├── GET  /api/poll    → Claim next task    │
│  ├── POST /api/complete → Complete task     │
│  └── GET  /            → Dashboard UI       │
│                                             │
│  Workflow   → Queues wave-0, waits for done │
│  D1         → Jobs, tasks, events, results  │
│  KV         → Fast task polling             │
│  Access     → Authentication                │
└─────────────────────────────────────────────┘
         ▲ poll + complete
    ┌────┴─────────┐
    │ Pool Runner  │  ./run-pool.sh --pool 6
    │ (local)      │  Warm opencode serve pool
    └──────────────┘
```

1. **Submit a prompt** via the dashboard or API
2. **Plan tasks** — a local OpenCode session decomposes the prompt into tasks with a dependency DAG (using your full project context, AGENTS.md, and tools)
3. **Review the plan** — see tasks, dependencies, waves. Re-plan if needed.
4. **Start the job** — wave-0 tasks (no dependencies) queue immediately
5. **Pool runner executes** — warm `opencode serve` instances pick up tasks instantly (~1s vs ~15s cold start)
6. **DAG advances automatically** — when a task completes, downstream tasks with satisfied dependencies queue up
7. **Results synthesized** — a final `_synthesize` task reads all results and produces a clean markdown document
8. **Dashboard shows everything** — real-time status, progress bars, event log, rendered results

## Features

- **Context-aware task decomposition** — planning runs through a local OpenCode session with full access to your codebase, AGENTS.md, and tools
- **Wave-based parallelism** — independent tasks run concurrently, dependent tasks wait
- **Warm server pool** — pre-warmed `opencode serve` instances eliminate cold-start overhead (15x faster)
- **htop-style TUI** — terminal dashboard showing server status, current tasks, live output per server
- **Multi-machine execution** — run multiple runners on different machines, tasks distribute automatically
- **Job lifecycle** — pause, resume, stop, restart, delete
- **Event log** — full audit trail of every state change
- **Watchdog** — detects stalled tasks (30 min no update), auto-retries or marks as stalled
- **Result synthesis** — auto-appended final task merges all results into a polished markdown document
- **Markdown rendering** — results rendered as formatted GitHub-Flavored Markdown in the dashboard
- **Generation guards** — prevents zombie processes from corrupting restarted jobs
- **Two-layer auth** — Cloudflare Access + Worker-level Bearer token

## Two Runners

OCO includes two runner implementations:

### Pool Runner (recommended)

Pre-warms `opencode serve` instances for ~1s task startup. htop-style TUI.

```bash
cp run-pool.example.sh run-pool.sh
chmod +x run-pool.sh
# Edit with your credentials

./run-pool.sh --pool 6    # 6 warm servers
./run-pool.sh --pool 4    # 4 warm servers (default)
```

```
 OCO Pool Runner                                    20:30:26  Up: 4m  Done: 5  Failed: 0
 Servers: 4 active │ 2 idle │ 0 starting │ 0 crashed  │  Pool: 6
────────────────────────────────────────────────────────────────────────────────────
 ID  PORT   STATUS      PID     TASKS  ELAPSED   TASK / OUTPUT
 0   14100  RUNNING     12685   3      15s       research-auth Analyzing JWT flow...
 1   14101  RUNNING     12688   2      14s       write-tests Generating test cases...
 2   14102  IDLE        12691   3      8s        Waiting for task
 3   14103  RUNNING     12694   1      2s        research-db Checking schema...
 4   14104  RUNNING     12697   2      5s        write-api Building endpoints...
 5   14105  IDLE        12700   1      12s       Waiting for task
```

### Cold Runner (simple)

Spawns a fresh `opencode run` per task (~15s startup). No TUI.

```bash
cp run.example.sh run.sh
chmod +x run.sh
# Edit with your credentials

./run.sh --parallel 4
./run.sh --dry-run --once
```

### Performance Comparison

| Metric | Cold Runner | Pool Runner |
|--------|-------------|-------------|
| Task startup | ~15 seconds | ~1 second |
| 20-task overhead | ~5 minutes | ~20 seconds |
| RAM per slot | Transient | ~150-300MB |
| Recommended slots | 2-4 | 4-8 per machine |

## Quick Start

### Prerequisites

- Node.js v20+
- [OpenCode](https://opencode.ai) installed
- Cloudflare account with Workers, D1, KV, Workflows, Workers AI enabled

### 1. Clone and install

```bash
git clone https://github.com/bb5178/OpenCode-Cloud-Orchestrator.git
cd OpenCode-Cloud-Orchestrator
npm install
cd mcp-server && npm install && cd ..
```

### 2. Create Cloudflare resources

```bash
export CLOUDFLARE_API_TOKEN="your-token"

# Create D1 database — note the database_id
npx wrangler d1 create oco-db

# Create KV namespace — note the id
npx wrangler kv namespace create TASK_QUEUE
```

### 3. Configure

Copy `wrangler.jsonc` to `wrangler.local.jsonc` and fill in:
- Your D1 `database_id`
- Your KV namespace `id`
- Your custom domain in `routes` (or set `workers_dev: true` for testing)

> **Important:** `wrangler.jsonc` is a public template with placeholder IDs. Always deploy with `--config wrangler.local.jsonc`. The local config is in `.gitignore`.

### 4. Run migrations

```bash
npx wrangler d1 execute oco-db --remote --config wrangler.local.jsonc --file=migrations/0001_init.sql
npx wrangler d1 execute oco-db --remote --config wrangler.local.jsonc --file=migrations/0002_advanced.sql
npx wrangler d1 execute oco-db --remote --config wrangler.local.jsonc --file=migrations/0003_model_generation.sql
```

### 5. Set the API secret

```bash
OCO_TOKEN=$(openssl rand -hex 32)
echo "Save this: $OCO_TOKEN"
printf '%s' "$OCO_TOKEN" | npx wrangler secret put OCO_API_TOKEN --config wrangler.local.jsonc
```

### 6. Deploy

```bash
npx wrangler deploy --config wrangler.local.jsonc
```

### 7. Set up authentication (recommended)

See [Security](#security) below for Cloudflare Access setup.

### 8. Configure and run the runner

```bash
# Pool runner (recommended)
cp run-pool.example.sh run-pool.sh
chmod +x run-pool.sh
# Edit run-pool.sh with your OCO_URL, OCO_API_TOKEN, Access credentials
./run-pool.sh --pool 6

# Or cold runner (simpler)
cp run.example.sh run.sh
chmod +x run.sh
./run.sh --parallel 4
```

### 9. OpenCode MCP integration (optional)

Add the OCO MCP server to your OpenCode config for in-session orchestration. See `opencode.example.jsonc` for the config snippet.

## Dashboard

The dashboard is served directly from the Worker at your configured domain.

**Job view:**
- Status badge, model tag, animated progress bar with shimmer effect
- Task count, duration, timestamps (created/started/completed)
- Action buttons: Pause, Resume, Stop, Restart, Retry Failed, Delete

**Three tabs per job:**
- **Tasks** — wave tags, dependency badges, progress text, spinner animation for running tasks
- **Event Log** — chronological audit trail with color-coded event types
- **Result** — GitHub-Flavored Markdown rendering with "Copy Markdown" button

**New Job modal:**
- Prompt textarea
- Model selector (Claude Opus 4 / Sonnet 4 / Haiku 4)
- Context-aware task planning (runs through local OpenCode with full project context)
- Task preview with dependency visualization
- Re-plan until satisfied, then Start

## Security

OCO executes prompts on your local machine via `opencode run --dangerously-skip-permissions`. **The control plane (who can submit jobs) is the critical security boundary.**

### Recommended setup: two-layer auth

**Layer 1: Cloudflare Access** — protects the custom domain at the edge
- Create an Access Application for your domain
- Add an Allow policy for your email
- Create a Service Token for the runner

**Layer 2: Worker Bearer Token** — defense-in-depth inside the Worker
- Every route (including `GET /`) checks for either an Access JWT or Bearer token
- Set via `wrangler secret put OCO_API_TOKEN`

### Important

- **Always use `--config wrangler.local.jsonc`** when deploying — the default `wrangler.jsonc` has placeholder IDs
- **Disable `workers_dev`** in production — the `*.workers.dev` URL bypasses Cloudflare Access
- **Never expose job submission** to untrusted users — submitted prompts execute with full file system access
- **Credentials in `run.sh` / `run-pool.sh`** are local-only (in `.gitignore`)

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/plan` | Create a planning task (executed by local runner with full context) |
| `GET` | `/api/plan/:id` | Check plan status and get parsed task list |
| `POST` | `/api/job` | Submit a job with tasks and dependencies |
| `GET` | `/api/poll?client=ID` | Poll for the next queued task |
| `POST` | `/api/status` | Update task status (running/failed) |
| `POST` | `/api/complete` | Complete a task and advance the DAG |
| `GET` | `/api/job/:id` | Get job status with tasks, events, result |
| `POST` | `/api/job/:id/action` | Lifecycle: pause, resume, stop, restart, delete, retry_stalled |
| `GET` | `/api/job/:id/events` | Get event log for a job |
| `GET` | `/api/board` | All jobs for dashboard |
| `POST` | `/api/watchdog` | Run stall detection |

## Architecture

| Component | Cloudflare Primitive |
|-----------|---------------------|
| API + Dashboard | Worker |
| Job lifecycle | Workflows |
| Task/job persistence | D1 (SQLite) |
| Task queue (fast poll) | KV |
| Authentication | Access + Worker secrets |
| DDoS protection | Automatic (Cloudflare edge) |

## Project Structure

```
oco/
├── src/
│   ├── index.ts         # Worker entry point, API router, auth, DAG advancement
│   ├── types.ts          # TypeScript interfaces
│   ├── db.ts             # D1 database CRUD helpers
│   ├── dag.ts            # Topological sort (dependency → waves)
│   ├── workflow.ts       # Cloudflare Workflow class
│   ├── planner.ts        # Planning prompt + synthesis prompt builders
│   └── dashboard.ts      # Dashboard HTML/JS/CSS (served from Worker)
├── mcp-server/
│   ├── index.mjs         # MCP server (6 tools for OpenCode integration)
│   └── package.json
├── migrations/
│   ├── 0001_init.sql     # Core schema: jobs + tasks
│   ├── 0002_advanced.sql # Event log, job results, lifecycle columns
│   └── 0003_model_generation.sql  # Model + generation columns
├── runner.mjs            # Cold runner (spawns opencode run per task)
├── runner-pool.mjs       # Pool runner (warm opencode serve + htop TUI)
├── run.example.sh        # Cold runner wrapper template
├── run-pool.example.sh   # Pool runner wrapper template
├── wrangler.jsonc        # Worker config template (placeholder IDs)
├── opencode.example.jsonc   # OpenCode MCP config snippet
└── .env.example          # Environment variables template
```

### Config separation

| File | On GitHub | Purpose |
|------|-----------|---------|
| `wrangler.jsonc` | Yes | Template with placeholder IDs |
| `wrangler.local.jsonc` | No (.gitignore) | Your real deploy config |
| `run.example.sh` / `run-pool.example.sh` | Yes | Runner templates |
| `run.sh` / `run-pool.sh` | No (.gitignore) | Your real runner with credentials |

## License

MIT
