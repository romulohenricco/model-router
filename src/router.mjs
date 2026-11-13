import { randomUUID } from "node:crypto";

const VALID = {
  risk: new Set(["low", "medium", "high", "critical"]),
  sensitivity: new Set(["public", "internal", "confidential", "restricted"]),
  side_effects: new Set(["none", "write", "deploy", "destructive"]),
  complexity: new Set(["simple", "medium", "complex"]),
  latency: new Set(["interactive", "balanced", "batch"]),
  budget: new Set(["subscription", "prefer_low_cost", "approved_api"])
};

function normalizeInput(input, defaults) {
  const normalized = {
    category: input.category ?? defaults.category,
    risk: input.risk ?? defaults.risk,
    sensitivity: input.sensitivity ?? defaults.sensitivity,
    side_effects: input.side_effects ?? defaults.side_effects,
    complexity: input.complexity ?? defaults.complexity,
    latency: input.latency ?? defaults.latency,
    budget: input.budget ?? defaults.budget,
    author_provider: input.author_provider ?? null,
    session_account: input.session_account ?? null,
    unavailable: new Set(input.unavailable ?? [])
  };
  for (const [field, values] of Object.entries(VALID)) {
    if (!values.has(normalized[field])) {
      throw new Error(`Invalid ${field}: ${normalized[field]}`);
    }
  }
  return normalized;
}

function resolveEffort(route, input, model) {
  return route.effort_by_complexity?.[input.complexity] ?? model.default_effort;
}

const EFFORT_ORDER = ["low", "medium", "high", "xhigh", "max"];

// Verification of high/critical risk or deploy/destructive side effects never runs
// below this effort floor, even when the route's effort_by_complexity would give less.
// Override with policy.guardrails.high_risk_verifier_min_effort.
function atLeast(effort, floor) {
  return EFFORT_ORDER.indexOf(effort) >= EFFORT_ORDER.indexOf(floor) ? effort : floor;
}

function selection(modelId, catalog, input, route) {
  const model = catalog.models[modelId];
  const provider = catalog.providers[model.provider];
  let account = provider.accounts[0];
  if (model.provider === "anthropic" && input.session_account) {
    if (!provider.accounts.includes(input.session_account)) {
      throw new Error(`Unknown Claude session account: ${input.session_account}`);
    }
    account = input.session_account;
  }
  return {
    provider: model.provider,
    model: modelId,
    api_model: model.api_model,
    account,
    effort: resolveEffort(route, input, model),
    mode: provider.mode
  };
}

function isAllowed(modelId, catalog, policy, input) {
  const model = catalog.models[modelId];
  const provider = catalog.providers[model.provider];
  if (!provider.enabled || input.unavailable.has(model.provider) || input.unavailable.has(modelId)) {
    return false;
  }
  const sensitive = policy.guardrails.sensitive_levels.includes(input.sensitivity);
  if (sensitive && policy.guardrails.external_sensitive_providers.includes(model.provider)) {
    return false;
  }
  if (policy.guardrails.api_budget_providers.includes(model.provider) && input.budget !== "approved_api") {
    return false;
  }
  return true;
}

function firstAllowed(modelIds, catalog, policy, input, excludedProviders = new Set()) {
  return modelIds.find((modelId) => {
    const provider = catalog.models[modelId].provider;
    return !excludedProviders.has(provider) && isAllowed(modelId, catalog, policy, input);
  }) ?? null;
}

export function routeTask(rawInput, catalog, policy) {
  const input = normalizeInput(rawInput, policy.defaults);
  const route = policy.routes[input.category];
  if (!route) {
    throw new Error(`Invalid category: ${input.category}`);
  }

  const dangerous = policy.guardrails.dangerous_side_effects.includes(input.side_effects);
  const highRisk = policy.guardrails.high_risks.includes(input.risk);
  const reasons = [];
  // Sensitive data may use a different (e.g. non-economical) fallback chain.
  const routeFallbacks = route.fallbacks_by_sensitivity?.[input.sensitivity] ?? route.fallbacks;
  let candidates = [route.primary, ...routeFallbacks];
  const critical = dangerous || input.risk === "critical";

  if (critical) {
    candidates = [policy.guardrails.safe_controller, ...candidates];
    reasons.push("Ação crítica usa o controlador seguro e exige aprovação humana.");
  }

  const reviewCategory = input.category === "critical_review" || input.category === "comparative_analysis";
  const primaryExclusions = reviewCategory && input.author_provider
    ? new Set([input.author_provider])
    : new Set();
  const primaryId = firstAllowed(candidates, catalog, policy, input, primaryExclusions);
  if (!primaryId) {
    throw new Error("No safe model is available for this route");
  }
  if (primaryId !== route.primary) {
    reasons.push(`Rota primária ${route.primary} bloqueada por disponibilidade, sensibilidade, risco ou orçamento.`);
  } else {
    reasons.push(`Política ${input.category} selecionou ${primaryId}.`);
  }

  const primary = selection(primaryId, catalog, input, route);
  const fallbackIds = [...new Set(candidates)]
    .filter((id) => id !== primaryId && isAllowed(id, catalog, policy, input));
  const fallbacks = fallbackIds.map((id) => selection(id, catalog, input, route));
  // Critical or deploy/destructive work never runs the executing model below this
  // effort floor, even when effort_by_complexity would give less (e.g. complexity simple).
  if (critical) {
    const floor = policy.guardrails.critical_primary_min_effort ?? "high";
    if (!EFFORT_ORDER.includes(floor)) throw new Error(`Invalid guardrails.critical_primary_min_effort: ${floor}`);
    const before = primary.effort;
    for (const s of [primary, ...fallbacks]) s.effort = atLeast(s.effort, floor);
    if (primary.effort !== before) reasons.push(`Esforço do primário elevado de ${before} para ${primary.effort} por ação crítica.`);
  }

  const shadow = primary.mode === "shadow";
  const independentReviewSatisfied = reviewCategory
    && input.author_provider
    && primary.provider !== input.author_provider;
  const verifierNeeded = shadow || highRisk || dangerous || (reviewCategory && !independentReviewSatisfied);
  let verifier = null;
  if (verifierNeeded) {
    const excluded = new Set([primary.provider]);
    if (input.author_provider) excluded.add(input.author_provider);
    // Critical or deploy/destructive work is verified by the critical verifier first.
    const verifierCandidates = critical
      ? [policy.guardrails.critical_verifier, ...route.verifiers, policy.guardrails.safe_controller]
      : route.verifiers;
    let verifierId = firstAllowed(verifierCandidates, catalog, policy, input, excluded);
    if (!verifierId) {
      verifierId = firstAllowed(
        [policy.guardrails.critical_verifier, policy.guardrails.safe_controller],
        catalog,
        policy,
        input,
        excluded
      );
    }
    verifier = verifierId ? selection(verifierId, catalog, input, route) : null;
    if (verifier && (highRisk || dangerous)) {
      const floor = policy.guardrails.high_risk_verifier_min_effort ?? "high";
      if (!EFFORT_ORDER.includes(floor)) {
        throw new Error(`Invalid guardrails.high_risk_verifier_min_effort: ${floor}`);
      }
      const raised = atLeast(verifier.effort, floor);
      if (raised !== verifier.effort) {
        reasons.push(`Esforço do verificador elevado de ${verifier.effort} para ${raised} por risco/efeito.`);
        verifier.effort = raised;
      }
    }
    reasons.push(verifier ? `Verificação independente por ${verifier.model}.` : "Verificador independente indisponível; falhar fechado.");
  }

  if (shadow) reasons.push(`${primary.provider} está em shadow mode; despacho exige confirmação.`);

  const requiresHumanApproval = dangerous || highRisk || shadow;
  const failClosed = verifierNeeded && verifier === null;

  return {
    schema_version: 1,
    decision_id: randomUUID(),
    decided_at: new Date().toISOString(),
    category: input.category,
    constraints: {
      risk: input.risk,
      sensitivity: input.sensitivity,
      side_effects: input.side_effects,
      complexity: input.complexity,
      latency: input.latency,
      budget: input.budget
    },
    primary,
    fallbacks,
    verifier,
    requires_human_approval: requiresHumanApproval,
    fail_closed: failClosed,
    reasons
  };
}
