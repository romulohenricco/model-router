import fs from "node:fs";
import path from "node:path";
import { RouterError } from "../errors.mjs";

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

const THIRD_PARTY_SECRETS = ["MINIMAX_API_KEY", "ZAI_API_KEY", "GLM_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY", "OP_SERVICE_ACCOUNT_TOKEN"];

// Provider CLI overrides are configuration, not secrets: they are always passed
// through to child processes, even if a caller lists them for removal.
export const CLI_BIN_ENV = Object.freeze({
  claude: "MODEL_ROUTER_CLAUDE_BIN",
  codex: "MODEL_ROUTER_CODEX_BIN"
});
const PRESERVED_ENV = new Set(Object.values(CLI_BIN_ENV));

export function sanitizeEnvironment(names, source = process.env) {
  const env = { ...source };
  for (const name of [...names, ...THIRD_PARTY_SECRETS]) {
    if (!PRESERVED_ENV.has(name)) delete env[name];
  }
  return env;
}

/**
 * Resolve the executable for a provider CLI ("claude" or "codex").
 * Unset/empty override keeps the bare command name (PATH lookup, backwards compatible).
 * A set override must be an absolute path to an existing regular file; otherwise
 * RouterError CLI_PATH_INVALID is thrown. On Windows, .cmd/.bat shims are rejected
 * because Node cannot spawn them without a shell.
 */
export function resolveCliCommand(name, { env = process.env, platform = process.platform } = {}) {
  const variable = CLI_BIN_ENV[name];
  if (!variable) throw new RouterError("CLI_PATH_INVALID", `Unknown provider CLI: ${name}`);
  const raw = env[variable];
  if (raw === undefined || raw === "") return name;
  const value = String(raw);
  const absolute = platform === "win32" ? path.win32.isAbsolute(value) : path.posix.isAbsolute(value);
  if (!absolute) {
    throw new RouterError("CLI_PATH_INVALID", `${variable} must be an absolute path`);
  }
  let stat;
  try {
    stat = fs.statSync(value);
  } catch (error) {
    throw new RouterError("CLI_PATH_INVALID", `${variable} does not point to an existing file`, { cause: error });
  }
  if (!stat.isFile()) {
    throw new RouterError("CLI_PATH_INVALID", `${variable} must point to a regular file`);
  }
  if (platform === "win32" && /\.(cmd|bat)$/i.test(value)) {
    throw new RouterError("CLI_PATH_INVALID", `${variable} must point to an executable, not a .cmd/.bat shim`);
  }
  return value;
}
