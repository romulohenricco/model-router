import { randomUUID } from "node:crypto";
import { invokeModel } from "./adapters/index.mjs";
import { RouterError, publicError } from "./errors.mjs";
import { routeTask } from "./router.mjs";
import { logDecision, logExecution } from "./telemetry.mjs";
import { buildVerifierPrompt, parseVerifierResponse, VERIFIER_SYSTEM } from "./verifier.mjs";
import { assertProviderBudget, recordProviderCost } from "./budget.mjs";

const MAX_PROMPT_CHARS = 500_000;

function validatePrompt(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    throw new RouterError("PROMPT_REQUIRED", "Dispatch requires a non-empty prompt on stdin");
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    throw new RouterError("PROMPT_TOO_LARGE", "Dispatch prompt exceeds the response-only limit");
  }
}

function needsCriticalApproval(decision, policy) {
  const highRisks = policy?.guardrails?.high_risks ?? ["high", "critical"];
  const dangerous = policy?.guardrails?.dangerous_side_effects ?? ["deploy", "destructive"];
  return highRisks.includes(decision.constraints.risk) || dangerous.includes(decision.constraints.side_effects);
}

const PROVIDER_LEVEL_FAILURES = new Set(["PROCESS_START_FAILED", "CREDENTIAL_READ_FAILED", "SECRET_REFERENCE_INVALID"]);

function enforceDecision(decision, { approve, approveShadow, policy }) {
  if (decision.fail_closed) {
    throw new RouterError("ROUTE_FAIL_CLOSED", "No independent verifier is available for this route");
  }
  if (decision.primary.mode === "shadow" && !approveShadow) {
    throw new RouterError("SHADOW_APPROVAL_REQUIRED", "Shadow provider dispatch requires --approve-shadow");
  }
  if (needsCriticalApproval(decision, policy) && !approve) {
    throw new RouterError("HUMAN_APPROVAL_REQUIRED", "High-risk dispatch requires --approve");
  }
}

function publicResult(result) {
  return {
    provider: result.provider,
    model: result.model,
    api_model: result.api_model,
    account: result.account,
    account_verified: result.account_verified,
    usage: result.usage,
    duration_ms: result.duration_ms,
    cost_usd_equivalent: result.cost_usd_equivalent,
    cost_basis: result.cost_basis ?? null,
    budget: result.budget ?? null,
    warning_count: result.warning_count,
    response_only: true
  };
}

async function writeTelemetry(record, logger) {
  try {
    await logger(record);
    return "written";
  } catch {
    return "failed";
  }
}

export async function dispatchTask(rawInput, prompt, catalog, policy, options = {}) {
  validatePrompt(prompt);
  const executionId = randomUUID();
  const startedAt = new Date().toISOString();
  const unavailable = new Set(rawInput.unavailable ?? []);
  const attempts = [];
  const invoke = options.invoke ?? invokeModel;
  const executionLogger = options.executionLogger ?? logExecution;
  const decisionLogger = options.decisionLogger ?? logDecision;
  const approve = Boolean(options.approve);
  const approveShadow = Boolean(options.approveShadow);
  const maxOutputTokens = options.maxOutputTokens ?? 2048;
  const noFallback = Boolean(options.noFallback);
  let decision = null;
  let primaryResult = null;
  let verification = null;

  async function invokeBudgeted(selection, invokeOptions, role) {
    const provider = catalog.providers[selection.provider];
    await assertProviderBudget(selection.provider, provider);
    const result = await invoke(invokeOptions);
    try {
      result.budget = await recordProviderCost(selection.provider, provider, result, {
        executionId,
        role
      });
    } catch {
      result.warning_count = (result.warning_count ?? 0) + 1;
      result.budget = { status: "tracking_failed" };
    }
    return result;
  }

  const telemetryBase = () => ({
    execution_id: executionId,
    decision_id: decision?.decision_id ?? null,
    started_at: startedAt,
    completed_at: new Date().toISOString(),
    category: decision?.category ?? rawInput.category ?? policy.defaults.category,
    input_chars: prompt.length,
    attempts,
    primary: primaryResult,
    verification
  });

  try {
    if (!Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > 65_536) {
      throw new RouterError("MAX_OUTPUT_TOKENS_INVALID", "max-output-tokens must be between 1 and 65536");
    }

    for (let count = 0; count < Object.keys(catalog.models).length; count += 1) {
      try {
        decision = routeTask({ ...rawInput, unavailable: [...unavailable] }, catalog, policy);
      } catch (error) {
        if (attempts.length > 0) {
          throw new RouterError("ALL_PROVIDERS_FAILED", "All safe provider attempts failed", {
            cause: error,
            retryable: attempts.some((attempt) => attempt.retryable)
          });
        }
        throw error;
      }
      if (attempts.length > 0 && decision.primary.mode === "shadow" && !approveShadow) {
        // During fallback, skip unapproved shadow providers instead of aborting the whole dispatch.
        unavailable.add(decision.primary.provider);
        continue;
      }
      enforceDecision(decision, { approve, approveShadow, policy });
      if (options.logDecisions) await decisionLogger(decision);

      const selection = decision.primary;
      const attemptStarted = performance.now();
      try {
        primaryResult = await invokeBudgeted(selection, {
          selection,
          prompt,
          catalog,
          maxOutputTokens,
          timeoutMs: options.timeoutMs
        }, "primary");
        attempts.push({
          provider: selection.provider,
          model: selection.model,
          account: selection.account,
          status: "success",
          duration_ms: primaryResult.duration_ms ?? Math.round(performance.now() - attemptStarted)
        });
        break;
      } catch (error) {
        const safe = publicError(error);
        attempts.push({
          provider: selection.provider,
          model: selection.model,
          account: selection.account,
          status: "failed",
          duration_ms: Math.round(performance.now() - attemptStarted),
          error_code: safe.code,
          retryable: safe.retryable
        });
        if (noFallback) throw error;
        // A missing CLI or credential affects every model of the provider.
        unavailable.add(PROVIDER_LEVEL_FAILURES.has(safe.code) ? selection.provider : selection.model);
      }
    }

    if (!primaryResult || !decision) {
      throw new RouterError("ALL_PROVIDERS_FAILED", "All safe provider attempts failed");
    }

    let finalResponse = primaryResult.text;
    if (decision.verifier) {
      if (decision.verifier.provider === decision.primary.provider) {
        throw new RouterError("VERIFIER_NOT_INDEPENDENT", "Verifier provider must differ from primary provider");
      }
      // Try the policy's verifier candidates in order; never fall back to the primary's provider.
      const verifierUnavailable = new Set(unavailable);
      let verifierSelection = decision.verifier;
      let verifierResult = null;
      let verdict = null;
      while (verifierSelection) {
        try {
          verifierResult = await invokeBudgeted(verifierSelection, {
            selection: verifierSelection,
            prompt: buildVerifierPrompt(prompt, primaryResult.text),
            catalog,
            maxOutputTokens,
            timeoutMs: options.timeoutMs,
            systemPrompt: VERIFIER_SYSTEM
          }, "verifier");
          verdict = parseVerifierResponse(verifierResult.text);
          break;
        } catch (error) {
          const safe = publicError(error);
          attempts.push({ provider: verifierSelection.provider, model: verifierSelection.model, account: verifierSelection.account, role: "verifier", status: "failed", error_code: safe.code });
          if (noFallback || safe.code === "PROVIDER_BUDGET_BLOCKED") throw error;
          verifierUnavailable.add(PROVIDER_LEVEL_FAILURES.has(safe.code) ? verifierSelection.provider : verifierSelection.model);
          let next = null;
          try {
            next = routeTask({ ...rawInput, unavailable: [...verifierUnavailable] }, catalog, policy);
          } catch { /* no route left */ }
          verifierSelection = next && next.primary.model === decision.primary.model ? next.verifier : null;
          if (verifierSelection && verifierSelection.provider === decision.primary.provider) verifierSelection = null;
          if (!verifierSelection) {
            throw new RouterError("VERIFIER_UNAVAILABLE", "No independent verifier could complete the review", { cause: error });
          }
        }
      }
      verification = {
        ...publicResult(verifierResult),
        verdict: verdict.verdict,
        summary: verdict.summary
      };
      if (verdict.verdict === "revise") finalResponse = verdict.corrected_response;
      if (verdict.verdict === "reject") finalResponse = null;
    }

    const status = finalResponse === null ? "verification_rejected" : "completed";
    const telemetryStatus = await writeTelemetry({
      ...telemetryBase(),
      status,
      output_chars: finalResponse?.length ?? 0
    }, executionLogger);

    return {
      schema_version: 1,
      execution_id: executionId,
      started_at: startedAt,
      completed_at: new Date().toISOString(),
      status,
      execution_mode: "response_only",
      telemetry_status: telemetryStatus,
      decision,
      attempts: attempts.map(({ retryable, ...attempt }) => attempt),
      primary: publicResult(primaryResult),
      verification,
      final_response: finalResponse
    };
  } catch (error) {
    const safe = publicError(error);
    const telemetryStatus = await writeTelemetry({
      ...telemetryBase(),
      status: safe.code.endsWith("APPROVAL_REQUIRED") ? "blocked" : "failed",
      output_chars: 0,
      error_code: safe.code
    }, executionLogger);
    error.executionId = executionId;
    error.attempts = attempts.map(({ retryable, ...attempt }) => attempt);
    error.telemetryStatus = telemetryStatus;
    throw error;
  }
}
