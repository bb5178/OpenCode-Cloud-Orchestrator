// ============================================================
// OCO Workflow — Lightweight durable job lifecycle tracker
// ============================================================
//
// The Workflow now serves as a durable lifecycle wrapper:
// 1. Queues the initial wave-0 tasks (no dependencies)
// 2. Waits for a single "job-complete" event
// 3. Marks the job as completed
//
// Wave advancement (queuing downstream tasks when dependencies
// are satisfied) is handled by the /api/complete handler in
// index.ts. This avoids the race condition where waitForEvent
// calls miss events that were sent before the call was registered.

import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from "cloudflare:workers";
import type { Env, WorkflowJobPayload } from "./types";
import * as db from "./db";
import { resolveWaves } from "./dag";

export class OcoJobWorkflow extends WorkflowEntrypoint<Env, WorkflowJobPayload> {
  async run(event: WorkflowEvent<WorkflowJobPayload>, step: WorkflowStep) {
    const { jobId } = event.payload;

    // Step 1: Resolve DAG and queue wave-0 tasks
    await step.do(`init-${jobId}`, async () => {
      const tasks = await db.getTasksByJob(this.env.DB, jobId);
      const taskDefs = tasks.map((t) => ({
        id: t.id,
        prompt: t.prompt,
        dependencies: t.dependencies,
      }));
      const waves = resolveWaves(taskDefs);

      // Set wave numbers on all tasks
      for (let i = 0; i < waves.length; i++) {
        for (const taskId of waves[i]) {
          await this.env.DB
            .prepare(`UPDATE tasks SET wave = ? WHERE id = ?`)
            .bind(i, taskId)
            .run();
        }
      }

      // Queue wave-0 tasks (those with no dependencies)
      const wave0 = waves[0] || [];
      if (wave0.length > 0) {
        await db.queueTasks(this.env.DB, wave0);
        for (const taskId of wave0) {
          await this.env.TASK_QUEUE.put(`queued:${taskId}`, taskId);
        }
      }
    });

    // Step 2: Wait for the job to be fully completed
    // The /api/complete handler sends this event when all tasks are done
    await step.waitForEvent(`job-done-${jobId}`, {
      type: `job-done-${jobId}`,
      timeout: "24 hours",
    });

    // Step 3: Mark job completed
    await step.do(`finalize-${jobId}`, async () => {
      await db.updateJobStatus(this.env.DB, jobId, "completed");
    });
  }
}
