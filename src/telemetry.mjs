import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// Logs default to <repo>/logs; override with MODEL_ROUTER_LOG_DIR.
export const getLogRoot = () => path.resolve(process.env.MODEL_ROUTER_LOG_DIR ?? path.join(ROOT, "logs"));

export async function logDecision(decision) {
  await mkdir(getLogRoot(), { recursive: true });
  const day = decision.decided_at.slice(0, 10);
  const safeRecord = {
    event_type: "routing_decision",
    schema_version: decision.schema_version,
    decision_id: decision.decision_id,
    decided_at: decision.decided_at,
    category: decision.category,
    constraints: decision.constraints,
    primary: decision.primary,
    verifier: decision.verifier,
    requires_human_approval: decision.requires_human_approval,
    fail_closed: decision.fail_closed
  };
  await appendFile(path.join(getLogRoot(), `${day}.jsonl`), `${JSON.stringify(safeRecord)}\n`, "utf8");
}

function safeAttempt(attempt) {
  return {
    provider: attempt.provider,
    model: attempt.model,
    account: attempt.account,
    status: attempt.status,
    duration_ms: attempt.duration_ms ?? null,
    error_code: attempt.error_code ?? null
  };
}

export function buildExecutionTelemetry(execution) {
  return {
    event_type: "model_execution",
    schema_version: 1,
    execution_id: execution.execution_id,
    decision_id: execution.decision_id ?? null,
    started_at: execution.started_at,
    completed_at: execution.completed_at,
    status: execution.status,
    execution_mode: "response_only",
    category: execution.category,
    input_chars: execution.input_chars,
    output_chars: execution.output_chars ?? 0,
    attempts: (execution.attempts ?? []).map(safeAttempt),
    primary: execution.primary ? {
      provider: execution.primary.provider,
      model: execution.primary.model,
      account: execution.primary.account,
      account_verified: execution.primary.account_verified,
      duration_ms: execution.primary.duration_ms,
      usage: execution.primary.usage,
      cost_usd_equivalent: execution.primary.cost_usd_equivalent,
      cost_basis: execution.primary.cost_basis ?? null,
      budget: execution.primary.budget ?? null,
      warning_count: execution.primary.warning_count
    } : null,
    verification: execution.verification ? {
      provider: execution.verification.provider,
      model: execution.verification.model,
      verdict: execution.verification.verdict,
      duration_ms: execution.verification.duration_ms,
      usage: execution.verification.usage
    } : null,
    error_code: execution.error_code ?? null
  };
}

export async function logExecution(execution) {
  const safeRecord = buildExecutionTelemetry(execution);
  await mkdir(getLogRoot(), { recursive: true });
  const day = execution.started_at.slice(0, 10);
  await appendFile(path.join(getLogRoot(), `${day}.jsonl`), `${JSON.stringify(safeRecord)}\n`, "utf8");
}
