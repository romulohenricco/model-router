import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { applyAnswers, detectEnvironment } from "../src/init.mjs";
import { loadUpdatePolicy } from "../src/updates.mjs";
import { routeTask } from "../src/router.mjs";

const { catalog, policy } = await loadConfig();
const updatePolicy = await loadUpdatePolicy();

test("init answers disable missing providers and keep routing valid", () => {
  const { catalog: c, updatePolicy: u } = applyAnswers(catalog, policy, updatePolicy, {
    providers: ["anthropic"], secrets: "env", update_mode: "weekly", update_apply: "recommend_only"
  });
  assert.equal(c.providers.openai.enabled, false);
  assert.equal(c.providers.minimax.enabled, false);
  assert.equal(u.interval_hours, 168);
  assert.equal(u.apply, "recommend_only");
  assert.deepEqual(u.sources.openai, []);
  const decision = routeTask({ category: "standard_coding" }, c, policy);
  assert.equal(decision.primary.provider, "anthropic");
});

test("init can switch secrets to 1Password references", () => {
  const { catalog: c } = applyAnswers(catalog, policy, updatePolicy, {
    providers: ["anthropic", "glm"], secrets: "1password", glm_ref: "op://vault/item/field", update_mode: "off", update_apply: "direct_successors"
  });
  assert.equal(c.providers.glm.secret_ref, "op://vault/item/field");
});

test("environment detection never throws", () => {
  const env = detectEnvironment();
  assert.equal(typeof env.claude.installed, "boolean");
});

test("route coverage reports routes that a single provider cannot serve", async () => {
  const { routeCoverage } = await import("../src/init.mjs");
  const { catalog: c } = applyAnswers(catalog, policy, updatePolicy, { providers: ["anthropic"], secrets: "env", update_mode: "daily", update_apply: "direct_successors" });
  const cov = routeCoverage(c, policy);
  assert.ok(cov.fail_closed.some((x) => x.startsWith("critical_review")));
  const full = routeCoverage(catalog, policy);
  assert.equal(full.broken.filter((x) => !x.startsWith("long_horizon")).length, 0);
});
