import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { isSecretRef } from "./secrets.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function readJson(relativePath) {
  return JSON.parse(await readFile(path.join(ROOT, relativePath), "utf8"));
}

export async function loadConfig() {
  const [catalog, policy] = await Promise.all([
    readJson("config/model-catalog.json"),
    readJson("config/routing-policy.json")
  ]);
  validateConfig(catalog, policy);
  return { catalog, policy, root: ROOT };
}

export function validateConfig(catalog, policy) {
  if (catalog.schema_version !== 1 || policy.schema_version !== 1) {
    throw new Error("Unsupported config schema_version");
  }
  for (const [modelId, model] of Object.entries(catalog.models ?? {})) {
    if (!catalog.providers?.[model.provider]) {
      throw new Error(`Model ${modelId} references unknown provider ${model.provider}`);
    }
    if (model.pricing_usd_per_million_tokens) {
      for (const field of ["input", "cached_input", "output"]) {
        if (!Number.isFinite(model.pricing_usd_per_million_tokens[field]) || model.pricing_usd_per_million_tokens[field] < 0) {
          throw new Error(`Model ${modelId} has invalid ${field} pricing`);
        }
      }
    }
  }
  const VALID_EFFORTS = new Set(["low", "medium", "high", "xhigh", "max"]);
  for (const [category, route] of Object.entries(policy.routes ?? {})) {
    for (const modelId of [route.primary, ...(route.fallbacks ?? []), ...(route.verifiers ?? []), ...Object.values(route.fallbacks_by_sensitivity ?? {}).flat()]) {
      if (!catalog.models?.[modelId]) {
        throw new Error(`Route ${category} references unknown model ${modelId}`);
      }
    }
    if (route.effort_by_complexity) {
      for (const complexity of ["simple", "medium", "complex"]) {
        const effort = route.effort_by_complexity[complexity];
        if (effort !== undefined && !VALID_EFFORTS.has(effort)) {
          throw new Error(`Route ${category} has invalid effort_by_complexity.${complexity}: ${effort}`);
        }
      }
    }
  }
  for (const [providerId, provider] of Object.entries(catalog.providers ?? {})) {
    if (!provider.adapter) {
      throw new Error(`Provider ${providerId} must declare an adapter`);
    }
    if (provider.response_only !== true) {
      throw new Error(`Provider ${providerId} must enforce response_only mode`);
    }
    if (provider.secret_ref && !isSecretRef(provider.secret_ref)) {
      throw new Error(`Provider ${providerId} must use an env:VAR or op:// secret reference`);
    }
    if (provider.inference_url) {
      const url = new URL(provider.inference_url);
      if (url.protocol !== "https:") {
        throw new Error(`Provider ${providerId} inference_url must use HTTPS`);
      }
      if (!provider.allowed_hosts?.includes(url.hostname)) {
        throw new Error(`Provider ${providerId} inference host is not allowlisted`);
      }
    }
    if (provider.budget_control) {
      const budget = provider.budget_control;
      if (!(budget.funded_amount_usd > budget.soft_alert_remaining_usd
        && budget.soft_alert_remaining_usd > budget.critical_alert_remaining_usd
        && budget.critical_alert_remaining_usd > budget.hard_stop_remaining_usd
        && budget.hard_stop_remaining_usd >= 0)) {
        throw new Error(`Provider ${providerId} has invalid budget thresholds`);
      }
    }
  }
  return true;
}
