import { RouterError } from "../errors.mjs";
import { postJson } from "../http.mjs";
import { readSecret } from "../secrets.mjs";
import { normalizeUsage, RESPONSE_ONLY_SYSTEM } from "./common.mjs";

export function parseGeminiResponse(body, selection, durationMs, requestId = null) {
  const candidate = body.candidates?.[0];
  const parts = candidate?.content?.parts ?? [];
  const text = parts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n")
    .trim();

  if (!text && candidate?.finishReason === "MAX_TOKENS") {
    throw new RouterError("GEMINI_OUTPUT_TRUNCATED", "Gemini exhausted its output token budget before finishing", { retryable: true });
  }
  if (!text) {
    throw new RouterError("GEMINI_RESPONSE_MISSING", "Gemini returned no text response");
  }

  const usageMetadata = body.usageMetadata ?? {};
  const inputTokens = usageMetadata.promptTokenCount ?? null;
  const outputTokens = usageMetadata.candidatesTokenCount ?? null;
  const cachedTokens = usageMetadata.cachedContentTokenCount ?? null;

  return {
    provider: selection.provider,
    model: selection.model,
    api_model: selection.api_model,
    account: selection.account,
    account_verified: true,
    text,
    usage: normalizeUsage(inputTokens, outputTokens, {
      cache_read_input_tokens: cachedTokens,
      cache_creation_input_tokens: null
    }),
    duration_ms: durationMs,
    cost_usd_equivalent: null,
    warning_count: 0,
    request_id: requestId,
    response_only: true
  };
}

export async function invokeGemini({
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
  const url = `${provider.base_url}/v1beta/models/${selection.api_model}:generateContent?key=${encodeURIComponent(secret)}`;

  const body = {
    contents: [
      {
        role: "user",
        parts: [{ text: prompt }]
      }
    ],
    generationConfig: {
      temperature: 0.2,
      maxOutputTokens: maxOutputTokens ?? 8192
    }
  };

  if (systemPrompt) {
    body.systemInstruction = {
      parts: [{ text: systemPrompt }]
    };
  }

  const response = await postJson(url, {
    allowedHosts: provider.allowed_hosts,
    headers: {},
    body,
    timeoutMs,
    fetchImpl
  });

  return parseGeminiResponse(response.data, selection, Math.round(performance.now() - started), response.requestId);
}
