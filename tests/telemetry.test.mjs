import test from "node:test";
import assert from "node:assert/strict";
import { buildExecutionTelemetry } from "../src/telemetry.mjs";

test("execution telemetry never serializes prompts or responses", () => {
  const sentinel = "DO_NOT_LOG_THIS_CONTENT";
  const record = buildExecutionTelemetry({
    execution_id: "exec",
    decision_id: "decision",
    started_at: "2026-07-31T00:00:00.000Z",
    completed_at: "2026-07-31T00:00:01.000Z",
    status: "completed",
    category: "documentation",
    input_chars: sentinel.length,
    output_chars: sentinel.length,
    prompt: sentinel,
    final_response: sentinel,
    attempts: [{ provider: "minimax", model: "minimax-m2.7", account: "minimax_default", status: "success", duration_ms: 1 }],
    primary: {
      provider: "minimax",
      model: "minimax-m2.7",
      account: "minimax_default",
      account_verified: true,
      duration_ms: 1,
      usage: { input_tokens: 1, output_tokens: 1 },
      cost_usd_equivalent: null,
      warning_count: 0,
      text: sentinel
    }
  });
  assert.equal(JSON.stringify(record).includes(sentinel), false);
  assert.equal(record.input_chars, sentinel.length);
  assert.equal(record.output_chars, sentinel.length);
});
