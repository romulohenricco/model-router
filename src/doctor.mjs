import { runProcess } from "./process.mjs";
import { readSecret } from "./secrets.mjs";

async function probe(providerId, provider, expectedModels) {
  if (provider.adapter === "claude_cli") {
    try {
      const result = await runProcess({
        command: "claude",
        args: ["auth", "status", "--json"],
        input: "",
        timeoutMs: 30_000,
        maxBufferBytes: 256 * 1024
      });
      const body = JSON.parse(result.stdout);
      return {
        provider: providerId,
        status: result.code === 0 && body.loggedIn ? "authenticated" : "not_authenticated",
        live_probe: true,
        auth_method: body.authMethod ?? null,
        api_provider: body.apiProvider ?? null,
        subscription_type: body.subscriptionType ?? null,
        configured_account_aliases: provider.accounts.length,
        account_inventory_verified: false
      };
    } catch (error) {
      return { provider: providerId, status: "auth_probe_failed", live_probe: true, error_code: error?.code ?? error?.name ?? "unknown" };
    }
  }
  if (provider.adapter === "codex_cli") {
    try {
      const result = await runProcess({
        command: "codex",
        args: ["login", "status"],
        input: "",
        timeoutMs: 30_000,
        maxBufferBytes: 256 * 1024
      });
      return {
        provider: providerId,
        status: result.code === 0 && /logged in/i.test(`${result.stdout}\n${result.stderr}`) ? "authenticated" : "not_authenticated",
        live_probe: true,
        auth_method: /chatgpt/i.test(`${result.stdout}\n${result.stderr}`) ? "chatgpt" : "unknown",
        configured_account_aliases: provider.accounts.length,
        account_inventory_verified: provider.accounts.length === 1
      };
    } catch (error) {
      return { provider: providerId, status: "auth_probe_failed", live_probe: true, error_code: error?.code ?? error?.name ?? "unknown" };
    }
  }
  if (!provider.secret_ref || !provider.health_url) {
    return { provider: providerId, status: "managed_by_harness", live_probe: false };
  }
  let secret;
  try {
    secret = await readSecret(provider.secret_ref);
  } catch (error) {
    return {
      provider: providerId,
      status: "credential_read_failed",
      live_probe: false,
      error_code: error?.code ?? error?.name ?? "unknown"
    };
  }
  if (!secret) return { provider: providerId, status: "credential_empty", live_probe: false };
  try {
    const response = await fetch(provider.health_url, {
      method: "GET",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(15_000)
    });
    const result = {
      provider: providerId,
      status: response.ok ? "reachable" : "http_error",
      live_probe: true,
      http_status: response.status
    };
    if (response.ok && providerId === "glm") {
      const body = await response.json();
      const available = new Set((body.data ?? []).map((model) => model.id));
      result.models_available = expectedModels.filter((model) => available.has(model));
      result.models_missing = expectedModels.filter((model) => !available.has(model));
    }
    return result;
  } catch (error) {
    return {
      provider: providerId,
      status: "network_error",
      live_probe: true,
      error_code: error?.cause?.code ?? error?.code ?? error?.name ?? "unknown"
    };
  }
}

export async function runDoctor(catalog, { live = false, provider = null } = {}) {
  const ids = provider ? [provider] : Object.keys(catalog.providers);
  for (const id of ids) {
    if (!catalog.providers[id]) throw new Error(`Unknown provider: ${id}`);
  }
  if (!live) {
    return ids.map((id) => ({
      provider: id,
      enabled: catalog.providers[id].enabled,
      mode: catalog.providers[id].mode,
      managed_by: catalog.providers[id].managed_by,
      secret_reference_configured: Boolean(catalog.providers[id].secret_ref),
      live_probe: false
    }));
  }
  return Promise.all(ids.map((id) => {
    const expectedModels = Object.values(catalog.models)
      .filter((model) => model.provider === id)
      .map((model) => model.api_model);
    return probe(id, catalog.providers[id], expectedModels);
  }));
}
