// Guided first-time setup. Asks how the user wants to install the router
// (universal vs per-project), which providers they have, how secrets are
// provided, and how automatic model updates should behave. Nothing is installed
// or written without an explicit "yes".
import { spawnSync } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { mkdir, readFile, writeFile, copyFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import readline from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { validateConfig } from "./config.mjs";
import { routeTask } from "./router.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export function detectTool(command) {
  const finder = process.platform === "win32" ? "where" : "which";
  const found = spawnSync(finder, [command], { encoding: "utf8", windowsHide: true });
  if (found.status !== 0) return { installed: false };
  // command is one of our fixed tool names, never user input
  const version = spawnSync(`${command} --version`, { encoding: "utf8", windowsHide: true, shell: true, timeout: 15_000 });
  return { installed: true, version: (version.stdout || "").trim().split("\n")[0] || null };
}

export function detectEnvironment() {
  return {
    os: `${process.platform} ${os.release()}`,
    node: process.version,
    claude: detectTool("claude"),
    codex: detectTool("codex"),
    op: detectTool("op"),
    minimax_key: Boolean(process.env.MINIMAX_API_KEY),
    zai_key: Boolean(process.env.ZAI_API_KEY)
  };
}

async function readJson(rel) {
  return JSON.parse(await readFile(path.join(ROOT, rel), "utf8"));
}

async function writeJson(rel, value) {
  await writeFile(path.join(ROOT, rel), `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

/** Pure: turn answers into config changes (used by the CLI and by tests). */
export function applyAnswers(catalog, policy, updatePolicy, answers) {
  const c = structuredClone(catalog);
  const u = structuredClone(updatePolicy);
  c.providers.anthropic.enabled = answers.providers.includes("anthropic");
  c.providers.openai.enabled = answers.providers.includes("openai");
  c.providers.minimax.enabled = answers.providers.includes("minimax");
  c.providers.glm.enabled = answers.providers.includes("glm");
  if (answers.secrets === "1password") {
    if (answers.minimax_ref) c.providers.minimax.secret_ref = answers.minimax_ref;
    if (answers.glm_ref) c.providers.glm.secret_ref = answers.glm_ref;
  }
  u.auto = answers.update_mode !== "off";
  u.interval_hours = answers.update_mode === "weekly" ? 168 : 24;
  u.apply = answers.update_apply;
  if (!c.providers.openai.enabled) u.sources.openai = [];
  if (!c.providers.anthropic.enabled) u.sources.anthropic = [];
  validateConfig(c, policy);
  return { catalog: c, updatePolicy: u };
}

/** Which routes still work with the chosen providers (default, high-risk and deploy scenarios). */
export function routeCoverage(catalog, policy) {
  const broken = new Set();
  const failClosed = new Set();
  for (const category of Object.keys(policy.routes)) {
    for (const extra of [{}, { risk: "high" }, { side_effects: "deploy" }]) {
      const label = Object.keys(extra).length ? `${category} (${Object.values(extra)[0]})` : category;
      try {
        if (routeTask({ category, ...extra }, catalog, policy).fail_closed) failClosed.add(label);
      } catch {
        broken.add(label);
      }
    }
  }
  return { broken: [...broken], fail_closed: [...failClosed] };
}

function skillText(cliPath) {
  return `---
name: model-router
description: Decide which AI model/provider/effort/verifier should handle a task, and optionally dispatch it in response-only mode. Use before delegating material work to another model, or when the user asks which model to use.
---

# model-router

Deterministic router installed at \`${cliPath}\`.

1. Classify the task into one category: deep_reasoning, mechanical_coding, critical_review, research,
   executive_synthesis, documentation, comparative_analysis, operational_support, long_horizon_engineering, standard_coding.
2. Declare constraints when material: --risk low|medium|high|critical, --sensitivity public|internal|confidential|restricted,
   --side-effects none|write|deploy|destructive, --complexity simple|medium|complex.
3. Decide: \`node "${cliPath}" route --category <category> [constraints]\` (never put the user's prompt on the command line).
4. Obey the decision literally: fail_closed -> stop and report; mode shadow -> ask the user before --approve-shadow;
   high risk/deploy/destructive -> ask the user before --approve; run the verifier when one is returned.
5. To execute, pipe the prompt on stdin: \`<prompt> | node "${cliPath}" dispatch --category <category>\`.
6. If stderr shows a "model-router: updated ..." notice, tell the user which models changed.
`;
}

const ASK = {
  async choice(rl, question, options, fallback) {
    const list = options.map((o, i) => `  ${i + 1}) ${o.label}`).join("\n");
    const raw = (await rl.question(`\n${question}\n${list}\n> [${fallback + 1}] `)).trim();
    const n = raw ? Number(raw) - 1 : fallback;
    return options[Number.isInteger(n) && options[n] ? n : fallback].value;
  },
  async yes(rl, question, fallback = true) {
    const raw = (await rl.question(`\n${question} ${fallback ? "[S/n]" : "[s/N]"} `)).trim().toLowerCase();
    return raw ? raw.startsWith("s") || raw.startsWith("y") : fallback;
  }
};

export async function runInit() {
  if (!process.stdin.isTTY) {
    console.log("`init` é interativo: rode num terminal, ou peça ao seu agente de IA para seguir o INSTALL.md (ele fará as mesmas perguntas).");
    return { applied: false };
  }
  const env = detectEnvironment();
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  try {
    console.log("model-router — instalação guiada\n");
    console.log(`Detectado: ${env.os}, Node ${env.node}`);
    console.log(`  claude CLI: ${env.claude.installed ? env.claude.version ?? "instalado" : "não encontrado"}`);
    console.log(`  codex CLI:  ${env.codex.installed ? env.codex.version ?? "instalado" : "não encontrado"}`);
    console.log(`  1Password CLI (op): ${env.op.installed ? "instalado" : "não encontrado"}`);

    const scope = await ASK.choice(rl, "1. Como você quer usar o roteador?", [
      { label: "Universal: comando `model-router` disponível em qualquer pasta e para agentes de IA (recomendado)", value: "universal" },
      { label: "Só neste projeto/pasta (rodar com `node src/cli.mjs`)", value: "local" }
    ], 0);

    const providers = [];
    if (await ASK.yes(rl, `2a. Usar Claude (assinatura via claude CLI)?${env.claude.installed ? "" : " (CLI não encontrado — instale e faça login depois)"}`, env.claude.installed)) providers.push("anthropic");
    if (await ASK.yes(rl, `2b. Usar OpenAI (assinatura via codex CLI)?${env.codex.installed ? "" : " (CLI não encontrado)"}`, env.codex.installed)) providers.push("openai");
    if (await ASK.yes(rl, "2c. Usar MiniMax (API paga, opcional, modo shadow)?", env.minimax_key)) providers.push("minimax");
    if (await ASK.yes(rl, "2d. Usar GLM/Z.ai (API paga por crédito, opcional, modo shadow)?", env.zai_key)) providers.push("glm");
    if (!providers.length) throw new Error("Escolha ao menos um provedor.");

    let secrets = "env";
    const refs = {};
    if (providers.includes("minimax") || providers.includes("glm")) {
      secrets = await ASK.choice(rl, "3. Onde ficam as chaves de API?", [
        { label: "Variáveis de ambiente (MINIMAX_API_KEY / ZAI_API_KEY)", value: "env" },
        { label: "1Password (referências op://)", value: "1password" }
      ], env.op.installed ? 1 : 0);
      if (secrets === "1password") {
        if (providers.includes("minimax")) refs.minimax_ref = (await rl.question("   Referência op:// da chave MiniMax: ")).trim();
        if (providers.includes("glm")) refs.glm_ref = (await rl.question("   Referência op:// da chave Z.ai: ")).trim();
      }
    }

    const update_mode = await ASK.choice(rl, "4. Verificar modelos novos automaticamente?", [
      { label: "Diariamente (recomendado)", value: "daily" },
      { label: "Semanalmente", value: "weekly" },
      { label: "Não, só quando eu rodar `update-check`", value: "off" }
    ], 0);
    const update_apply = await ASK.choice(rl, "5. Quando houver modelo novo:", [
      { label: "Aplicar sozinho sucessores diretos, após smoke real (recomendado)", value: "direct_successors" },
      { label: "Só recomendar; eu aplico rodando `update` (com o mesmo smoke)", value: "recommend_only" }
    ], 0);

    const integrations = [];
    if (scope === "universal") {
      if (await ASK.yes(rl, "6a. Instalar como skill do Claude Code (~/.claude/skills/model-router)?", env.claude.installed)) integrations.push("claude-skill");
      if (await ASK.yes(rl, "6b. Mostrar o trecho para AGENTS.md (Codex e outros agentes)?", env.codex.installed)) integrations.push("agents-snippet");
    }

    const answers = { scope, providers, secrets, update_mode, update_apply, integrations, ...refs };
    console.log(`\nResumo:\n${JSON.stringify(answers, null, 2)}`);
    if (!(await ASK.yes(rl, "Aplicar estas escolhas?", true))) {
      console.log("Nada foi alterado.");
      return { applied: false, answers };
    }

    const [catalog, policy, updatePolicy] = await Promise.all([
      readJson("config/model-catalog.json"), readJson("config/routing-policy.json"), readJson("config/update-policy.json")
    ]);
    const result = applyAnswers(catalog, policy, updatePolicy, answers);
    const coverage = routeCoverage(result.catalog, policy);
    if (coverage.broken.length || coverage.fail_closed.length) {
      console.log("\nAtenção: com esses provedores algumas rotas ficam limitadas:");
      if (coverage.broken.length) console.log(`  sem modelo disponível: ${coverage.broken.join(", ")}`);
      if (coverage.fail_closed.length) console.log(`  sem verificador independente (vão parar por segurança): ${coverage.fail_closed.join(", ")}`);
      console.log("  Ter Claude e OpenAI juntos resolve a maioria; GLM só funciona com --budget approved_api.");
      if (!(await ASK.yes(rl, "Continuar mesmo assim?", false))) {
        console.log("Nada foi alterado.");
        return { applied: false, answers, coverage };
      }
    }
    await writeJson("config/model-catalog.json", result.catalog);
    await writeJson("config/update-policy.json", result.updatePolicy);
    console.log("✔ config atualizada");

    const cliPath = path.join(ROOT, "src", "cli.mjs");
    if (scope === "universal") {
      if (await ASK.yes(rl, "Rodar `npm link` agora para criar o comando global `model-router`?", true)) {
        const link = spawnSync("npm", ["link"], { cwd: ROOT, stdio: "inherit", shell: process.platform === "win32" });
        console.log(link.status === 0 ? "✔ comando `model-router` instalado" : "✖ npm link falhou; rode manualmente na pasta do projeto");
      }
    }
    if (integrations.includes("claude-skill")) {
      const dir = path.join(os.homedir(), ".claude", "skills", "model-router");
      await mkdir(dir, { recursive: true });
      await writeFile(path.join(dir, "SKILL.md"), skillText(cliPath), "utf8");
      console.log(`✔ skill do Claude Code em ${dir}`);
    }
    if (integrations.includes("agents-snippet")) {
      console.log(`\nCole no AGENTS.md do seu projeto (ou no global do Codex):\n\n${skillText(cliPath).split("---").slice(2).join("---").trim()}\n`);
    }
    if (secrets === "env" && (providers.includes("minimax") || providers.includes("glm"))) {
      await copyFile(path.join(ROOT, ".env.example"), path.join(ROOT, ".env"), fsConstants.COPYFILE_EXCL).catch(() => {});
      console.log("→ Preencha as chaves em .env (ou exporte no shell). O arquivo é ignorado pelo Git.");
    }
    console.log("\nPróximos passos: `model-router check`, `model-router doctor` e `model-router route --category standard_coding`.");
    return { applied: true, answers };
  } finally {
    rl.close();
  }
}
