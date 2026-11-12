import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { dispatchTask } from "../src/dispatcher.mjs";

const { catalog, policy } = await loadConfig();

function resultFor(selection, text) {
  return {
    ...selection,
    account_verified: true,
    text,
    usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 },
    duration_ms: 5,
    cost_usd_equivalent: null,
    warning_count: 0,
    response_only: true
  };
}

const noLog = async () => {};

test("shadow dispatch is blocked without explicit approval", async () => {
  await assert.rejects(
    dispatchTask({ category: "documentation" }, "request", catalog, policy, {
      invoke: async () => assert.fail("provider must not run"),
      executionLogger: noLog
    }),
    { code: "SHADOW_APPROVAL_REQUIRED" }
  );
});

test("approved MiniMax dispatch is independently verified", async () => {
  const calls = [];
  const output = await dispatchTask({ category: "documentation" }, "request", catalog, policy, {
    approveShadow: true,
    executionLogger: noLog,
    invoke: async ({ selection }) => {
      calls.push(selection.model);
      if (selection.provider === "minimax") return resultFor(selection, "candidate");
      return resultFor(selection, '{"verdict":"approve","summary":"ok","corrected_response":null}');
    }
  });
  assert.deepEqual(calls, ["minimax-m2.7", "claude-sonnet-5-5"]);
  assert.equal(output.status, "completed");
  assert.equal(output.final_response, "candidate");
  assert.equal(output.verification.verdict, "approve");
});

test("high-risk dispatch requires human approval", async () => {
  await assert.rejects(
    dispatchTask({ category: "standard_coding", risk: "high" }, "request", catalog, policy, {
      invoke: async () => assert.fail("provider must not run"),
      executionLogger: noLog
    }),
    { code: "HUMAN_APPROVAL_REQUIRED" }
  );
});

test("verifier revision becomes the only final response", async () => {
  const output = await dispatchTask({ category: "documentation" }, "request", catalog, policy, {
    approveShadow: true,
    executionLogger: noLog,
    invoke: async ({ selection }) => selection.provider === "minimax"
      ? resultFor(selection, "candidate")
      : resultFor(selection, '{"verdict":"revise","summary":"fix","corrected_response":"corrected"}')
  });
  assert.equal(output.final_response, "corrected");
  assert.equal(JSON.stringify(output).includes('"text":"candidate"'), false);
});

test("provider failure reroutes through deterministic fallback", async () => {
  const calls = [];
  const output = await dispatchTask({ category: "standard_coding" }, "request", catalog, policy, {
    executionLogger: noLog,
    invoke: async ({ selection }) => {
      calls.push(selection.model);
      if (selection.model === "gpt-6.1-terra") throw Object.assign(new Error("down"), { code: "TEST_DOWN", retryable: true });
      return resultFor(selection, "fallback");
    }
  });
  assert.deepEqual(calls, ["gpt-6.1-terra", "claude-sonnet-5-5"]);
  assert.equal(output.final_response, "fallback");
  assert.equal(output.attempts[0].error_code, "TEST_DOWN");
});

test("rejected verification fails closed without candidate output", async () => {
  const output = await dispatchTask({ category: "documentation" }, "request", catalog, policy, {
    approveShadow: true,
    executionLogger: noLog,
    invoke: async ({ selection }) => selection.provider === "minimax"
      ? resultFor(selection, "candidate")
      : resultFor(selection, '{"verdict":"reject","summary":"unsafe","corrected_response":null}')
  });
  assert.equal(output.status, "verification_rejected");
  assert.equal(output.final_response, null);
  assert.equal(JSON.stringify(output).includes('"text":"candidate"'), false);
});
