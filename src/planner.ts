// ============================================================
// OCO Planner — Decompose a prompt into tasks using Workers AI
// ============================================================

import type { TaskDefinition } from "./types";

const SYSTEM_PROMPT = `You are a task planner for an AI coding agent orchestrator. Given a user prompt, decompose it into discrete, executable tasks with dependencies.

Rules:
1. Each task should be a self-contained unit of work that an AI agent can complete independently.
2. Use clear, descriptive task IDs (lowercase, hyphens, no spaces). E.g. "research-auth", "write-tests", "refactor-api".
3. Define dependencies — a task can only start after its dependencies complete. Results from dependencies are automatically passed as context.
4. Maximize parallelism — tasks with no dependency relationship should be in different independent chains.
5. Typically decompose into 3-20 tasks depending on complexity. Simple prompts may need just 1-3 tasks.
6. Each task prompt should be detailed enough for an AI agent to execute without ambiguity.

Respond with ONLY valid JSON in this exact format (no markdown, no explanation):
{
  "tasks": [
    {"id": "task-id", "prompt": "Detailed instruction for this task", "dependencies": []},
    {"id": "task-id-2", "prompt": "Detailed instruction", "dependencies": ["task-id"]}
  ],
  "rollup": {
    "strategy": "summary",
    "instruction": "How to combine the results"
  }
}

Rollup strategies: "summary" (synthesize results), "sequential_merge" (combine file changes in order), "custom" (use the instruction as-is).`;

export async function planJob(
  ai: Ai,
  prompt: string
): Promise<{ tasks: TaskDefinition[]; rollup: { strategy: string; instruction: string } }> {
  const response: any = await ai.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any, {
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    max_tokens: 4096,
    temperature: 0.3,
  });

  // Workers AI chat models can return various shapes — debug first
  const raw = JSON.stringify(response);
  let text = "";
  if (typeof response === "string") {
    text = response;
  } else if (typeof response?.response === "string") {
    text = response.response;
  } else if (response?.choices?.[0]?.message?.content) {
    text = response.choices[0].message.content;
  } else {
    // Try to find any string value recursively
    const findString = (obj: any): string | null => {
      if (typeof obj === "string" && obj.length > 20) return obj;
      if (Array.isArray(obj)) { for (const v of obj) { const r = findString(v); if (r) return r; } }
      if (obj && typeof obj === "object") { for (const v of Object.values(obj)) { const r = findString(v); if (r) return r; } }
      return null;
    };
    text = findString(response) || "";
    if (!text) {
      throw new Error(`No text in AI response. Keys: ${Object.keys(response || {}).join(",")}. Raw: ${raw.slice(0, 500)}`);
    }
  }

  // Extract JSON from response (handle possible markdown wrapping)
  let jsonStr = text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (jsonMatch) {
    jsonStr = jsonMatch[1].trim();
  }
  // Also try to find raw JSON object
  const objMatch = jsonStr.match(/\{[\s\S]*\}/);
  if (objMatch) {
    jsonStr = objMatch[0];
  }

  try {
    const parsed = JSON.parse(jsonStr);
    if (!parsed.tasks || !Array.isArray(parsed.tasks) || parsed.tasks.length === 0) {
      throw new Error("No tasks in plan");
    }

    // Validate and normalize tasks
    const tasks: TaskDefinition[] = parsed.tasks.map((t: any, i: number) => ({
      id: t.id || `task-${i + 1}`,
      prompt: t.prompt || "",
      dependencies: Array.isArray(t.dependencies) ? t.dependencies : [],
    }));

    const rollup = parsed.rollup || {
      strategy: "summary",
      instruction: "Summarize the results of all completed tasks.",
    };

    // Auto-append synthesis task that depends on ALL other tasks
    // Use a placeholder ID — the submit handler will prefix it with jobId
    const allTaskIds = tasks.map((t) => t.id);
    tasks.push({
      id: "_synthesize",
      prompt: buildSynthesisPrompt(prompt, allTaskIds),
      dependencies: allTaskIds,
    });
    // Note: _synthesize ID will be prefixed with jobId in handleSubmitJob

    return { tasks, rollup };
  } catch (err) {
    throw new Error(`Failed to parse AI plan: ${err}. Raw response: ${text.slice(0, 500)}`);
  }
}

/**
 * Build the prompt for the final synthesis task.
 */
export function buildSynthesisPrompt(originalPrompt: string, taskIds: string[]): string {
  return `You are the final synthesis step for this job. The original request was:

"${originalPrompt}"

You have received the results from all ${taskIds.length} tasks as context.

CRITICAL RULES:
- Do NOT use any tools. Do NOT search, fetch, read files, or browse the web. Everything you need is in the context below.
- Do NOT narrate your process. Do NOT say "I'll start by..." or "Let me check...". Just produce the document.
- If a task result is incomplete or missing, note the gap briefly and move on. Do NOT try to fill it yourself.

Your job is to:

1. READ all the task results provided in the context carefully
2. SYNTHESIZE them into a single, well-structured, professional document
3. FORMAT the output as clean Markdown with:
   - A clear title and executive summary at the top
   - Logical section headings (##, ###) organized by topic, NOT by task ID
   - Merged and deduplicated content — don't just concatenate task outputs
   - Consistent terminology and tone throughout
   - Tables where comparisons are being made
   - Code blocks where code examples exist
   - A conclusion or summary section at the end
4. REMOVE any meta-commentary about tasks, waves, or orchestration — the reader should see a polished document, not task outputs
5. VERIFY that all key topics from the original request are covered

Output ONLY the final document. Start writing immediately.`;
}
