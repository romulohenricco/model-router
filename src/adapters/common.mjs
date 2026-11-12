export const RESPONSE_ONLY_SYSTEM = [
  "You are a response-only worker for the model router.",
  "Answer only from the request supplied by the caller.",
  "Do not use tools, inspect files, browse, execute commands, or mutate external state.",
  "Do not claim that you performed an action. Return the requested answer only."
].join(" ");

export function normalizeUsage(inputTokens, outputTokens, extra = {}) {
  const input = Number.isFinite(inputTokens) ? inputTokens : null;
  const output = Number.isFinite(outputTokens) ? outputTokens : null;
  return {
    input_tokens: input,
    output_tokens: output,
    total_tokens: input !== null && output !== null ? input + output : null,
    ...extra
  };
}

const THIRD_PARTY_SECRETS = ["MINIMAX_API_KEY", "ZAI_API_KEY", "GLM_API_KEY", "OP_SERVICE_ACCOUNT_TOKEN"];

export function sanitizeEnvironment(names) {
  const env = { ...process.env };
  for (const name of [...names, ...THIRD_PARTY_SECRETS]) delete env[name];
  return env;
}
