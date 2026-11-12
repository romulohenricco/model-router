import path from "node:path";
import { fileURLToPath } from "node:url";
import { RouterError } from "../errors.mjs";
import { runProcess } from "../process.mjs";
import { normalizeUsage, RESPONSE_ONLY_SYSTEM, sanitizeEnvironment } from "./common.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const EMPTY_MCP = path.join(ROOT, "config", "empty-mcp.json");

export function parseClaudeResponse(stdout, selection, durationMs) {
  let body;
  try {
    body = JSON.parse(stdout.trim());
  } catch (error) {
    throw new RouterError("CLAUDE_JSON_INVALID", "Claude CLI returned invalid JSON", { cause: error });
  }
  if (body.is_error || body.subtype !== "success" || typeof body.result !== "string") {
    throw new RouterError("CLAUDE_RESPONSE_INVALID", "Claude CLI did not return a successful response");
  }
  const requestedUsage = body.modelUsage?.[selection.api_model];
  if (!requestedUsage) {
    throw new RouterError("CLAUDE_MODEL_MISMATCH", "Claude CLI did not report the requested model");
  }
  return {
    provider: selection.provider,
    model: selection.model,
    api_model: selection.api_model,
    account: selection.account,
    account_verified: false,
    text: body.result,
    usage: normalizeUsage(requestedUsage.inputTokens, requestedUsage.outputTokens, {
      cache_read_input_tokens: requestedUsage.cacheReadInputTokens ?? null,
      cache_creation_input_tokens: requestedUsage.cacheCreationInputTokens ?? null
    }),
    duration_ms: body.duration_ms ?? durationMs,
    cost_usd_equivalent: Number.isFinite(body.total_cost_usd) ? body.total_cost_usd : null,
    warning_count: Array.isArray(body.permission_denials) ? body.permission_denials.length : 0,
    response_only: true
  };
}

export async function invokeClaude({
  selection,
  prompt,
  timeoutMs,
  systemPrompt = RESPONSE_ONLY_SYSTEM,
  run = runProcess
}) {
  const env = sanitizeEnvironment([
    "ANTHROPIC_API_KEY",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_BASE_URL"
  ]);
  const result = await run({
    command: "claude",
    args: [
      "--print",
      "--output-format", "json",
      "--model", selection.api_model,
      "--effort", selection.effort,
      "--system-prompt", systemPrompt,
      "--tools", "",
      "--disable-slash-commands",
      "--no-session-persistence",
      "--no-chrome",
      "--prompt-suggestions", "false",
      "--setting-sources", "local",
      "--strict-mcp-config",
      "--mcp-config", EMPTY_MCP
    ],
    input: prompt,
    cwd: ROOT,
    env,
    timeoutMs
  });
  if (result.code !== 0) {
    throw new RouterError("CLAUDE_CLI_FAILED", "Claude CLI exited unsuccessfully", { retryable: true });
  }
  return parseClaudeResponse(result.stdout, selection, result.durationMs);
}
