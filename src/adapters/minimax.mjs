import { RouterError } from "../errors.mjs";
import { postJson } from "../http.mjs";
import { readSecret } from "../secrets.mjs";
import { normalizeUsage, RESPONSE_ONLY_SYSTEM } from "./common.mjs";

export function parseMiniMaxResponse(body, selection, durationMs, requestId = null) {
  const text = (body.content ?? [])
    .filter((block) => block?.type === "text" && typeof block.text === "string")
    .map((block) => block.text)
    .join("\n")
    .trim();
  if (!text && body.stop_reason === "max_tokens") {
    throw new RouterError("MINIMAX_OUTPUT_TRUNCATED", "MiniMax exhausted its reasoning budget before producing text", { retryable: true });
  }
  if (!text) throw new RouterError("MINIMAX_RESPONSE_MISSING", "MiniMax returned no text response");
  if (body.model && body.model !== selection.api_model) {
    throw new RouterError("MINIMAX_MODEL_MISMATCH", "MiniMax returned a different model");
  }
  return {
    provider: selection.provider,
    model: selection.model,
    api_model: selection.api_model,
    account: selection.account,
    account_verified: true,
    text,
    usage: normalizeUsage(body.usage?.input_tokens, body.usage?.output_tokens, {
      cache_read_input_tokens: body.usage?.cache_read_input_tokens ?? null,
      cache_creation_input_tokens: body.usage?.cache_creation_input_tokens ?? null
    }),
    duration_ms: durationMs,
    cost_usd_equivalent: null,
    warning_count: 0,
    request_id: requestId,
    response_only: true
  };
}

export async function invokeMiniMax({
  selection,
  prompt,
  provider,
  maxOutputTokens,
  timeoutMs,
  systemPrompt = RESPONSE_ONLY_SYSTEM,
  secretReader = readSecret,
  fetchImpl = fetch
}) {
  const started = performance.now();
  const secret = await secretReader(provider.secret_ref);
  const apiMaxTokens = Math.min(204_800, maxOutputTokens + (provider.reasoning_token_headroom ?? 0));
  const response = await postJson(provider.inference_url, {
    allowedHosts: provider.allowed_hosts,
    headers: { "X-Api-Key": secret },
    body: {
      model: selection.api_model,
      max_tokens: apiMaxTokens,
      temperature: 0.2,
      system: systemPrompt,
      messages: [{ role: "user", content: [{ type: "text", text: prompt }] }]
    },
    timeoutMs,
    fetchImpl
  });
  return parseMiniMaxResponse(response.data, selection, Math.round(performance.now() - started), response.requestId);
}
