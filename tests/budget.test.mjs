import test from "node:test";
import assert from "node:assert/strict";
import { calculateBudgetSnapshot } from "../src/budget.mjs";
import { estimateTokenCostUsd } from "../src/cost.mjs";

const control = {
  currency: "USD",
  accounting: "local_estimate_only",
  funded_amount_usd: 10,
  soft_alert_remaining_usd: 5,
  critical_alert_remaining_usd: 2,
  hard_stop_remaining_usd: 1,
  tracking_started_at: "2026-01-01T00:00:00Z",
  reconcile_at: "https://z.ai/manage-apikey/billing"
};

test("token cost separates cached input from regular input", () => {
  assert.equal(estimateTokenCostUsd(
    { input_tokens: 1_000_000, cached_input_tokens: 250_000, output_tokens: 100_000 },
    { input: 1.4, cached_input: 0.26, output: 4.4 }
  ), 1.555);
});

test("budget thresholds fail closed at the reserve", () => {
  assert.equal(calculateBudgetSnapshot(control, 4).status, "healthy");
  assert.equal(calculateBudgetSnapshot(control, 6).status, "warning");
  assert.equal(calculateBudgetSnapshot(control, 8.5).status, "critical");
  assert.equal(calculateBudgetSnapshot(control, 9).status, "blocked");
});
