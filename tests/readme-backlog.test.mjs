import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadConfig } from "../src/config.mjs";

const root = new URL("../", import.meta.url);
const readme = await readFile(new URL("README.md", root), "utf8");
const backlogMd = await readFile(new URL("BACKLOG.md", root), "utf8");
const pkg = JSON.parse(await readFile(new URL("package.json", root), "utf8"));
const { catalog } = await loadConfig();
const version = new RegExp(String.raw`v${pkg.version.replaceAll(".", String.raw`\.`)}(?![\d.])`);
const start = readme.indexOf("## Backlog");
const readmeSection = start === -1 ? "" : readme.slice(start, readme.indexOf("\n## ", start + 1));

test("README tem a seção Backlog (última atualização) antes de Licença e aponta para BACKLOG.md", () => {
  assert.notEqual(start, -1, "falta '## Backlog' no README");
  assert.equal(readme.indexOf("\n## ", start + 1), readme.indexOf("\n## Licença", start), "Backlog deve vir logo antes de Licença");
  assert.match(readmeSection, /\]\(BACKLOG\.md\)/, "a seção precisa linkar BACKLOG.md");
});

test("README e BACKLOG.md citam a versão atual do package.json", () => {
  assert.match(readmeSection, version, `atualize a última atualização do README para v${pkg.version}`);
  assert.match(backlogMd, version, `registre v${pkg.version} no BACKLOG.md`);
});

test("todo modelo do catálogo aparece no BACKLOG.md", () => {
  const missing = Object.entries(catalog.models)
    .filter(([id, m]) => !backlogMd.includes(`\`${id}\``) && !backlogMd.includes(`\`${m.api_model}\``))
    .map(([id]) => id);
  assert.deepEqual(missing, [], `modelos fora do BACKLOG.md: ${missing.join(", ")}`);
});
