import { RouterError } from "../errors.mjs";
import { postJson } from "../http.mjs";
import { readSecret } from "../secrets.mjs";
import { normalizeUsage, RESPONSE_ONLY_SYSTEM } from "./common.mjs";
import { estimateTokenCostUsd } from "../cost.mjs";

function messageText(content) {
  if (typeof content === "string") return content.trim();
  if (Array.isArray(content)) {
    return content.map((part) => typeof part === "string" ? part : part?.text ?? "").join("\n").trim();
  }
  return "";
}

export function parseGlmResponse(body, selection, durationMs, requestId = null, pricing = null) {
  const text = messageText(body.choices?.[0]?.message?.content);
  if (!text) throw new RouterError("GLM_RESPONSE_MISSING", "GLM returned no text response");
  if (body.model && body.model !== selection.api_model) {
    throw new RouterError("GLM_MODEL_MISMATCH", "GLM returned a different model");
  }
  const usage = normalizeUsage(body.usage?.prompt_tokens, body.usage?.completion_tokens, {
    cached_input_tokens: Number.isFinite(body.usage?.prompt_tokens_details?.cached_tokens)
      ? body.usage.prompt_tokens_details.cached_tokens
      : null
  });
  return {
    provider: selection.provider,
    model: selection.model,
    api_model: selection.api_model,
    account: selection.account,
    account_verified: true,
    text,
    usage,
    duration_ms: durationMs,
    cost_usd_equivalent: estimateTokenCostUsd(usage, pricing),
    cost_basis: pricing ? "official_list_price_estimate" : null,
    warning_count: 0,
    request_id: requestId,
    response_only: true
  };
}

export async function invokeGlm({
  selection,
  prompt,
  provider,
  modelConfig,
  maxOutputTokens,
  timeoutMs,
  systemPrompt = RESPONSE_ONLY_SYSTEM,
  secretReader = readSecret,
  fetchImpl = fetch
}) {
  const started = performance.now();
  const secret = await secretReader(provider.secret_ref);
  const response = await postJson(provider.inference_url, {
    allowedHosts: provider.allowed_hosts,
    headers: { Authorization: `Bearer ${secret}` },
    body: {
      model: selection.api_model,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt }
      ],
      thinking: { type: "disabled" },
      max_tokens: maxOutputTokens,
      temperature: 0.2,
      stream: false
    },
    timeoutMs,
    fetchImpl
  });
  return parseGlmResponse(
    response.data,
    selection,
    Math.round(performance.now() - started),
    response.requestId,
    modelConfig?.pricing_usd_per_million_tokens
  );
}
