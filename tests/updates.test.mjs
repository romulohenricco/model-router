import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile, cp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { loadConfig } from "../src/config.mjs";
import {
  applyPlan, extractAnthropicIds, extractCodexCacheIds, extractOpenAIIds, isUpdateDue,
  loadUpdatePolicy, parseModelId, pendingNotice, planUpdates, runUpdate
} from "../src/updates.mjs";

const { catalog, policy } = await loadConfig();
const updatePolicy = await loadUpdatePolicy();
const lines = updatePolicy.lines;

test("model ids parse into provider, line and version", () => {
  assert.deepEqual(parseModelId("claude-sonnet-5-5", lines), { provider: "anthropic", line: "sonnet", version: [5, 5] });
  assert.deepEqual(parseModelId("claude-haiku-4-5-20251001", lines), { provider: "anthropic", line: "haiku", version: [4, 5] });
  assert.deepEqual(parseModelId("gpt-6.1-sol", lines), { provider: "openai", line: "sol", version: [6, 1] });
  assert.equal(parseModelId("claude-mythos-5-2", lines), null);
  assert.equal(parseModelId("gpt-6-cyber", lines), null);
});

test("source extractors read the documented formats", () => {
  const md = "| Claude API ID | `claude-fable-5-2` | `claude-opus-5-5` |\n| Other | `claude-old-1` |";
  assert.deepEqual(extractAnthropicIds(md), ["claude-fable-5-2", "claude-opus-5-5"]);
  assert.deepEqual(extractOpenAIIds("use gpt-6-astra or gpt-6.1-sol"), ["gpt-6-astra", "gpt-6.1-sol"]);
  assert.deepEqual(extractCodexCacheIds({ models: [{ slug: "gpt-6.1-sol", visibility: "list" }, { slug: "x", visibility: "hide" }] }), ["gpt-6.1-sol"]);
});

test("current catalog is up to date against the same ids", () => {
  const plan = planUpdates(catalog, { anthropic: ["claude-fable-5-2", "claude-sonnet-5-5"], openai: ["gpt-6.1-sol", "gpt-6-luna"] }, updatePolicy);
  assert.equal(plan.updates.length, 0);
});

test("direct successor replaces every slot and keeps the predecessor as fallback", () => {
  const plan = planUpdates(catalog, { anthropic: ["claude-sonnet-5-7"], openai: ["gpt-6.2-sol"] }, updatePolicy);
  assert.deepEqual(plan.updates.map((u) => [u.from, u.to, u.action]), [
    ["claude-sonnet-5-5", "claude-sonnet-5-7", "replace"],
    ["gpt-6.1-sol", "gpt-6.2-sol", "replace"]
  ]);
  const { catalog: c, policy: p, changes } = applyPlan(catalog, policy, plan, { date: "2030-01-01" });
  assert.equal(c.models["claude-sonnet-5-7"].api_model, "claude-sonnet-5-7");
  assert.equal(p.defaults.controller, "claude-sonnet-5-7");
  assert.equal(p.guardrails.critical_verifier, "gpt-6.2-sol");
  assert.equal(p.routes.critical_review.primary, "gpt-6.2-sol");
  assert.equal(p.routes.critical_review.fallbacks[0], "gpt-6.1-sol");
  assert.ok(!JSON.stringify(p.routes).includes('"claude-sonnet-5-5"]') || p.routes.operational_support.fallbacks.includes("claude-sonnet-5-5"));
  assert.ok(changes.every((x) => x.slots.length > 0));
});

test("pinned models only get the successor added to the catalog", () => {
  const pinned = structuredClone(catalog);
  pinned.models["claude-sonnet-5-5"].pinned = true;
  const plan = planUpdates(pinned, { anthropic: ["claude-sonnet-5-7"] }, updatePolicy);
  assert.equal(plan.updates[0].action, "add_only");
  const { catalog: c, policy: p } = applyPlan(pinned, policy, plan, { date: "2030-01-01" });
  assert.ok(c.models["claude-sonnet-5-7"]);
  assert.equal(p.defaults.controller, "claude-sonnet-5-5");
});

test("new model lines are recommended, never auto-routed", () => {
  const plan = planUpdates(catalog, { anthropic: [] , openai: [] }, { ...updatePolicy, lines: { ...lines, anthropic: [...lines.anthropic, "mythos"] } });
  assert.equal(plan.new_lines.length, 0);
  const plan2 = planUpdates(catalog, { anthropic: ["claude-mythos-5-2"] }, { ...updatePolicy, lines: { ...lines, anthropic: [...lines.anthropic, "mythos"] } });
  assert.equal(plan2.new_lines[0].model, "claude-mythos-5-2");
});

async function sandbox() {
  const root = await mkdtemp(path.join(os.tmpdir(), "mr-upd-"));
  await mkdir(path.join(root, "config"));
  await cp(path.resolve("config"), path.join(root, "config"), { recursive: true });
  return root;
}

test("update applies after a passing smoke, writes backups and a notice", async () => {
  const root = await sandbox();
  const logRoot = path.join(root, "logs");
  const report = await runUpdate({
    apply: true, root, logRoot, catalog, policy, updatePolicy,
    sourceReader: async (s) => (s.type.startsWith("anthropic") ? ["claude-haiku-5-7"] : []),
    smoke: async () => true,
    now: new Date("2030-01-01T00:00:00Z")
  });
  assert.equal(report.applied[0].to, "claude-haiku-5-7");
  const written = JSON.parse(await readFile(path.join(root, "config", "model-catalog.json"), "utf8"));
  assert.ok(written.models["claude-haiku-5-7"]);
  assert.match(await pendingNotice(logRoot), /claude-haiku-5-5 -> claude-haiku-5-7/);
  assert.equal(await isUpdateDue({ auto: true, interval_hours: 24 }, logRoot, Date.parse("2030-01-01T12:00:00Z")), false);
});

test("failed smoke keeps the config untouched and leaves the update pending", async () => {
  const root = await sandbox();
  const logRoot = path.join(root, "logs");
  const before = await readFile(path.join(root, "config", "routing-policy.json"), "utf8");
  const report = await runUpdate({
    apply: true, root, logRoot, catalog, policy, updatePolicy,
    sourceReader: async (s) => (s.type === "codex_models_cache" ? ["gpt-7-luna"] : []),
    smoke: async () => false
  });
  assert.equal(report.applied.length, 0);
  assert.equal(await readFile(path.join(root, "config", "routing-policy.json"), "utf8"), before);
  assert.match(await pendingNotice(logRoot), /1 update\(s\) pending/);
});

test("unreachable sources are reported, never thrown", async () => {
  const root = await sandbox();
  const report = await runUpdate({
    root, logRoot: path.join(root, "logs"), catalog, policy, updatePolicy,
    sourceReader: async () => { throw new Error("offline"); }
  });
  assert.equal(report.ok, true);
  assert.ok(report.sources.every((s) => s.ok === false));
});

test("non-allowlisted hosts are refused", async () => {
  const report = await runUpdate({
    root: await sandbox(), logRoot: path.join(os.tmpdir(), `mr-upd-${process.pid}`), catalog, policy,
    updatePolicy: { ...updatePolicy, sources: { anthropic: [{ type: "anthropic_docs_md", url: "https://evil.example/x.md" }] } },
    fetchImpl: async () => { throw new Error("must not fetch"); }
  });
  assert.match(report.sources[0].error, /not allowlisted/);
});

test("recommend_only: background run never applies, a manual update does", async () => {
  const policyRO = { ...updatePolicy, apply: "recommend_only" };
  const reader = async (s) => (s.type.startsWith("anthropic") ? ["claude-haiku-5-7"] : []);
  const root1 = await sandbox();
  const auto = await runUpdate({ apply: true, auto: true, root: root1, logRoot: path.join(root1, "logs"), catalog, policy, updatePolicy: policyRO, sourceReader: reader, smoke: async () => true });
  assert.equal(auto.applied.length, 0);
  const root2 = await sandbox();
  const manual = await runUpdate({ apply: true, root: root2, logRoot: path.join(root2, "logs"), catalog, policy, updatePolicy: policyRO, sourceReader: reader, smoke: async () => true });
  assert.equal(manual.applied[0].to, "claude-haiku-5-7");
});

test("--ack dismisses pending and new-line notices until something new appears", async () => {
  const { acknowledgeUpdates } = await import("../src/updates.mjs");
  const root = await sandbox();
  const logRoot = path.join(root, "logs");
  await runUpdate({ root, logRoot, catalog, policy, updatePolicy, sourceReader: async (s) => (s.type === "codex_models_cache" ? ["gpt-7-luna"] : []) });
  assert.match(await pendingNotice(logRoot), /pending/);
  await acknowledgeUpdates(logRoot);
  assert.equal(await pendingNotice(logRoot), null);
  await runUpdate({ root, logRoot, catalog, policy, updatePolicy, sourceReader: async (s) => (s.type === "codex_models_cache" ? ["gpt-7-luna", "gpt-7-sol"] : []) });
  assert.match(await pendingNotice(logRoot), /1 update\(s\) pending/);
});

test("a failed apply is recorded in the state and keeps catalog and policy consistent", async () => {
  const root = await sandbox();
  const logRoot = path.join(root, "logs");
  await assert.rejects(() => runUpdate({
    apply: true, root, logRoot, catalog, policy: { ...policy, routes: { broken: { primary: "nope", fallbacks: [], verifiers: [] } } }, updatePolicy,
    sourceReader: async (s) => (s.type.startsWith("anthropic") ? ["claude-haiku-5-7"] : []), smoke: async () => true
  }));
  const { readUpdateState } = await import("../src/updates.mjs");
  assert.ok((await readUpdateState(logRoot)).last_error);
  assert.match(await pendingNotice(logRoot), /last update failed/);
});
