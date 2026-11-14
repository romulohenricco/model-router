import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { invokeClaude } from "../src/adapters/claude.mjs";
import { invokeOpenAI } from "../src/adapters/openai.mjs";
import { CLI_BIN_ENV, resolveCliCommand, sanitizeEnvironment } from "../src/adapters/common.mjs";
import { runDoctor } from "../src/doctor.mjs";
import { detectCli } from "../src/init.mjs";

const VARS = Object.values(CLI_BIN_ENV);

function withEnv(overrides, fn) {
  const saved = Object.fromEntries(VARS.map((name) => [name, process.env[name]]));
  for (const name of VARS) delete process.env[name];
  Object.assign(process.env, overrides);
  const restore = () => {
    for (const name of VARS) {
      if (saved[name] === undefined) delete process.env[name];
      else process.env[name] = saved[name];
    }
  };
  let result;
  try {
    result = fn();
  } catch (error) {
    restore();
    throw error;
  }
  if (result && typeof result.then === "function") return result.finally(restore);
  restore();
  return result;
}

const selection = (provider, apiModel) => ({
  provider,
  model: apiModel,
  api_model: apiModel,
  account: `${provider}_account`,
  effort: "medium",
  mode: "active"
});

const claudeStdout = (apiModel) => JSON.stringify({
  subtype: "success",
  is_error: false,
  result: "ok",
  modelUsage: { [apiModel]: { inputTokens: 1, outputTokens: 1 } }
});

const codexStdout = [
  JSON.stringify({ type: "item.completed", item: { type: "agent_message", text: "ok" } }),
  JSON.stringify({ type: "turn.completed", usage: { input_tokens: 1, output_tokens: 1 } })
].join("\n");

function isInvalid(error) {
  return error?.name === "RouterError" && error.code === "CLI_PATH_INVALID";
}

test("CLI override unset keeps bare command names", () => withEnv({}, () => {
  assert.equal(resolveCliCommand("claude"), "claude");
  assert.equal(resolveCliCommand("codex"), "codex");
  assert.equal(resolveCliCommand("claude", { env: { MODEL_ROUTER_CLAUDE_BIN: "" } }), "claude");
}));

test("CLI override accepts an absolute path to an existing regular file", () => {
  const env = { MODEL_ROUTER_CLAUDE_BIN: process.execPath, MODEL_ROUTER_CODEX_BIN: process.execPath };
  assert.equal(resolveCliCommand("claude", { env }), process.execPath);
  assert.equal(resolveCliCommand("codex", { env }), process.execPath);
});

test("CLI override rejects relative, missing, directory and unknown values with CLI_PATH_INVALID", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "router-cli-bin-"));
  try {
    for (const value of ["claude", "./bin/claude", path.join(dir, "missing.exe"), dir]) {
      assert.throws(() => resolveCliCommand("claude", { env: { MODEL_ROUTER_CLAUDE_BIN: value } }), isInvalid, value);
      assert.throws(() => resolveCliCommand("codex", { env: { MODEL_ROUTER_CODEX_BIN: value } }), isInvalid, value);
    }
    assert.throws(() => resolveCliCommand("gemini", { env: {} }), isInvalid);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CLI override rejects .cmd/.bat shims on Windows", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "router-cli-bin-"));
  try {
    const shim = path.join(dir, "codex.cmd");
    writeFileSync(shim, "@echo off\r\n");
    assert.throws(() => resolveCliCommand("codex", { env: { MODEL_ROUTER_CODEX_BIN: shim }, platform: "win32" }), isInvalid);
    if (process.platform !== "win32") {
      assert.equal(resolveCliCommand("codex", { env: { MODEL_ROUTER_CODEX_BIN: shim }, platform: "linux" }), shim);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("sanitizeEnvironment never strips the CLI override variables", () => {
  const source = {
    MODEL_ROUTER_CLAUDE_BIN: "/opt/claude",
    MODEL_ROUTER_CODEX_BIN: "/opt/codex",
    ANTHROPIC_API_KEY: "secret",
    MINIMAX_API_KEY: "secret"
  };
  const env = sanitizeEnvironment(["ANTHROPIC_API_KEY", ...VARS], source);
  assert.equal(env.MODEL_ROUTER_CLAUDE_BIN, "/opt/claude");
  assert.equal(env.MODEL_ROUTER_CODEX_BIN, "/opt/codex");
  assert.equal(env.ANTHROPIC_API_KEY, undefined);
  assert.equal(env.MINIMAX_API_KEY, undefined);
});

test("invokeClaude spawns the configured executable and passes the override through", () => withEnv(
  { MODEL_ROUTER_CLAUDE_BIN: process.execPath },
  async () => {
    let call;
    const run = async (options) => {
      call = options;
      return { code: 0, stdout: claudeStdout("claude-test"), stderr: "", durationMs: 1 };
    };
    await invokeClaude({ selection: selection("claude", "claude-test"), prompt: "hi", timeoutMs: 1000, run });
    assert.equal(call.command, process.execPath);
    assert.equal(call.env.MODEL_ROUTER_CLAUDE_BIN, process.execPath);
  }
));

test("invokeClaude defaults to the bare claude command", () => withEnv({}, async () => {
  let call;
  const run = async (options) => {
    call = options;
    return { code: 0, stdout: claudeStdout("claude-test"), stderr: "", durationMs: 1 };
  };
  await invokeClaude({ selection: selection("claude", "claude-test"), prompt: "hi", timeoutMs: 1000, run });
  assert.equal(call.command, "claude");
}));

test("invokeOpenAI spawns the configured executable and passes the override through", () => withEnv(
  { MODEL_ROUTER_CODEX_BIN: process.execPath },
  async () => {
    let call;
    const run = async (options) => {
      call = options;
      return { code: 0, stdout: codexStdout, stderr: "", durationMs: 1 };
    };
    await invokeOpenAI({ selection: selection("openai", "gpt-test"), prompt: "hi", timeoutMs: 1000, run });
    assert.equal(call.command, process.execPath);
    assert.equal(call.env.MODEL_ROUTER_CODEX_BIN, process.execPath);
  }
));

test("invalid override fails before any process is spawned", () => withEnv(
  { MODEL_ROUTER_CLAUDE_BIN: "relative/claude", MODEL_ROUTER_CODEX_BIN: "relative/codex" },
  async () => {
    let spawned = false;
    const run = async () => {
      spawned = true;
      return { code: 0, stdout: "", stderr: "", durationMs: 1 };
    };
    await assert.rejects(invokeClaude({ selection: selection("claude", "m"), prompt: "x", timeoutMs: 1000, run }), isInvalid);
    await assert.rejects(invokeOpenAI({ selection: selection("openai", "m"), prompt: "x", timeoutMs: 1000, run }), isInvalid);
    assert.equal(spawned, false);
  }
));

test("doctor live probe reports CLI_PATH_INVALID for an invalid override", () => withEnv(
  { MODEL_ROUTER_CLAUDE_BIN: "relative/claude", MODEL_ROUTER_CODEX_BIN: "relative/codex" },
  async () => {
    const catalog = {
      models: {},
      providers: {
        claude: { adapter: "claude_cli", accounts: [] },
        openai: { adapter: "codex_cli", accounts: [] }
      }
    };
    const results = await runDoctor(catalog, { live: true });
    assert.deepEqual(results.map((r) => [r.status, r.error_code]), [
      ["auth_probe_failed", "CLI_PATH_INVALID"],
      ["auth_probe_failed", "CLI_PATH_INVALID"]
    ]);
  }
));

test("init detection probes a configured executable directly and reports an invalid one", () => {
  withEnv({ MODEL_ROUTER_CODEX_BIN: process.execPath }, () => {
    const found = detectCli("codex");
    assert.equal(found.installed, true);
    assert.equal(found.path, process.execPath);
    assert.equal(found.version, process.version);
  });
  withEnv({ MODEL_ROUTER_CLAUDE_BIN: "relative/claude" }, () => {
    assert.deepEqual(detectCli("claude"), { installed: false, error_code: "CLI_PATH_INVALID" });
  });
});
