# Model Router (template)

## 🚀 Comece aqui: instalação em 1 passo

Abra seu agente de IA (Claude Code, Codex, Cursor…) na pasta onde você guarda suas ferramentas, **copie o texto abaixo e cole no chat**. O agente vai perguntar quais IAs você usa e configurar tudo para a sua máquina. Ele não altera nada sem o seu "sim".

```text
Quero instalar o model-router: https://github.com/romulohenricco/model-router

1. Clone o repositório numa pasta de ferramentas minha (pergunte onde, sugira uma) e leia AGENTS.md e INSTALL.md antes de qualquer coisa. Siga as regras desses arquivos.
2. Detecte meu ambiente sem alterar nada: sistema operacional, versão do Node (precisa ser 20.12 ou maior), se tenho os CLIs `claude`, `codex` e `op` e quais destas variáveis existem: GEMINI_API_KEY, MINIMAX_API_KEY, ZAI_API_KEY. Veja também como meus projetos estão organizados: CLAUDE.md, AGENTS.md, ~/.claude/skills, regras do Cursor etc.
3. Pergunte quais LLMs eu realmente uso hoje e quais tenho só às vezes. As que eu uso viram ATIVAS e podem ser roteadas. As outras ficam em STAND-BY: "enabled": false no config/model-catalog.json, continuam no catálogo e eu ligo depois. Se eu citar uma LLM que o roteador não suporta, diga isso com clareza e não invente adaptador.
4. Faça as demais perguntas do INSTALL.md, uma rodada por vez e com a sua recomendação: uso universal ou só no projeto, onde ficam as chaves (.env ou 1Password), frequência da atualização de modelos e integração com meus agentes.
5. Mostre um resumo e ESPERE meu "sim" antes de editar config/, rodar npm link, criar arquivos em ~/.claude/ ou mexer em .env. Nunca grave chave real em arquivo.
6. Aplique e valide com `node src/cli.mjs check`, `node --test` e `node src/cli.mjs doctor`. Mostre quais rotas ficaram limitadas ou vão parar por falta de um modelo revisor e explique em uma linha o que eu ganharia ligando outro provedor.
7. No final, me diga como tirar uma LLM do stand-by quando eu passar a usar: rodar `node src/cli.mjs init` de novo, ou pedir para você mudar "enabled" para true e rodar `node src/cli.mjs update-check`.
```

Requisito: Node.js 20.12 ou mais novo. Claude e OpenAI usam o login dos próprios CLIs, sem chave de API.

---

Roteador **determinístico e auditável** de modelos de IA. Dada uma tarefa (categoria, risco, sensibilidade, complexidade, orçamento), ele decide **provedor, modelo, conta, esforço, fallbacks e verificador independente** — sem inferência e sem rede na decisão — e, se você quiser, despacha o pedido em modo *response-only*.

Este repositório é um **template**: clique em **Use this template** no GitHub, clone e rode a instalação guiada:

```bash
node src/cli.mjs init
```

Ela pergunta como você quer usar (universal ou só no projeto), quais provedores você tem, onde ficam as chaves e como quer receber atualizações de modelos. Detalhes e as mesmas perguntas para agentes de IA em [INSTALL.md](INSTALL.md).

## Como funciona

```text
tarefa ─► routeTask (puro, sem rede) ─► decisão {primary, fallbacks, verifier, esforço}
                                         └─► dispatchTask (response-only)
                                              ├─ claude_cli          (Claude Code CLI)
                                              ├─ codex_cli           (Codex CLI)
                                              ├─ minimax_anthropic   (API, opcional/shadow)
                                              └─ glm_openai          (API, opcional/shadow + budget)
                                                   └─ verificador independente, quando a política exige
```

- `config/model-catalog.json` — provedores, adaptadores, modelos, contas e referências de credencial.
- `config/routing-policy.json` — categorias, primário/fallbacks/verificadores, esforço por complexidade e guardrails.
- `src/router.mjs` — decisão determinística. `src/dispatcher.mjs` — aprovações, execução, fallback e verificação.
- `src/budget.mjs` / `src/cost.mjs` — custo estimado e *hard stop* para provedores pagos por crédito de API.
- `src/telemetry.mjs` — logs JSONL seguros (sem prompt, resposta ou segredo).

### Catálogo incluído (21 modelos)

| Provedor | Modelos | Modo |
|---|---|---|
| Anthropic (via `claude` CLI) | Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (+ Fable 5.1, Sonnet 5, Haiku 4.5 como legado) | ativo |
| OpenAI (via `codex` CLI) | GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Astra, GPT-6 Sol, GPT-6 Luna (+ GPT-5.6 Terra legado) | ativo |
| MiniMax M2.7 | API Anthropic-compatível | opcional, *shadow* |
| GLM 5.1 | API OpenAI-compatível | opcional, *shadow* + orçamento |
| Google (API Gemini) | Gemini 4 Carbon, Gemini 4 Argon, Gemini 4 Hydrogen, Gemini 3.8 Flash (+ Gemini 2.5 Pro/Flash como legado, fora das rotas) | ativo, opcional (chave `GEMINI_API_KEY`) |

Modelos de assinatura usam o login do próprio CLI — **nenhuma chave é necessária** para Anthropic/OpenAI. O Google Gemini é opcional e usa uma chave da API Gemini (`GEMINI_API_KEY`, nível pago ou gratuito); sem ela, desative o provedor (`"enabled": false`) ou responda "não" no `init`.

### Categorias

`deep_reasoning`, `mechanical_coding`, `critical_review`, `research`, `executive_synthesis`, `documentation`, `comparative_analysis`, `operational_support`, `long_horizon_engineering`, `standard_coding`.

## Atualização automática de modelos

O roteador verifica **uma vez por dia** se os provedores lançaram modelos novos e se mantém atualizado sozinho.

- **Quando roda:** ao usar `route` ou `dispatch`, se a última checagem tiver mais de 24 h, dispara em segundo plano (nunca bloqueia nem atrasa a decisão).
- **Fontes (sem chave de API):** cache local do Codex CLI (`~/.codex/models_cache.json`) e as páginas públicas de modelos da Anthropic, da OpenAI e do Google Gemini (`ai.google.dev/gemini-api/docs/models.md`) — só hosts em allowlist.
- **O que aplica sozinho:** apenas **sucessores diretos** na mesma linha de modelo (ex.: `claude-haiku-5-5` → `claude-haiku-5-7`, `gpt-6.1-sol` → `gpt-6.2-sol`, `gemini-3.8-flash` → `gemini-3.9-flash`). No Gemini, variantes com sufixo (`-lite`, `-tts`, `-image`, `-live`, `-preview`) nunca contam como sucessor. O novo modelo assume os mesmos papéis em todas as rotas; o anterior vira o primeiro fallback.
- **Trava de segurança:** antes de trocar, faz um *smoke* real (“PONG”) no modelo novo. Se falhar, não aplica e deixa como pendente.
- **Só recomenda:** linhas novas (um modelo sem antecessor no catálogo) e modelos marcados com `"pinned": true` no catálogo.
- **Aviso:** depois de uma troca, o `route`/`dispatch` mostra uma linha no `stderr` até você confirmar com `update-status --ack`. Backups do config ficam em `logs/updates/backups/`.

```bash
node src/cli.mjs update-check          # só verifica e mostra o plano
node src/cli.mjs update --dry-run      # simula a aplicação
node src/cli.mjs update                # aplica sucessores diretos (com smoke)
node src/cli.mjs update-status [--ack] # estado da última checagem / dispensar aviso
```

Configuração em `config/update-policy.json` (`auto`, `interval_hours`, `apply: "direct_successors" | "recommend_only"`, `smoke_before_apply`, `auto_commit`, fontes e linhas). Com `recommend_only`, a checagem diária só avisa; rodar `update` à mão aplica (sempre com o smoke). Com `auto_commit: true`, cada troca automática vira um commit local só dos dois arquivos de config (nunca faz push). Para desligar numa máquina: `MODEL_ROUTER_AUTO_UPDATE=0` (em CI já vem desligado).

## Requisitos

- Node.js ≥ 20.12 (sem dependências npm).
- Opcional: [`claude`](https://docs.claude.com/en/docs/claude-code) CLI autenticado, [`codex`](https://developers.openai.com/codex) CLI ≥ 0.159 autenticado.

## Uso

```bash
# Decisão, sem executar nada
node src/cli.mjs route --category standard_coding
node src/cli.mjs route --category executive_synthesis --complexity complex

# Despacho (prompt só por stdin)
echo "Resuma este texto: ..." | node src/cli.mjs dispatch --category documentation --approve-shadow

# Ajuda
node src/cli.mjs --help

# Diagnóstico
node src/cli.mjs check
node src/cli.mjs doctor
node src/cli.mjs budget --provider glm

# Testes
npm test
```

Flags de decisão: `--risk`, `--sensitivity`, `--side-effects`, `--complexity`, `--latency`, `--budget`, `--author-provider`, `--unavailable`, `--session-account`, `--log`.
Flags de execução: `--approve-shadow`, `--approve`, `--max-output-tokens`, `--timeout-ms`, `--no-fallback`.

## Executáveis dos CLIs

Por padrão o router (adapters, `doctor --live` e `init`) chama `claude` e `codex` pelo `PATH`. Para fixar um binário específico:

| Variável | CLI | Padrão (não definida ou vazia) |
|---|---|---|
| `MODEL_ROUTER_CLAUDE_BIN` | Claude Code | `claude` |
| `MODEL_ROUTER_CODEX_BIN` | Codex | `codex` |

- O valor precisa ser um **caminho absoluto para um arquivo regular existente**; caso contrário a chamada falha antes de criar processo, com o erro estável `CLI_PATH_INVALID` (no `doctor --live`: `status: auth_probe_failed`, `error_code: CLI_PATH_INVALID`).
- No Windows, shims `.cmd`/`.bat` são recusados (o Node não os executa sem shell); aponte para o `.exe` real.
- As variáveis são configuração, não segredo: o router nunca as remove do ambiente e elas seguem para o processo filho.

## Credenciais

O catálogo guarda só **referências**, nunca valores:

- `env:NOME_DA_VARIAVEL` (padrão) — lê `process.env`. Copie `.env.example` e exporte as variáveis.
- `op://cofre/item/campo` (opcional) — lê pelo 1Password CLI (`op read`).

Chaves ficam só em memória durante a chamada.

## Segurança embutida

- Dispatch **response-only**: não edita arquivos, não executa comandos gerados pelos modelos, não faz deploy.
- Claude CLI sem tools/MCP/persistência; Codex efêmero, read-only, sem busca/plugins.
- APIs só por HTTPS e hosts em allowlist.
- Dados `confidential`/`restricted` bloqueiam provedores externos (MiniMax/GLM/Google Gemini) via `guardrails.external_sensitive_providers`. O Gemini está nessa lista porque, no nível gratuito da API Gemini, o Google pode usar prompts e respostas para melhorar seus produtos; trabalho confidencial ou restrito nunca é roteado para ele (nem como fallback ou verificador).
- A chave do Gemini vai só no header `x-goog-api-key`, nunca na URL; erros e logs não incluem a chave.
- Provedores *shadow* exigem `--approve-shadow`; alto risco/deploy/destrutivo exige `--approve`.
- Resposta rejeitada pelo verificador **não** é devolvida como final.

## Logs

JSONL em `./logs/YYYY-MM-DD.jsonl` (ou `MODEL_ROUTER_LOG_DIR`), com IDs, categoria, modelo, status, latência, tokens e erro estável. O ledger do GLM fica em `logs/budget/glm.jsonl`. Nunca grava prompt/resposta.

## Personalizando para o seu time

1. **Modelos**: edite `config/model-catalog.json` (adicione/remova modelos, ajuste `api_model`, papéis e esforço padrão).
2. **Política**: edite `config/routing-policy.json` — `primary`, `fallbacks`, `verifiers` e `effort_by_complexity` por categoria; `guardrails.safe_controller` e `critical_verifier`. A validação (`node src/cli.mjs check`) falha se uma rota citar modelo inexistente.
3. **Contas**: os aliases em `providers.*.accounts` são rótulos lógicos. O alias Claude não é verificável pelo CLI (`account_verified=false`).
4. **Provedores opcionais**: para desativar MiniMax/GLM/Google, ponha `"enabled": false`.
5. **Novos modelos**: após adicionar, faça um smoke real de dispatch antes de promover a primário — estar listado no CLI não prova equivalência de qualidade.
6. Rode `npm test` e ajuste as asserções de `tests/router.test.mjs` à sua política.

## Limitações

- Os preços/modelos do catálogo refletem o estado de 2026-11-12; o `update-check` mantém os modelos em dia, mas confira preços nos docs dos provedores.
- O Codex CLI injeta o catálogo global de skills no contexto de entrada (visível em `usage`).
- Custo do GLM é estimativa local por tokens; reconcilie no painel do provedor.

## Backlog

**Última atualização — v1.0.0 (2026-11-16): Roteamento Determinístico de LLMs** (Claude, ChatGPT, Gemini, MiniMax e GLM).

- Claude, ChatGPT e Gemini na última versão: `claude-fable-5-2`, `claude-opus-5-5`, `claude-sonnet-5-5`, `claude-haiku-5-5` · `gpt-6.1-sol`, `gpt-6.1-terra`, `gpt-6-astra`, `gpt-6-luna` · `gemini-4-carbon`, `gemini-4-argon`, `gemini-4-hydrogen`, `gemini-3.8-flash`.
- ⚠️ MiniMax (`MiniMax-M2.7`) e GLM (`glm-5.1`) estão uma geração atrás; a troca para `MiniMax-M3` e `glm-5.3` está prevista na v1.1.0.
- Pendentes: Grok, DeepSeek, Muse, Kimi, Qwen, Mistral, modelos locais (Ollama/LM Studio), Cohere, OpenRouter, Perplexity e Amazon Nova. [Contribua](CONTRIBUTING.md).

📋 Lista completa de versões, modelos e pendentes: **[BACKLOG.md](BACKLOG.md)**

## Licença

[MIT](LICENSE). Use, adapte e redistribua à vontade. Contribuições: [CONTRIBUTING.md](CONTRIBUTING.md) · Segurança: [SECURITY.md](SECURITY.md) · Quem ajudou: [CONTRIBUTORS.md](CONTRIBUTORS.md).
