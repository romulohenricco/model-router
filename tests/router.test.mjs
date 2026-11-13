import test from "node:test";
import assert from "node:assert/strict";
import { loadConfig } from "../src/config.mjs";
import { routeTask } from "../src/router.mjs";

const { catalog, policy } = await loadConfig();
const route = (input) => routeTask(input, catalog, policy);

test("operational support defaults to Sonnet 5.5 medium", () => {
  const decision = route({ category: "operational_support" });
  assert.equal(decision.primary.model, "claude-sonnet-5-5");
  assert.equal(decision.primary.effort, "medium");
  assert.equal(decision.primary.account, "claude_primary");
});

test("Claude account remains sticky when session account is provided", () => {
  const decision = route({ category: "operational_support", session_account: "claude_secondary" });
  assert.equal(decision.primary.account, "claude_secondary");
});

test("standard coding uses Terra medium", () => {
  const decision = route({ category: "standard_coding" });
  assert.equal(decision.primary.model, "gpt-6.1-terra");
  assert.equal(decision.primary.effort, "medium");
});

test("mechanical coding uses Luna low", () => {
  const decision = route({ category: "mechanical_coding" });
  assert.equal(decision.primary.model, "gpt-6-luna");
  assert.equal(decision.primary.effort, "low");
});

test("documentation selects MiniMax in shadow mode with independent verifier", () => {
  const decision = route({ category: "documentation" });
  assert.equal(decision.primary.model, "minimax-m2.7");
  assert.equal(decision.primary.mode, "shadow");
  assert.equal(decision.verifier.model, "claude-sonnet-5-5");
  assert.equal(decision.requires_human_approval, true);
});

test("disabled MiniMax falls back safely", () => {
  const disabledCatalog = structuredClone(catalog);
  disabledCatalog.providers.minimax.enabled = false;
  const decision = routeTask({ category: "documentation" }, disabledCatalog, policy);
  assert.equal(decision.primary.model, "gpt-6-luna");
});

test("confidential work never routes to MiniMax or GLM", () => {
  const decision = route({ category: "documentation", sensitivity: "confidential" });
  // confidential documentation keeps the non-economical chain (fallbacks_by_sensitivity)
  assert.equal(decision.primary.model, "claude-sonnet-5-5");
  assert.notEqual(decision.primary.provider, "minimax");
  assert.notEqual(decision.primary.provider, "glm");
});

test("GLM requires approved API budget", () => {
  const withoutBudget = route({ category: "long_horizon_engineering" });
  assert.equal(withoutBudget.primary.model, "claude-sonnet-5-5");
  const approved = route({ category: "long_horizon_engineering", budget: "approved_api" });
  assert.equal(approved.primary.model, "glm-5.1");
  assert.equal(approved.primary.mode, "shadow");
  assert.equal(approved.verifier.model, "claude-sonnet-5-5");
});

test("critical or deploy work uses safe controller and independent verifier", () => {
  const decision = route({ category: "standard_coding", risk: "critical", side_effects: "deploy" });
  assert.equal(decision.primary.model, "claude-sonnet-5-5");
  assert.equal(decision.verifier.model, "gpt-6.1-sol");
  assert.equal(decision.requires_human_approval, true);
  assert.equal(decision.fail_closed, false);
});

test("critical review is independent from the author provider", () => {
  const openAiAuthored = route({ category: "critical_review", author_provider: "openai" });
  assert.equal(openAiAuthored.primary.provider, "anthropic");
  assert.equal(openAiAuthored.fail_closed, false);
  const anthropicAuthored = route({ category: "critical_review", author_provider: "anthropic" });
  assert.equal(anthropicAuthored.primary.provider, "openai");
  assert.equal(anthropicAuthored.fail_closed, false);
});

test("high risk requires human approval", () => {
  const decision = route({ category: "standard_coding", risk: "high" });
  assert.equal(decision.requires_human_approval, true);
  assert.equal(decision.verifier.model, "claude-sonnet-5-5");
});

test("unavailable provider triggers safe fallback", () => {
  const decision = route({ category: "standard_coding", unavailable: ["openai"] });
  assert.equal(decision.primary.model, "claude-sonnet-5-5");
});

test("invalid category is rejected", () => {
  assert.throws(() => route({ category: "magic" }), /Invalid category/);
});

test("verifier effort never drops below high on high risk or dangerous side effects", () => {
  for (const input of [
    { category: "operational_support", side_effects: "destructive" },
    { category: "operational_support", side_effects: "deploy" },
    { category: "documentation", risk: "critical", complexity: "simple" },
    { category: "standard_coding", risk: "high", complexity: "simple" }
  ]) {
    const decision = route(input);
    assert.ok(decision.verifier, `verifier expected for ${JSON.stringify(input)}`);
    assert.ok(["high", "xhigh", "max"].includes(decision.verifier.effort), `${JSON.stringify(input)} -> ${decision.verifier.effort}`);
  }
});

test("verifier effort floor does not lower efforts already above high", () => {
  const decision = route({ category: "deep_reasoning", risk: "high", complexity: "complex" });
  assert.equal(decision.verifier.effort, "xhigh");
});

test("verifier effort is untouched when risk is low and there is no dangerous side effect", () => {
  const decision = route({ category: "critical_review", complexity: "simple" });
  assert.equal(decision.verifier.effort, "medium");
});

test("an invalid verifier effort floor in the policy fails closed instead of disabling the floor", () => {
  const broken = structuredClone(policy);
  broken.guardrails.high_risk_verifier_min_effort = "hgih";
  assert.throws(() => routeTask({ category: "operational_support", side_effects: "destructive" }, catalog, broken), /high_risk_verifier_min_effort/);
});

test("critical or destructive work runs the primary and fallbacks at least at high effort", () => {
  for (const input of [
    { category: "documentation", risk: "critical", complexity: "simple" },
    { category: "mechanical_coding", side_effects: "destructive", complexity: "simple" },
    { category: "operational_support", side_effects: "deploy", complexity: "simple" }
  ]) {
    const decision = route(input);
    for (const s of [decision.primary, ...decision.fallbacks]) {
      assert.ok(["high", "xhigh", "max"].includes(s.effort), `${JSON.stringify(input)} ${s.model} -> ${s.effort}`);
    }
  }
  assert.equal(route({ category: "documentation", complexity: "simple", unavailable: ["minimax"] }).primary.effort, "low", "non-critical work keeps its effort");
});

test("critical or destructive work is verified by the critical verifier first", () => {
  const decision = route({ category: "mechanical_coding", side_effects: "destructive" });
  assert.equal(decision.verifier.model, policy.guardrails.critical_verifier);
  const highOnly = route({ category: "mechanical_coding", risk: "high" });
  assert.ok(highOnly.verifier, "high risk still verified");
});
