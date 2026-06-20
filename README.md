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
│  ├── POST /api/plan    → AI decomposition   │
│  ├── POST /api/job     → Submit job         │
│  ├── GET  /api/poll    → Claim next task    │
│  ├── POST /api/complete → Complete task     │
│  └── GET  /            → Dashboard UI       │
│                                             │
│  Workflow   → Queues wave-0, waits for done │
│  D1         → Jobs, tasks, events, results  │
│  KV         → Fast task polling             │
│  Workers AI → Prompt decomposition (Llama)  │
│  Access     → Authentication                │
└─────────────────────────────────────────────┘
         ▲ poll + complete
    ┌────┴─────┐
    │ Runner   │  ./run.sh --parallel 4
    │ (local)  │  Spawns: opencode run <prompt>
    └──────────┘
```

1. **Submit a prompt** via the dashboard or API
2. **AI decomposes** it into tasks with a dependency DAG (using Workers AI / Llama 3.3 70B)
3. **Review the plan** — see tasks, dependencies, waves. Re-plan if needed.
4. **Start the job** — wave-0 tasks (no dependencies) queue immediately
5. **Runner polls and executes** — local `run.sh` script polls for tasks, spawns `opencode run` for each
6. **DAG advances automatically** — when a task completes, downstream tasks with satisfied dependencies queue up
7. **Results synthesized** — a final `_synthesize` task reads all results and produces a clean document
8. **Dashboard shows everything** — real-time status, progress bars, event log, rendered results

## Features

- **Automatic task decomposition** — single prompt → AI generates tasks with dependency DAG
- **Wave-based parallelism** — independent tasks run concurrently, dependent tasks wait
- **Multi-machine execution** — run multiple runners on different machines, tasks distribute automatically
- **Job lifecycle** — pause, resume, stop, restart, delete
- **Event log** — full audit trail of every state change
- **Watchdog** — detects stalled tasks (30 min no update), auto-retries or marks as stalled
- **Result synthesis** — auto-appended final task merges all results into a polished document
- **Markdown rendering** — results rendered as formatted markdown in the dashboard
- **Generation guards** — prevents zombie processes from corrupting restarted jobs
- **Two-layer auth** — Cloudflare Access + Worker-level Bearer token

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

# Create D1 database
npx wrangler d1 create oco-db
# Note the database_id from the output

# Create KV namespace
npx wrangler kv namespace create TASK_QUEUE
# Note the id from the output
```

### 3. Configure

Update `wrangler.jsonc` with:
- Your D1 `database_id`
- Your KV namespace `id`
- Your custom domain in `routes` (or remove routes and set `workers_dev: true` for testing)

### 4. Run migrations

```bash
npx wrangler d1 execute oco-db --remote --file=migrations/0001_init.sql
npx wrangler d1 execute oco-db --remote --file=migrations/0002_advanced.sql
npx wrangler d1 execute oco-db --remote --file=migrations/0003_model_generation.sql
```

### 5. Set the API secret

```bash
# Generate a random token
OCO_TOKEN=$(openssl rand -hex 32)
echo "Save this: $OCO_TOKEN"

# Store as Worker secret
printf '%s' "$OCO_TOKEN" | npx wrangler secret put OCO_API_TOKEN
```

### 6. Deploy

```bash
npx wrangler deploy
```

### 7. Set up authentication (recommended)

See [Security](#security) below for Cloudflare Access setup.

### 8. Configure the runner

```bash
cp run.example.sh run.sh
chmod +x run.sh
# Edit run.sh with your OCO_URL, OCO_API_TOKEN, and Access credentials
```

### 9. Run

```bash
# Start the runner
./run.sh --parallel 4

# Or dry-run to preview
./run.sh --dry-run --once
```

### 10. OpenCode MCP integration (optional)

Add the OCO MCP server to your OpenCode config for in-session orchestration. See `opencode.example.jsonc` for the config snippet.

## Dashboard

The dashboard is served directly from the Worker at your configured domain.

**Job view:**
- Status badge, model tag, animated progress bar
- Task count, duration, timestamps (created/started/completed)
- Action buttons: Pause, Resume, Stop, Restart, Retry Failed, Delete

**Three tabs per job:**
- **Tasks** — wave tags, dependency badges, progress, spinner animation for running tasks
- **Event Log** — chronological audit trail with color-coded event types
- **Result** — markdown-rendered final output with "Copy Markdown" button

**New Job modal:**
- Prompt textarea
- Model selector (Claude Opus 4 / Sonnet 4 / Haiku 4)
- AI-powered task planning with dependency preview
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

- **Disable `workers_dev`** in production — the `*.workers.dev` URL bypasses Cloudflare Access
- **Never expose job submission** to untrusted users — submitted prompts execute with full file system access
- **Credentials in `run.sh`** are local-only (file is in `.gitignore`)

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/api/plan` | Decompose a prompt into tasks using AI |
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
| Prompt decomposition | Workers AI (Llama 3.3 70B) |
| Authentication | Access + Worker secrets |
| DDoS protection | Automatic (Cloudflare edge) |

## Project Structure

```
oco/
├── src/
│   ├── index.ts        # Worker entry point, API router, auth, DAG advancement
│   ├── types.ts         # TypeScript interfaces
│   ├── db.ts            # D1 database CRUD helpers
│   ├── dag.ts           # Topological sort (dependency → waves)
│   ├── workflow.ts      # Cloudflare Workflow class
│   ├── planner.ts       # Workers AI prompt decomposition
│   └── dashboard.ts     # Dashboard HTML/JS/CSS
├── mcp-server/
│   ├── index.mjs        # MCP server (6 tools for OpenCode)
│   └── package.json
├── migrations/
│   ├── 0001_init.sql
│   ├── 0002_advanced.sql
│   └── 0003_model_generation.sql
├── runner.mjs           # Task runner (polls + spawns opencode)
├── run.example.sh       # Runner wrapper template
├── wrangler.jsonc       # Worker configuration (template)
├── opencode.example.jsonc  # OpenCode MCP config snippet
└── .env.example         # Environment variables template
```

## License

MIT
