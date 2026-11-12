import { appendFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { RouterError } from "./errors.mjs";

import { getLogRoot } from "./telemetry.mjs";

const budgetRoot = () => path.join(getLogRoot(), "budget");

function roundUsd(value) {
  return Number(value.toFixed(8));
}

export function calculateBudgetSnapshot(control, spentUsd = 0) {
  if (!control) return null;
  const spent = Math.max(0, Number(spentUsd) || 0);
  const remaining = Math.max(0, control.funded_amount_usd - spent);
  let status = "healthy";
  if (remaining <= control.hard_stop_remaining_usd) status = "blocked";
  else if (remaining <= control.critical_alert_remaining_usd) status = "critical";
  else if (remaining <= control.soft_alert_remaining_usd) status = "warning";
  return {
    currency: control.currency,
    accounting: control.accounting,
    funded_amount_usd: control.funded_amount_usd,
    estimated_spend_usd: roundUsd(spent),
    estimated_remaining_usd: roundUsd(remaining),
    status,
    tracking_started_at: control.tracking_started_at,
    reconcile_at: control.reconcile_at
  };
}

async function readEstimatedSpend(providerId, control) {
  const ledgerPath = path.join(budgetRoot(), `${providerId}.jsonl`);
  let text;
  try {
    text = await readFile(ledgerPath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return 0;
    throw new RouterError("BUDGET_LEDGER_UNREADABLE", "Provider budget ledger could not be read");
  }

  let total = 0;
  for (const line of text.split(/\r?\n/).filter(Boolean)) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      throw new RouterError("BUDGET_LEDGER_INVALID", "Provider budget ledger contains invalid JSON");
    }
    if (event.provider !== providerId
      || Date.parse(event.recorded_at) < Date.parse(control.tracking_started_at)) continue;
    if (Number.isFinite(event.cost_usd_equivalent)) total += event.cost_usd_equivalent;
  }
  return total;
}

export async function getProviderBudget(providerId, provider) {
  if (!provider.budget_control) return null;
  return calculateBudgetSnapshot(
    provider.budget_control,
    await readEstimatedSpend(providerId, provider.budget_control)
  );
}

export async function assertProviderBudget(providerId, provider) {
  const snapshot = await getProviderBudget(providerId, provider);
  if (snapshot?.status === "blocked") {
    throw new RouterError("PROVIDER_BUDGET_BLOCKED", "Provider API credit reserve reached its local hard stop");
  }
  return snapshot;
}

export async function recordProviderCost(providerId, provider, result, { executionId, role }) {
  if (!provider.budget_control || !Number.isFinite(result.cost_usd_equivalent)) return null;
  const before = await getProviderBudget(providerId, provider);
  const event = {
    event_type: "provider_cost_estimate",
    schema_version: 1,
    recorded_at: new Date().toISOString(),
    execution_id: executionId,
    role,
    provider: providerId,
    model: result.model,
    usage: result.usage,
    cost_usd_equivalent: result.cost_usd_equivalent,
    cost_basis: result.cost_basis
  };
  await mkdir(budgetRoot(), { recursive: true });
  await appendFile(path.join(budgetRoot(), `${providerId}.jsonl`), `${JSON.stringify(event)}\n`, "utf8");
  return calculateBudgetSnapshot(
    provider.budget_control,
    before.estimated_spend_usd + result.cost_usd_equivalent
  );
}
