import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { dispatchTask } from "../src/dispatcher.mjs";
import { RouterError } from "../src/errors.mjs";
import { parseVerifierResponse } from "../src/verifier.mjs";

const { catalog, policy } = await loadConfig();
const noLog = async () => {};

function ok(selection, text) {
  return { provider: selection.provider, model: selection.model, api_model: selection.api_model, account: selection.account, text, usage: {}, duration_ms: 1, warning_count: 0 };
}

test("a missing CLI marks the whole provider unavailable and unapproved shadow fallbacks are skipped", async () => {
  const calls = [];
  const output = await dispatchTask({ category: "mechanical_coding" }, "request", catalog, policy, {
    executionLogger: noLog,
    invoke: async ({ selection }) => {
      calls.push(selection.model);
      if (selection.provider === "openai") throw new RouterError("PROCESS_START_FAILED", "codex not installed");
      return ok(selection, "done");
    }
  });
  assert.deepEqual(calls, ["gpt-6-luna", "claude-sonnet-5-5"]);
  assert.equal(output.final_response, "done");
});

test("a failing verifier falls back to the next independent verifier", async () => {
  const calls = [];
  const output = await dispatchTask({ category: "deep_reasoning", risk: "high" }, "request", catalog, policy, {
    approve: true,
    executionLogger: noLog,
    invoke: async ({ selection }) => {
      calls.push(selection.model);
      if (selection.model === "claude-sonnet-5-5") throw new RouterError("PROCESS_TIMEOUT", "slow", { retryable: true });
      if (selection.model === "gpt-6-astra") return ok(selection, "answer");
      return ok(selection, JSON.stringify({ verdict: "approve", summary: "fine", corrected_response: null }));
    }
  });
  assert.deepEqual(calls, ["gpt-6-astra", "claude-sonnet-5-5", "claude-opus-5-5"]);
  assert.equal(output.verification.model, "claude-opus-5-5");
  assert.equal(output.final_response, "answer");
});

test("no remaining independent verifier fails closed", async () => {
  await assert.rejects(() => dispatchTask({ category: "standard_coding", risk: "high" }, "request", catalog, policy, {
    approve: true,
    executionLogger: noLog,
    invoke: async ({ selection }) => {
      if (selection.provider === "anthropic") throw new RouterError("PROCESS_START_FAILED", "claude not installed");
      return ok(selection, "answer");
    }
  }), (error) => ["VERIFIER_UNAVAILABLE", "ALL_PROVIDERS_FAILED"].includes(error.code));
});

test("verifier output must be a JSON object", () => {
  assert.throws(() => parseVerifierResponse("null"), /non-object/);
  assert.throws(() => parseVerifierResponse("[1,2]"), /non-object|invalid/);
});
