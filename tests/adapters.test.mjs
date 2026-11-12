import test from "node:test";
import assert from "node:assert/strict";
import { parseClaudeResponse } from "../src/adapters/claude.mjs";
import { parseGlmResponse } from "../src/adapters/glm.mjs";
import { parseMiniMaxResponse } from "../src/adapters/minimax.mjs";
import { parseCodexResponse } from "../src/adapters/openai.mjs";

const selection = (provider, model, apiModel = model) => ({
  provider,
  model,
  api_model: apiModel,
  account: `${provider}_account`,
  effort: "medium",
  mode: "active"
});

test("Claude parser returns only the requested model result", () => {
  const selected = selection("anthropic", "claude-sonnet-5");
  const output = parseClaudeResponse(JSON.stringify({
    is_error: false,
    subtype: "success",
    result: "ok",
    duration_ms: 12,
    total_cost_usd: 0.01,
    permission_denials: [],
    modelUsage: {
      "claude-sonnet-5": { inputTokens: 3, outputTokens: 2, cacheReadInputTokens: 1, cacheCreationInputTokens: 0 }
    }
  }), selected, 20);
  assert.equal(output.text, "ok");
  assert.equal(output.usage.total_tokens, 5);
  assert.equal(output.response_only, true);
});

test("Codex parser accepts an agent-only response", () => {
  const selected = selection("openai", "gpt-5.6-terra");
  const stdout = [
    { type: "thread.started", thread_id: "x" },
    { type: "item.completed", item: { id: "1", type: "agent_message", text: "ok" } },
    { type: "turn.completed", usage: { input_tokens: 4, output_tokens: 2, cached_input_tokens: 1 } }
  ].map(JSON.stringify).join("\n");
  const output = parseCodexResponse(stdout, "", selected, 15);
  assert.equal(output.text, "ok");
  assert.equal(output.usage.total_tokens, 6);
});

test("Codex parser rejects any tool item", () => {
  const selected = selection("openai", "gpt-5.6-terra");
  const stdout = [
    { type: "item.completed", item: { id: "1", type: "command_execution", command: "pwd" } },
    { type: "item.completed", item: { id: "2", type: "agent_message", text: "ok" } }
  ].map(JSON.stringify).join("\n");
  assert.throws(() => parseCodexResponse(stdout, "", selected, 15), { code: "RESPONSE_ONLY_VIOLATION" });
});

test("MiniMax parser ignores thinking blocks", () => {
  const selected = selection("minimax", "minimax-m2.7", "MiniMax-M2.7");
  const output = parseMiniMaxResponse({
    model: "MiniMax-M2.7",
    content: [{ type: "thinking", thinking: "private" }, { type: "text", text: "answer" }],
    usage: { input_tokens: 5, output_tokens: 3 }
  }, selected, 10);
  assert.equal(output.text, "answer");
  assert.equal(JSON.stringify(output).includes("private"), false);
});

test("MiniMax reports reasoning-only truncation explicitly", () => {
  const selected = selection("minimax", "minimax-m2.7", "MiniMax-M2.7");
  assert.throws(() => parseMiniMaxResponse({
    model: "MiniMax-M2.7",
    content: [{ type: "thinking", thinking: "private" }],
    stop_reason: "max_tokens"
  }, selected, 10), { code: "MINIMAX_OUTPUT_TRUNCATED" });
});

test("GLM parser extracts OpenAI-compatible content", () => {
  const selected = selection("glm", "glm-5.1");
  const output = parseGlmResponse({
    model: "glm-5.1",
    choices: [{ message: { content: "answer", reasoning_content: "private" } }],
    usage: { prompt_tokens: 6, completion_tokens: 2, prompt_tokens_details: { cached_tokens: 2 } }
  }, selected, 10, null, { input: 1.4, cached_input: 0.26, output: 4.4 });
  assert.equal(output.text, "answer");
  assert.equal(output.usage.total_tokens, 8);
  assert.equal(output.usage.cached_input_tokens, 2);
  assert.equal(output.cost_usd_equivalent, 0.00001492);
  assert.equal(output.cost_basis, "official_list_price_estimate");
  assert.equal(JSON.stringify(output).includes("private"), false);
});
