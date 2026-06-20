// ============================================================
// DAG Resolution — resolve task dependencies into execution waves
// ============================================================

import type { TaskDefinition } from "./types";

/**
 * Given a list of tasks with dependency edges, return ordered waves.
 * Each wave contains task IDs that can run in parallel.
 * Throws on circular dependencies.
 */
export function resolveWaves(tasks: TaskDefinition[]): string[][] {
  const taskMap = new Map<string, TaskDefinition>();
  for (const t of tasks) {
    taskMap.set(t.id, t);
  }

  const waves: string[][] = [];
  const resolved = new Set<string>();
  const remaining = new Set(taskMap.keys());

  while (remaining.size > 0) {
    const wave: string[] = [];
    for (const id of remaining) {
      const task = taskMap.get(id)!;
      const deps = task.dependencies ?? [];
      if (deps.every((dep) => resolved.has(dep))) {
        wave.push(id);
      }
    }

    if (wave.length === 0) {
      throw new Error(
        `Circular dependency detected among tasks: ${[...remaining].join(", ")}`
      );
    }

    for (const id of wave) {
      resolved.add(id);
      remaining.delete(id);
    }
    waves.push(wave);
  }

  return waves;
}
