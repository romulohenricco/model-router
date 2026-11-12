import os from "node:os";
import path from "node:path";
import { access, readdir, realpath } from "node:fs/promises";
import { RouterError } from "../errors.mjs";
import { runProcess } from "../process.mjs";
import { normalizeUsage, RESPONSE_ONLY_SYSTEM, sanitizeEnvironment } from "./common.mjs";

const ALLOWED_ITEM_TYPES = new Set(["agent_message", "reasoning", "error", "plan", "todo_list"]);

async function exists(filePath) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function collectSkillPaths(root, depth = 0) {
  if (depth > 2 || !await exists(root)) return [];
  const entries = await readdir(root, { withFileTypes: true });
  const paths = [];
  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const candidate = path.join(root, entry.name);
    if (await exists(path.join(candidate, "SKILL.md"))) paths.push(await realpath(candidate));
    else paths.push(...await collectSkillPaths(candidate, depth + 1));
  }
  return paths;
}

function tomlString(value) {
  return JSON.stringify(value);
}

async function disabledSkillsConfig() {
  const home = os.homedir();
  const roots = [path.join(home, ".codex", "skills"), path.join(home, ".agents", "skills")];
  const skills = [...new Set((await Promise.all(roots.map((root) => collectSkillPaths(root)))).flat())];
  return `skills.config=[${skills.map((skillPath) => `{path=${tomlString(skillPath)},enabled=false}`).join(",")}]`;
}

function parseJsonLines(stdout) {
  const events = [];
  for (const line of stdout.split(/\r?\n/).filter(Boolean)) {
    try {
      events.push(JSON.parse(line));
    } catch (error) {
      throw new RouterError("CODEX_JSON_INVALID", "Codex CLI returned invalid JSONL", { cause: error });
    }
  }
  return events;
}

export function parseCodexResponse(stdout, stderr, selection, durationMs) {
  const events = parseJsonLines(stdout);
  const completedItems = events
    .filter((event) => event.type === "item.completed" && event.item)
    .map((event) => event.item);
  const violations = completedItems.filter((item) => !ALLOWED_ITEM_TYPES.has(item.type));
  if (violations.length > 0) {
    throw new RouterError("RESPONSE_ONLY_VIOLATION", "Codex attempted to use a tool in response-only mode");
  }
  const messages = completedItems.filter((item) => item.type === "agent_message" && typeof item.text === "string");
  if (messages.length === 0) {
    throw new RouterError("CODEX_RESPONSE_MISSING", "Codex CLI returned no final response");
  }
  const turn = [...events].reverse().find((event) => event.type === "turn.completed");
  const usage = turn?.usage ?? {};
  const warningItems = completedItems.filter((item) => item.type === "error").length;
  const stderrWarnings = stderr.split(/\r?\n/).filter((line) => /\b(?:ERROR|WARN)\b/i.test(line)).length;
  return {
    provider: selection.provider,
    model: selection.model,
    api_model: selection.api_model,
    account: selection.account,
    account_verified: true,
    text: messages.at(-1).text,
    usage: normalizeUsage(usage.input_tokens, usage.output_tokens, {
      cached_input_tokens: usage.cached_input_tokens ?? null,
      reasoning_output_tokens: usage.reasoning_output_tokens ?? null
    }),
    duration_ms: durationMs,
    cost_usd_equivalent: null,
    warning_count: warningItems + stderrWarnings,
    response_only: true
  };
}

export async function invokeOpenAI({
  selection,
  prompt,
  timeoutMs,
  systemPrompt = RESPONSE_ONLY_SYSTEM,
  run = runProcess
}) {
  const env = sanitizeEnvironment([
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENAI_ORG_ID",
    "AZURE_OPENAI_API_KEY",
    "AZURE_OPENAI_ENDPOINT"
  ]);
  const skillConfig = await disabledSkillsConfig();
  const responsePrompt = `${systemPrompt}\n\nREQUEST:\n${prompt}`;
  const result = await run({
    command: "codex",
    args: [
      "exec", "-",
      "--json",
      "--ephemeral",
      "--skip-git-repo-check",
      "--ignore-user-config",
      "--ignore-rules",
      "--disable", "plugins",
      "--disable", "apps",
      "--disable", "hooks",
      "--disable", "workspace_dependencies",
      "--disable", "shell_tool",
      "--disable", "skill_mcp_dependency_install",
      "-s", "read-only",
      "-m", selection.api_model,
      "-c", `model_reasoning_effort=${selection.effort}`,
      "-c", "approval_policy=never",
      "-c", "agents.enabled=false",
      "-c", "tools.web_search=false",
      "-c", skillConfig
    ],
    input: responsePrompt,
    cwd: os.tmpdir(),
    env,
    timeoutMs
  });
  if (result.code !== 0) {
    throw new RouterError("CODEX_CLI_FAILED", "Codex CLI exited unsuccessfully", { retryable: true });
  }
  return parseCodexResponse(result.stdout, result.stderr, selection, result.durationMs);
}
