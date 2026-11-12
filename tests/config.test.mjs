import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig, validateConfig } from "../src/config.mjs";

const { catalog, policy } = await loadConfig();

test("canonical config is valid", () => {
  assert.equal(validateConfig(catalog, policy), true);
  assert.equal(Object.keys(policy.routes).length, 10);
  assert.equal(catalog.providers.minimax.secret_ref.startsWith("env:"), true);
  assert.equal(catalog.providers.glm.secret_ref.startsWith("env:"), true);
  assert.equal(new URL(catalog.providers.minimax.health_url).hostname, "www.minimax.io");
  assert.equal(catalog.providers.anthropic.adapter, "claude_cli");
  assert.equal(catalog.providers.openai.adapter, "codex_cli");
  assert.equal(catalog.providers.minimax.allowed_hosts.includes("api.minimax.io"), true);
  assert.equal(catalog.providers.glm.allowed_hosts.includes("api.z.ai"), true);
});

test("inference hosts fail closed when not allowlisted", () => {
  const badCatalog = structuredClone(catalog);
  badCatalog.providers.glm.inference_url = "https://example.com/chat/completions";
  assert.throws(() => validateConfig(badCatalog, policy), /not allowlisted/);
});

test("env: secret references resolve from the environment and fail closed when unset", async () => {
  const { readSecret } = await import("../src/secrets.mjs");
  assert.equal(await readSecret("env:TEST_KEY", { env: { TEST_KEY: " abc " } }), "abc");
  await assert.rejects(() => readSecret("env:TEST_KEY", { env: {} }), /not set/);
  await assert.rejects(() => readSecret("plain-text-key"), /invalid/);
});
