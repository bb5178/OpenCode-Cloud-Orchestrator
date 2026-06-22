import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Re-implement the plan parsing logic from src/index.ts (lines 514-547) ──
// This tests the JSON extraction strategies used by handleGetPlan.

function parsePlanOutput(raw) {
  let parsed = null;

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

  // Strategy 3: Find the largest JSON object via brace matching
  if (!parsed) {
    const jsonObjects = [];
    let depth = 0, start = -1;
    for (let i = 0; i < raw.length; i++) {
      if (raw[i] === '{') { if (depth === 0) start = i; depth++; }
      if (raw[i] === '}') { depth--; if (depth === 0 && start >= 0) { jsonObjects.push(raw.slice(start, i + 1)); start = -1; } }
    }
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

  return parsed;
}

// ── Test Data ──

const CLEAN_JSON = JSON.stringify({
  tasks: [
    { id: "research-hermes", prompt: "Research Hermes AI", dependencies: [] },
    { id: "research-opencode", prompt: "Research OpenCode", dependencies: [] },
    { id: "compare", prompt: "Compare all agents", dependencies: ["research-hermes", "research-opencode"] },
  ],
  rollup: { strategy: "summary", instruction: "Combine into comparison table" },
});

const FENCED_JSON = `Here's my plan:

\`\`\`json
${CLEAN_JSON}
\`\`\`

This should work well for the research task.`;

const FENCED_NO_LANG = `\`\`\`
${CLEAN_JSON}
\`\`\``;

const JSON_WITH_NARRATION = `I'll decompose this into parallel research tasks.

${CLEAN_JSON}

That covers all the agents you mentioned.`;

const MULTIPLE_JSON_OBJECTS = `Some config: {"key": "value"}

And the actual plan:
${CLEAN_JSON}

Done.`;

const DEEPLY_NESTED_JSON = JSON.stringify({
  tasks: [
    {
      id: "task-with-braces",
      prompt: 'Write a function that returns {"key": "value"} as output',
      dependencies: [],
    },
  ],
  rollup: { strategy: "summary", instruction: "Combine results" },
});

const EMPTY_STRING = "";
const PURE_NARRATION = "I'll research these AI agents and create a comparison. Let me start by looking at each one.";
const NO_TASKS_ARRAY = '{"rollup": {"strategy": "summary"}, "items": [1, 2, 3]}';

// ── Tests ──

describe("parsePlanOutput — Strategy 1: raw JSON", () => {
  it("parses clean JSON directly", () => {
    const result = parsePlanOutput(CLEAN_JSON);
    assert.ok(Array.isArray(result.tasks));
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0].id, "research-hermes");
  });

  it("parses JSON with leading/trailing whitespace", () => {
    const result = parsePlanOutput(`  \n${CLEAN_JSON}\n  `);
    assert.equal(result.tasks.length, 3);
  });
});

describe("parsePlanOutput — Strategy 2: markdown fences", () => {
  it("extracts from ```json ... ``` fences", () => {
    const result = parsePlanOutput(FENCED_JSON);
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0].id, "research-hermes");
  });

  it("extracts from ``` ... ``` fences (no language tag)", () => {
    const result = parsePlanOutput(FENCED_NO_LANG);
    assert.equal(result.tasks.length, 3);
  });
});

describe("parsePlanOutput — Strategy 3: brace matching", () => {
  it("finds JSON embedded in narration text", () => {
    const result = parsePlanOutput(JSON_WITH_NARRATION);
    assert.equal(result.tasks.length, 3);
  });

  it("picks the largest JSON object with a tasks array", () => {
    const result = parsePlanOutput(MULTIPLE_JSON_OBJECTS);
    assert.equal(result.tasks.length, 3);
    assert.equal(result.tasks[0].id, "research-hermes");
  });

  it("handles JSON with braces in string values", () => {
    const result = parsePlanOutput(DEEPLY_NESTED_JSON);
    assert.equal(result.tasks.length, 1);
    assert.ok(result.tasks[0].prompt.includes("{"));
  });
});

describe("parsePlanOutput — failure cases", () => {
  it("throws on empty string", () => {
    assert.throws(
      () => parsePlanOutput(EMPTY_STRING),
      /No valid JSON with 'tasks' array found/
    );
  });

  it("throws on pure narration with no JSON", () => {
    assert.throws(
      () => parsePlanOutput(PURE_NARRATION),
      /No valid JSON with 'tasks' array found/
    );
  });

  it("throws on JSON without tasks array", () => {
    assert.throws(
      () => parsePlanOutput(NO_TASKS_ARRAY),
      /No valid JSON with 'tasks' array found/
    );
  });
});

// ── Integration: extractJsonResult -> parsePlanOutput pipeline ──

describe("end-to-end: JSON format output -> plan parsing", () => {
  // Simulate the full pipeline: opencode --format json output -> extractJsonResult -> parsePlanOutput

  function extractJsonResult(stdout) {
    const lines = stdout.split("\n").filter((l) => l.trim());
    const textParts = [];
    for (const line of lines) {
      try {
        const event = JSON.parse(line);
        if (event.type === "text" && event.part?.text) {
          textParts.push(event.part.text.trim());
        }
      } catch {}
    }
    if (textParts.length === 0) return null;
    return textParts.filter(Boolean).join("\n\n");
  }

  it("parses plan from agent that outputs clean JSON as text", () => {
    const jsonOutput = [
      `{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":${JSON.stringify(CLEAN_JSON)}}}`,
    ].join("\n");

    const extracted = extractJsonResult(jsonOutput);
    const plan = parsePlanOutput(extracted);
    assert.equal(plan.tasks.length, 3);
  });

  it("parses plan from agent that narrates then outputs JSON", () => {
    const jsonOutput = [
      '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":"Let me plan this out."}}',
      `{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":${JSON.stringify(CLEAN_JSON)}}}`,
    ].join("\n");

    const extracted = extractJsonResult(jsonOutput);
    const plan = parsePlanOutput(extracted);
    assert.equal(plan.tasks.length, 3);
  });

  it("parses plan from agent that wraps JSON in markdown fences inside text", () => {
    const fencedContent = "```json\n" + CLEAN_JSON + "\n```";
    const jsonOutput = [
      `{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":${JSON.stringify(fencedContent)}}}`,
    ].join("\n");

    const extracted = extractJsonResult(jsonOutput);
    const plan = parsePlanOutput(extracted);
    assert.equal(plan.tasks.length, 3);
  });
});
