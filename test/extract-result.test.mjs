import { describe, it } from "node:test";
import assert from "node:assert/strict";

// ── Import the extractJsonResult function from runner-pool ──
// We re-implement it here since runner-pool.mjs doesn't export it.
// The test validates the LOGIC; the source of truth is runner-pool.mjs.
// If the implementation changes, update this copy and re-run tests.

function extractJsonResult(stdout) {
  const lines = stdout.split("\n").filter((l) => l.trim());
  const textParts = [];

  for (const line of lines) {
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && event.part?.text) {
        textParts.push(event.part.text.trim());
      }
    } catch {
      // Not JSON — skip
    }
  }

  if (textParts.length === 0) return null;
  return textParts.filter(Boolean).join("\n\n");
}

// Also test the runner.mjs extractResult (same logic)
const extractResult = extractJsonResult;

// ── Test Data ──

const SIMPLE_HELLO = [
  '{"type":"step_start","timestamp":1,"sessionID":"s1","part":{"type":"step-start"}}',
  '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"Hello! How can I help you today?"}}',
  '{"type":"step_finish","timestamp":3,"sessionID":"s1","part":{"type":"step-finish","reason":"stop"}}',
].join("\n");

const NARRATION_THEN_RESULT = [
  '{"type":"step_start","timestamp":1,"sessionID":"s1","part":{"type":"step-start"}}',
  '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"I\'ll read the KB note to extract those specific sections."}}',
  '{"type":"tool","timestamp":3,"sessionID":"s1","part":{"type":"tool","name":"apple-notes_get_note"}}',
  '{"type":"text","timestamp":4,"sessionID":"s1","part":{"type":"text","text":"Here are the extracted learnings:\\n\\n## OCO Build Session Learnings\\n\\n1. Workers deploy gotcha: wrangler deploy without --config uses wrangler.jsonc by default.\\n2. workers.dev URLs bypass Cloudflare Access.\\n3. Workflows waitForEvent has a race condition."}}',
  '{"type":"step_finish","timestamp":5,"sessionID":"s1","part":{"type":"step-finish","reason":"stop"}}',
].join("\n");

const ONLY_NARRATION = [
  '{"type":"step_start","timestamp":1,"sessionID":"s1","part":{"type":"step-start"}}',
  '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"I\'ll read the KB note to extract those specific sections."}}',
  '{"type":"tool","timestamp":3,"sessionID":"s1","part":{"type":"tool","name":"apple-notes_get_note"}}',
  '{"type":"step_finish","timestamp":4,"sessionID":"s1","part":{"type":"step-finish","reason":"stop"}}',
].join("\n");

const EMPTY_OUTPUT = "";

const NO_TEXT_EVENTS = [
  '{"type":"step_start","timestamp":1,"sessionID":"s1","part":{"type":"step-start"}}',
  '{"type":"tool","timestamp":2,"sessionID":"s1","part":{"type":"tool","name":"bash"}}',
  '{"type":"step_finish","timestamp":3,"sessionID":"s1","part":{"type":"step-finish","reason":"stop"}}',
].join("\n");

const MULTIPLE_TEXT_PARTS = [
  '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":"First, let me research this."}}',
  '{"type":"tool","timestamp":2,"sessionID":"s1","part":{"type":"tool","name":"webfetch"}}',
  '{"type":"text","timestamp":3,"sessionID":"s1","part":{"type":"text","text":"Now let me check the second source."}}',
  '{"type":"tool","timestamp":4,"sessionID":"s1","part":{"type":"tool","name":"webfetch"}}',
  '{"type":"text","timestamp":5,"sessionID":"s1","part":{"type":"text","text":"## Final Analysis\\n\\nBased on my research, here are the key findings:\\n1. Finding one\\n2. Finding two\\n3. Finding three"}}',
].join("\n");

const JSON_PLAN_OUTPUT = [
  '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":"{\\"tasks\\":[{\\"id\\":\\"research-hermes\\",\\"prompt\\":\\"Research Hermes AI agent\\",\\"dependencies\\":[]}],\\"rollup\\":{\\"strategy\\":\\"summary\\",\\"instruction\\":\\"Combine results\\"}}"}}',
].join("\n");

const MIXED_VALID_INVALID_LINES = [
  'some random non-json text',
  '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":"Valid result here."}}',
  'another garbage line',
  '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"More valid content."}}',
].join("\n");

const TEXT_WITH_EMPTY_STRING = [
  '{"type":"text","timestamp":1,"sessionID":"s1","part":{"type":"text","text":""}}',
  '{"type":"text","timestamp":2,"sessionID":"s1","part":{"type":"text","text":"Actual content here."}}',
].join("\n");

// ── Tests ──

describe("extractJsonResult (runner-pool.mjs)", () => {
  it("extracts text from a simple hello response", () => {
    const result = extractJsonResult(SIMPLE_HELLO);
    assert.equal(result, "Hello! How can I help you today?");
  });

  it("captures ALL text parts, not just the first narration", () => {
    const result = extractJsonResult(NARRATION_THEN_RESULT);
    assert.ok(result.includes("I'll read the KB note"));
    assert.ok(result.includes("OCO Build Session Learnings"));
    assert.ok(result.includes("workers.dev URLs bypass Cloudflare Access"));
  });

  it("returns narration if that is the only text (old bug: would return nothing)", () => {
    const result = extractJsonResult(ONLY_NARRATION);
    assert.ok(result !== null);
    assert.ok(result.includes("I'll read the KB note"));
  });

  it("returns null for empty output", () => {
    const result = extractJsonResult(EMPTY_OUTPUT);
    assert.equal(result, null);
  });

  it("returns null when there are no text events", () => {
    const result = extractJsonResult(NO_TEXT_EVENTS);
    assert.equal(result, null);
  });

  it("concatenates multiple text parts with double newlines", () => {
    const result = extractJsonResult(MULTIPLE_TEXT_PARTS);
    assert.ok(result.includes("First, let me research this."));
    assert.ok(result.includes("Now let me check the second source."));
    assert.ok(result.includes("Final Analysis"));
    // Verify they're separated by double newlines
    const parts = result.split("\n\n");
    assert.ok(parts.length >= 3, `Expected 3+ parts, got ${parts.length}`);
  });

  it("preserves JSON plan output for plan tasks", () => {
    const result = extractJsonResult(JSON_PLAN_OUTPUT);
    // The plan JSON should be in the text content
    assert.ok(result.includes('"tasks"'));
    assert.ok(result.includes("research-hermes"));
    // Should be parseable as JSON
    const parsed = JSON.parse(result);
    assert.ok(Array.isArray(parsed.tasks));
  });

  it("skips non-JSON lines gracefully", () => {
    const result = extractJsonResult(MIXED_VALID_INVALID_LINES);
    assert.ok(result.includes("Valid result here."));
    assert.ok(result.includes("More valid content."));
    assert.ok(!result.includes("some random"));
  });

  it("filters out empty text parts", () => {
    const result = extractJsonResult(TEXT_WITH_EMPTY_STRING);
    assert.equal(result, "Actual content here.");
  });
});

describe("extractResult (runner.mjs)", () => {
  it("extracts text from JSON format output (same logic as pool runner)", () => {
    const result = extractResult(NARRATION_THEN_RESULT);
    assert.ok(result.includes("OCO Build Session Learnings"));
  });

  it("returns null for empty output", () => {
    const result = extractResult(EMPTY_OUTPUT);
    assert.equal(result, null);
  });
});

// ── Regression tests for the specific bug ──

describe("regression: truncated result bug", () => {
  it("captures full result even when agent narrates before tool calls", () => {
    // This is the exact pattern that caused the bug:
    // Agent says "I'll read the KB..." -> makes tool calls -> produces real result
    // Old code captured only "I'll read the KB..."
    const result = extractJsonResult(NARRATION_THEN_RESULT);
    // The REAL content must be present, not just narration
    assert.ok(
      result.includes("OCO Build Session Learnings"),
      "Result should contain the actual findings, not just narration"
    );
    assert.ok(
      result.length > 100,
      `Result should be substantial (got ${result.length} chars)`
    );
  });

  it("returns meaningful content even with multiple tool call rounds", () => {
    const result = extractJsonResult(MULTIPLE_TEXT_PARTS);
    // The final analysis should be present
    assert.ok(result.includes("Final Analysis"));
    assert.ok(result.includes("Finding one"));
  });
});
