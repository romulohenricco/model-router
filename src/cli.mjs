#!/usr/bin/env node
import { loadConfig } from "./config.mjs";
import { dispatchTask } from "./dispatcher.mjs";
import { publicError } from "./errors.mjs";
import { runDoctor } from "./doctor.mjs";
import { routeTask } from "./router.mjs";
import { logDecision } from "./telemetry.mjs";
import { getProviderBudget } from "./budget.mjs";
import { acknowledgeUpdates, isUpdateDue, loadUpdatePolicy, pendingNotice, readUpdateState, runUpdate, spawnBackgroundUpdate } from "./updates.mjs";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const KNOWN_FLAGS = new Set([
  "category", "risk", "sensitivity", "side_effects", "complexity", "latency", "budget", "author_provider",
  "session_account", "unavailable", "log", "approve", "approve_shadow", "no_fallback", "max_output_tokens",
  "timeout_ms", "live", "provider", "dry_run", "auto", "ack", "quiet"
]);

const HELP = `Usage: node src/cli.mjs <command> [flags]

Commands:
  init                     guided first-time setup (asks how you want to install)
  route                   decide provider/model/effort/fallbacks/verifier (pure decision; once a day it
                          may start the background model update - MODEL_ROUTER_AUTO_UPDATE=0 disables)
  dispatch                 route + execute in response-only mode (prompt on stdin)
  check                    validate config/model-catalog.json and config/routing-policy.json
  doctor [--live]          inspect providers and credentials (never prints secrets)
  budget --provider <id>   local API-credit estimate
  update-check             look for newer models (local CLI caches + public docs)
  update [--dry-run]       apply direct successors after a live smoke test (manual run always applies)
  update-status [--ack]    last update result / dismiss the notice

Decision flags: --category --risk --sensitivity --side-effects --complexity --latency
                --budget --author-provider --unavailable a,b --session-account --log
Dispatch flags: --approve-shadow --approve --max-output-tokens N --timeout-ms N --no-fallback --quiet`;

// Consumers of this router are kept in sync by scripts/propagate.mjs (when installed).
async function propagationNoticeIfInstalled() {
  const script = new URL("../scripts/propagate.mjs", import.meta.url);
  if (!existsSync(fileURLToPath(script))) return null;
  const { propagationNotice } = await import(script.href);
  return propagationNotice();
}

function parseArgs(argv) {
  const [command = "route", ...rest] = argv;
  const flags = {};
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token.startsWith("--")) throw new Error(`Unexpected argument: ${token}`);
    const key = token.slice(2).replaceAll("-", "_");
    const next = rest[i + 1];
    if (!next || next.startsWith("--")) flags[key] = true;
    else {
      flags[key] = next;
      i += 1;
    }
  }
  for (const key of Object.keys(flags)) {
    if (!KNOWN_FLAGS.has(key)) throw new Error(`Unknown flag: --${key.replaceAll("_", "-")} (see --help)`);
  }
  for (const key of ["timeout_ms", "max_output_tokens"]) {
    if (flags[key] !== undefined && !(Number.isInteger(Number(flags[key])) && Number(flags[key]) > 0)) {
      throw new Error(`--${key.replaceAll("_", "-")} must be a positive integer`);
    }
  }
  if (typeof flags.unavailable === "string") {
    flags.unavailable = flags.unavailable.split(",").map((value) => value.trim()).filter(Boolean);
  }
  return { command, flags };
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.some((arg) => arg === "--help" || arg === "-h" || arg === "help")) {
    console.log(HELP);
    return;
  }
  const { command, flags } = parseArgs(argv);
  try {
    // Optional .env next to the repo (Node >= 20.12); real environment variables win.
    process.loadEnvFile?.(fileURLToPath(new URL("../.env", import.meta.url)));
  } catch { /* no .env */ }
  if (command === "init") {
    const { runInit } = await import("./init.mjs");
    await runInit();
    return;
  }
  const { catalog, policy } = await loadConfig();

  if (command === "update-check" || command === "update") {
    const updatePolicy = await loadUpdatePolicy();
    const report = await runUpdate({ apply: command === "update", auto: Boolean(flags.auto), dryRun: Boolean(flags.dry_run), catalog, policy, updatePolicy });
    if (!flags.auto) console.log(JSON.stringify(report, null, 2));
    return;
  }
  if (command === "update-status") {
    console.log(JSON.stringify(flags.ack ? await acknowledgeUpdates() : await readUpdateState(), null, 2));
    return;
  }
  if (command === "route" || command === "dispatch") {
    try {
      const updatePolicy = await loadUpdatePolicy();
      if (await isUpdateDue(updatePolicy)) spawnBackgroundUpdate(fileURLToPath(import.meta.url));
      const notice = await pendingNotice();
      if (notice && !flags.quiet) console.error(notice);
      const propagation = await propagationNoticeIfInstalled();
      if (propagation && !flags.quiet) console.error(propagation);
    } catch { /* update checks never block routing */ }
  }

  if (command === "check") {
    const propagation = await propagationNoticeIfInstalled().catch(() => null);
    console.log(JSON.stringify({ ok: true, schema_version: 1, providers: Object.keys(catalog.providers).length, models: Object.keys(catalog.models).length, routes: Object.keys(policy.routes).length, ...(propagation ? { propagation_warning: propagation } : {}) }, null, 2));
    return;
  }
  if (command === "catalog") {
    const sanitized = structuredClone(catalog);
    for (const provider of Object.values(sanitized.providers)) delete provider.secret_ref;
    console.log(JSON.stringify(sanitized, null, 2));
    return;
  }
  if (command === "doctor") {
    console.log(JSON.stringify(await runDoctor(catalog, { live: Boolean(flags.live), provider: flags.provider ?? null }), null, 2));
    return;
  }
  if (command === "budget") {
    const ids = flags.provider ? [flags.provider] : Object.keys(catalog.providers);
    const rows = [];
    for (const id of ids) {
      const provider = catalog.providers[id];
      if (!provider) throw new Error(`Unknown provider: ${id}`);
      if (provider.budget_control) rows.push({ provider: id, ...(await getProviderBudget(id, provider)) });
    }
    console.log(JSON.stringify(rows, null, 2));
    return;
  }

  const routingInput = {
    category: flags.category,
    risk: flags.risk,
    sensitivity: flags.sensitivity,
    side_effects: flags.side_effects,
    complexity: flags.complexity,
    latency: flags.latency,
    budget: flags.budget,
    author_provider: flags.author_provider,
    session_account: flags.session_account,
    unavailable: flags.unavailable
  };

  if (command === "dispatch") {
    if (process.stdin.isTTY) throw new Error("Dispatch requires the prompt on stdin");
    let prompt = "";
    process.stdin.setEncoding("utf8");
    for await (const chunk of process.stdin) prompt += chunk;
    const result = await dispatchTask(routingInput, prompt, catalog, policy, {
      approve: Boolean(flags.approve),
      approveShadow: Boolean(flags.approve_shadow),
      noFallback: Boolean(flags.no_fallback),
      logDecisions: Boolean(flags.log),
      maxOutputTokens: flags.max_output_tokens ? Number(flags.max_output_tokens) : undefined,
      timeoutMs: flags.timeout_ms ? Number(flags.timeout_ms) : undefined
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.status === "verification_rejected") process.exitCode = 2;
    return;
  }

  if (command !== "route") throw new Error(`Unknown command: ${command}`);

  const decision = routeTask(routingInput, catalog, policy);
  if (flags.log) await logDecision(decision);
  console.log(JSON.stringify(decision, null, 2));
}

main().catch((error) => {
  console.error(JSON.stringify({ ok: false, error: publicError(error) }));
  process.exitCode = 1;
});
