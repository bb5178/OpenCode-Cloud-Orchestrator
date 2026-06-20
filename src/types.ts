// ============================================================
// OpenCode Cloud Orchestrator (OCO) — Type Definitions
// ============================================================

export interface Env {
  DB: D1Database;
  TASK_QUEUE: KVNamespace;
  OCO_WORKFLOW: Workflow;
  AI: Ai;
  OCO_API_TOKEN: string;  // Bearer token for API auth
}

// ----- Job -----

export type JobStatus = "planning" | "running" | "paused" | "stopped" | "completed" | "failed";

export interface Job {
  id: string;
  original_prompt: string;
  status: JobStatus;
  rollup_strategy: RollupStrategy;
  rollup_instruction: string | null;
  model: string;
  workflow_instance_id: string | null;
  started_at: number | null;
  created_at: number;
  updated_at: number;
  completed_at: number | null;
}

export type RollupStrategy = "sequential_merge" | "summary" | "git_branch_per_task" | "custom";

// ----- Task -----

export type TaskStatus = "pending" | "queued" | "claimed" | "running" | "completed" | "failed" | "stalled";

export interface Task {
  id: string;
  job_id: string;
  prompt: string;
  status: TaskStatus;
  wave: number;
  dependencies: string[];    // task IDs
  claimed_by: string | null;
  claimed_at: number | null;
  started_at: number | null;
  completed_at: number | null;
  result: string | null;
  model: string | null;
  error: string | null;
  progress: string | null;
  context: Record<string, unknown>;
  retry_count: number;
  max_retries: number;
  timeout_seconds: number;
  created_at: number;
  updated_at: number;
}

// ----- Event Log -----

export interface EventLogEntry {
  id: number;
  job_id: string;
  task_id: string | null;
  event_type: string;
  message: string | null;
  actor: string | null;
  created_at: number;
}

// ----- API Request/Response -----

export interface PlanJobRequest {
  prompt: string;
  model?: string;        // model for task execution (default: opus)
  taskModel?: string;    // override model per-task (default: same as job model)
}

export interface SubmitJobRequest {
  prompt: string;
  model?: string;
  tasks: TaskDefinition[];
  rollup?: {
    strategy: RollupStrategy;
    instruction: string;
  };
}

export interface TaskDefinition {
  id: string;
  prompt: string;
  dependencies?: string[];
}

export interface TaskCompleteRequest {
  taskId: string;
  result: string;
}

export interface TaskStatusUpdate {
  taskId: string;
  status: "running" | "failed";
  progress?: string;
  error?: string;
}

export interface PollResponse {
  task: Pick<Task, "id" | "job_id" | "prompt" | "context"> | null;
}

export interface JobActionRequest {
  action: "pause" | "resume" | "stop" | "restart" | "delete" | "retry_stalled";
}

export interface JobStatusResponse {
  job: Job;
  tasks: Task[];
  events: EventLogEntry[];
  result: string | null;
  summary: {
    total: number;
    pending: number;
    queued: number;
    claimed: number;
    running: number;
    completed: number;
    failed: number;
  };
}

// ----- Workflow -----

export interface WorkflowJobPayload {
  jobId: string;
}

export interface TaskResultEvent {
  taskId: string;
  result: string;
}
