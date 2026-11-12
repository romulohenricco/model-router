import { RouterError } from "./errors.mjs";

const MAX_RESPONSE_CHARS = 8 * 1024 * 1024;

export async function postJson(urlValue, {
  allowedHosts,
  headers = {},
  body,
  timeoutMs = 300_000,
  fetchImpl = fetch
}) {
  const url = new URL(urlValue);
  if (url.protocol !== "https:" || !allowedHosts?.includes(url.hostname)) {
    throw new RouterError("INFERENCE_URL_BLOCKED", "Provider inference URL is not allowlisted");
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new RouterError("PROVIDER_NETWORK_ERROR", "Provider request failed", { cause: error, retryable: true });
  }

  const raw = await response.text();
  if (raw.length > MAX_RESPONSE_CHARS) {
    throw new RouterError("PROVIDER_OUTPUT_LIMIT", "Provider response exceeded the output limit");
  }
  if (!response.ok) {
    throw new RouterError("PROVIDER_HTTP_ERROR", "Provider returned a non-success status", {
      httpStatus: response.status,
      retryable: response.status === 429 || response.status >= 500
    });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch (error) {
    throw new RouterError("PROVIDER_JSON_INVALID", "Provider returned invalid JSON", { cause: error });
  }

  return {
    data,
    status: response.status,
    requestId: response.headers.get("x-request-id") ?? response.headers.get("request-id") ?? null
  };
}
