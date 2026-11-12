// Model update checker: discovers newer models from local CLI caches and public
// provider docs, plans direct-successor swaps and (optionally) applies them after
// a live smoke test. Never sends prompts, secrets or user data anywhere.
import { mkdir, open, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { validateConfig } from "./config.mjs";
import { getLogRoot } from "./telemetry.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_DOC_CHARS = 2 * 1024 * 1024;
// Worst case: 8 model lines x 180 s smoke + fetches. Stay well above it.
const LOCK_STALE_MS = 60 * 60 * 1000;

export function defaultLogRoot() {
  return getLogRoot();
}

export async function loadUpdatePolicy(root = ROOT) {
  try {
    return JSON.parse(await readFile(path.join(root, "config", "update-policy.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

// ---------- model id parsing ----------

export function parseModelId(id, lines = {}) {
  let m = /^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$/.exec(id);
  if (m && (lines.anthropic ?? []).includes(m[1])) {
    return { provider: "anthropic", line: m[1], version: [Number(m[2]), Number(m[3] ?? 0)] };
  }
  m = /^gpt-(\d+)(?:\.(\d+))?-([a-z]+)$/.exec(id);
  if (m && (lines.openai ?? []).includes(m[3])) {
    return { provider: "openai", line: m[3], version: [Number(m[1]), Number(m[2] ?? 0)] };
  }
  return null;
}

export function compareVersions(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i += 1) {
    const d = (a[i] ?? 0) - (b[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------- sources ----------

async function fetchText(url, { allowedHosts, timeoutMs, fetchImpl }) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname)) {
    throw new Error(`Update source host not allowlisted: ${parsed.hostname}`);
  }
  const response = await fetchImpl(parsed, { signal: AbortSignal.timeout(timeoutMs), headers: { Accept: "text/markdown, text/plain" } });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  return text.slice(0, MAX_DOC_CHARS);
}

export function extractAnthropicIds(markdown) {
  // Prefer the "Claude API ID" row of the latest-models table; fall back to all backticked ids.
  const row = markdown.split("\n").find((line) => /\|\s*Claude API ID\s*\|/.test(line));
  const scope = row ?? markdown;
  return [...new Set([...scope.matchAll(/`(claude-[a-z]+-\d+(?:-\d+)?)`/g)].map((x) => x[1]))];
}

export function extractOpenAIIds(text) {
  return [...new Set([...text.matchAll(/\b(gpt-\d+(?:\.\d+)?-[a-z]+)\b/g)].map((x) => x[1]))];
}

export function extractCodexCacheIds(json) {
  const models = Array.isArray(json) ? json : json.models ?? [];
  return models.filter((m) => m.slug && (m.visibility ?? "list") === "list").map((m) => m.slug);
}

async function readSource(source, ctx) {
  switch (source.type) {
    case "anthropic_docs_md":
      return extractAnthropicIds(await fetchText(source.url, ctx));
    case "openai_docs_md":
      return extractOpenAIIds(await fetchText(source.url, ctx));
    case "codex_models_cache": {
      const home = process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
      return extractCodexCacheIds(JSON.parse(await readFile(path.join(home, "models_cache.json"), "utf8")));
    }
    default:
      throw new Error(`Unknown update source type: ${source.type}`);
  }
}

export async function discoverModels(updatePolicy, { fetchImpl = fetch, sourceReader = readSource } = {}) {
  const ctx = { allowedHosts: updatePolicy.allowed_hosts ?? [], timeoutMs: updatePolicy.timeout_ms ?? 15_000, fetchImpl };
  const discovered = {};
  const sources = [];
  for (const [provider, list] of Object.entries(updatePolicy.sources ?? {})) {
    discovered[provider] = new Set();
    for (const source of list) {
      try {
        const ids = await sourceReader(source, ctx);
        ids.forEach((id) => discovered[provider].add(id));
        sources.push({ provider, type: source.type, ok: true, ids: ids.length });
      } catch (error) {
        sources.push({ provider, type: source.type, ok: false, error: String(error.message ?? error).slice(0, 200) });
      }
    }
  }
  return { discovered: Object.fromEntries(Object.entries(discovered).map(([k, v]) => [k, [...v].sort()])), sources };
}

// ---------- planning ----------

export function planUpdates(catalog, discovered, updatePolicy) {
  const lines = updatePolicy.lines ?? {};
  const newestInCatalog = {};
  for (const id of Object.keys(catalog.models)) {
    const p = parseModelId(id, lines);
    if (!p || catalog.models[id].provider !== p.provider) continue;
    const key = `${p.provider}:${p.line}`;
    if (!newestInCatalog[key] || compareVersions(p.version, newestInCatalog[key].version) > 0) newestInCatalog[key] = { id, ...p };
  }
  const newestDiscovered = {};
  for (const [provider, ids] of Object.entries(discovered)) {
    for (const id of ids) {
      const p = parseModelId(id, lines);
      if (!p || p.provider !== provider) continue;
      const key = `${p.provider}:${p.line}`;
      if (!newestDiscovered[key] || compareVersions(p.version, newestDiscovered[key].version) > 0) newestDiscovered[key] = { id, ...p };
    }
  }
  const updates = [];
  const newLines = [];
  for (const [key, found] of Object.entries(newestDiscovered)) {
    const current = newestInCatalog[key];
    if (!current) {
      newLines.push({ provider: found.provider, line: found.line, model: found.id, action: "recommend_only", reason: "new model line with no predecessor in the catalog" });
      continue;
    }
    if (catalog.models[found.id] || compareVersions(found.version, current.version) <= 0) continue;
    const pinned = catalog.models[current.id].pinned === true;
    updates.push({
      provider: found.provider,
      line: found.line,
      from: current.id,
      to: found.id,
      action: pinned ? "add_only" : "replace",
      reason: pinned ? `${current.id} is pinned; new model is added to the catalog without changing routes` : "direct successor in the same model line"
    });
  }
  return { updates, new_lines: newLines };
}

const SLOT_PATHS = [["defaults", "controller"], ["defaults", "coding"], ["guardrails", "safe_controller"], ["guardrails", "critical_verifier"]];

export function applyPlan(catalog, policy, plan, { date }) {
  const nextCatalog = structuredClone(catalog);
  const nextPolicy = structuredClone(policy);
  const changes = [];
  for (const u of plan.updates) {
    if (u.skip) continue;
    const prev = nextCatalog.models[u.from];
    const { version_note: _note, pinned: _pinned, pricing_usd_per_million_tokens: _price, pricing_source: _src, pricing_checked_at: _chk, smoke_status: _smoke, ...base } = prev;
    nextCatalog.models[u.to] = {
      ...base,
      api_model: u.to,
      version_note: `Auto-added on ${date} as direct successor of ${u.from}.`,
      smoke_status: u.smoke ?? "not_run",
      added_by: "update-check"
    };
    prev.version_note = `${prev.version_note ? `${prev.version_note} ` : ""}Superseded by ${u.to} on ${date}; kept as fallback.`.trim();
    if (u.action !== "replace") { changes.push({ ...u, slots: [] }); continue; }
    const slots = [];
    for (const [category, route] of Object.entries(nextPolicy.routes)) {
      if (route.primary === u.from) {
        route.primary = u.to;
        route.fallbacks = [u.from, ...route.fallbacks];
        slots.push(`${category}.primary`);
      }
      const fi = route.fallbacks.indexOf(u.from);
      if (fi >= 0 && !route.fallbacks.includes(u.to) && route.primary !== u.to) {
        route.fallbacks.splice(fi, 0, u.to);
        slots.push(`${category}.fallbacks`);
      }
      if (route.verifiers.includes(u.from)) {
        route.verifiers = [...new Set(route.verifiers.map((m) => (m === u.from ? u.to : m)))];
        slots.push(`${category}.verifiers`);
      }
      route.fallbacks = [...new Set(route.fallbacks)].filter((m) => m !== route.primary);
    }
    for (const [section, key] of SLOT_PATHS) {
      if (nextPolicy[section]?.[key] === u.from) {
        nextPolicy[section][key] = u.to;
        slots.push(`${section}.${key}`);
      }
    }
    changes.push({ ...u, slots });
  }
  if (changes.length) {
    nextCatalog.updated_at = date;
    nextPolicy.updated_at = date;
  }
  validateConfig(nextCatalog, nextPolicy);
  return { catalog: nextCatalog, policy: nextPolicy, changes };
}

// ---------- smoke ----------

async function defaultSmoke(catalog, modelId) {
  const { invokeModel } = await import("./adapters/index.mjs");
  const model = catalog.models[modelId];
  const provider = catalog.providers[model.provider];
  const selection = { provider: model.provider, model: modelId, api_model: model.api_model, account: provider.accounts[0], effort: "low", mode: provider.mode };
  const result = await invokeModel({ selection, prompt: "Reply with exactly the word: PONG", catalog, timeoutMs: 180_000, maxOutputTokens: 200 });
  return /PONG/.test(String(result.text ?? ""));
}

// ---------- state / locking ----------

async function readJson(file, fallback) {
  try { return JSON.parse(await readFile(file, "utf8")); } catch { return fallback; }
}

async function writeJsonAtomic(file, value) {
  await mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  await writeFile(tmp, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tmp, file);
}

async function withLock(dir, fn) {
  await mkdir(dir, { recursive: true });
  const lock = path.join(dir, "update.lock");
  try {
    const s = await stat(lock);
    if (Date.now() - s.mtimeMs > LOCK_STALE_MS) await rm(lock, { force: true });
  } catch { /* no lock */ }
  let handle;
  const token = `${process.pid}-${Date.now()}`;
  try {
    handle = await open(lock, "wx");
    await handle.writeFile(token, "utf8");
  } catch {
    return { skipped: true, reason: "another update is running" };
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    // Only remove the lock if it is still ours.
    if ((await readFile(lock, "utf8").catch(() => "")) === token) await rm(lock, { force: true });
  }
}

export function statePath(logRoot = defaultLogRoot()) {
  return path.join(logRoot, "updates", "state.json");
}

export async function readUpdateState(logRoot = defaultLogRoot()) {
  return readJson(statePath(logRoot), {});
}

function noticeKeys(state) {
  return [
    ...(state.last_applied ?? []).map((c) => `applied:${c.to}`),
    ...(state.pending ?? []).map((p) => `pending:${p.to}`),
    ...(state.new_lines ?? []).map((n) => `line:${n.model}`)
  ];
}

export async function acknowledgeUpdates(logRoot = defaultLogRoot()) {
  const state = await readUpdateState(logRoot);
  state.acknowledged_at = new Date().toISOString();
  state.acknowledged = noticeKeys(state);
  await writeJsonAtomic(statePath(logRoot), state);
  return state;
}

// ---------- main entry ----------

export async function runUpdate({
  apply = false,
  auto = false,
  dryRun = false,
  root = ROOT,
  logRoot = defaultLogRoot(),
  catalog,
  policy,
  updatePolicy,
  fetchImpl,
  sourceReader,
  smoke = defaultSmoke,
  now = new Date()
} = {}) {
  updatePolicy ??= await loadUpdatePolicy(root);
  if (!updatePolicy) return { ok: false, error: "config/update-policy.json not found" };
  const dir = path.join(logRoot, "updates");
  return withLock(dir, async () => {
    const date = now.toISOString().slice(0, 10);
    const previous = await readUpdateState(logRoot);
    let sources = [];
    let discovered = {};
    let plan = { updates: [], new_lines: [] };
    let changes = [];
    // A manual `update` always applies (after the smoke gate); the background run only when policy allows it.
    const willApply = apply && !dryRun && (!auto || updatePolicy.apply === "direct_successors");
    try {
    ({ discovered, sources } = await discoverModels(updatePolicy, { fetchImpl, sourceReader }));
    plan = planUpdates(catalog, discovered, updatePolicy);
    if (willApply && plan.updates.length) {
      for (const u of plan.updates) {
        if (u.action !== "replace" || !updatePolicy.smoke_before_apply) continue;
        try {
          u.smoke = (await smoke({ ...catalog, models: { ...catalog.models, [u.to]: { ...catalog.models[u.from], api_model: u.to } } }, u.to)) ? "passed" : "failed";
        } catch (error) {
          u.smoke = "failed";
          u.smoke_error = String(error.code ?? error.message ?? error).slice(0, 120);
        }
        if (u.smoke !== "passed") {
          u.skip = true;
          u.reason = `live smoke ${u.smoke}; not applied`;
        }
      }
      const result = applyPlan(catalog, policy, plan, { date });
      changes = result.changes;
      if (changes.length) {
        const backup = path.join(dir, "backups", now.toISOString().replace(/[:.]/g, "-"));
        await writeJsonAtomic(path.join(backup, "model-catalog.json"), catalog);
        await writeJsonAtomic(path.join(backup, "routing-policy.json"), policy);
        await writeJsonAtomic(path.join(root, "config", "model-catalog.json"), result.catalog);
        try {
          await writeJsonAtomic(path.join(root, "config", "routing-policy.json"), result.policy);
        } catch (error) {
          // Keep catalog and policy consistent: roll the catalog back.
          await writeJsonAtomic(path.join(root, "config", "model-catalog.json"), catalog);
          throw error;
        }
      }
    }
    } catch (error) {
      await writeJsonAtomic(statePath(logRoot), {
        ...previous,
        last_check_at: now.toISOString(),
        last_error: String(error.code ?? error.message ?? error).slice(0, 200)
      });
      throw error;
    }
    const report = {
      ok: true,
      checked_at: now.toISOString(),
      mode: willApply ? "apply" : "check",
      sources,
      discovered,
      plan,
      applied: changes,
      up_to_date: plan.updates.length === 0 && plan.new_lines.length === 0
    };
    await writeJsonAtomic(statePath(logRoot), {
      acknowledged: previous.acknowledged ?? [],
      last_check_at: report.checked_at,
      last_mode: report.mode,
      pending: plan.updates.filter((u) => !changes.some((c) => c.to === u.to)).map(({ from, to, action, reason }) => ({ from, to, action, reason })),
      new_lines: plan.new_lines,
      last_applied: changes.length ? changes.map(({ from, to, slots, smoke: s }) => ({ from, to, slots, smoke: s ?? "not_run", applied_at: report.checked_at })) : previous.last_applied ?? [],
      acknowledged_at: changes.length ? null : previous.acknowledged_at ?? null,
      sources_failed: sources.filter((s) => !s.ok).length
    });
    await writeJsonAtomic(path.join(dir, `${date}.json`), report);
    return report;
  });
}

// ---------- automatic daily trigger ----------

export async function isUpdateDue(updatePolicy, logRoot = defaultLogRoot(), now = Date.now()) {
  if (!updatePolicy?.auto) return false;
  if (process.env.MODEL_ROUTER_AUTO_UPDATE === "0" || process.env.CI) return false;
  const state = await readUpdateState(logRoot);
  const last = Date.parse(state.last_check_at ?? 0) || 0;
  return now - last >= (updatePolicy.interval_hours ?? 24) * 3_600_000;
}

export function spawnBackgroundUpdate(cliPath) {
  const child = spawn(process.execPath, [cliPath, "update", "--auto"], {
    detached: true,
    stdio: "ignore",
    windowsHide: true,
    env: { ...process.env, MODEL_ROUTER_AUTO_UPDATE: "0" }
  });
  child.unref();
}

export async function pendingNotice(logRoot = defaultLogRoot()) {
  const state = await readUpdateState(logRoot);
  const seen = new Set(state.acknowledged ?? []);
  const applied = (state.last_applied ?? []).filter((c) => !seen.has(`applied:${c.to}`));
  const pending = (state.pending ?? []).filter((p) => !seen.has(`pending:${p.to}`));
  const lines = (state.new_lines ?? []).filter((n) => !seen.has(`line:${n.model}`));
  const parts = [];
  if (applied.length) parts.push(`updated ${applied.map((c) => `${c.from} -> ${c.to}`).join(", ")}`);
  if (pending.length) parts.push(`${pending.length} update(s) pending review`);
  if (lines.length) parts.push(`${lines.length} new model line(s) available`);
  if (state.last_error) parts.push(`last update failed (${state.last_error})`);
  return parts.length ? `model-router: ${parts.join("; ")}. Run "update-status" for details ("update-status --ack" to dismiss).` : null;
}
