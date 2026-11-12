# Model Router (template)

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

### Catálogo incluído (15 modelos)

| Provedor | Modelos | Modo |
|---|---|---|
| Anthropic (via `claude` CLI) | Fable 5.2, Opus 5.5, Sonnet 5.5, Haiku 5.5 (+ Fable 5.1, Sonnet 5, Haiku 4.5 como legado) | ativo |
| OpenAI (via `codex` CLI) | GPT-6.1 Sol, GPT-6.1 Terra, GPT-6 Astra, GPT-6 Sol, GPT-6 Luna (+ GPT-5.6 Terra legado) | ativo |
| MiniMax M2.7 | API Anthropic-compatível | opcional, *shadow* |
| GLM 5.1 | API OpenAI-compatível | opcional, *shadow* + orçamento |

Modelos de assinatura usam o login do próprio CLI — **nenhuma chave é necessária** para Anthropic/OpenAI.

### Categorias

`deep_reasoning`, `mechanical_coding`, `critical_review`, `research`, `executive_synthesis`, `documentation`, `comparative_analysis`, `operational_support`, `long_horizon_engineering`, `standard_coding`.

## Atualização automática de modelos

O roteador verifica **uma vez por dia** se os provedores lançaram modelos novos e se mantém atualizado sozinho.

- **Quando roda:** ao usar `route` ou `dispatch`, se a última checagem tiver mais de 24 h, dispara em segundo plano (nunca bloqueia nem atrasa a decisão).
- **Fontes (sem chave de API):** cache local do Codex CLI (`~/.codex/models_cache.json`) e as páginas públicas de modelos da Anthropic e da OpenAI (só hosts em allowlist).
- **O que aplica sozinho:** apenas **sucessores diretos** na mesma linha de modelo (ex.: `claude-haiku-5-5` → `claude-haiku-5-7`, `gpt-6.1-sol` → `gpt-6.2-sol`). O novo modelo assume os mesmos papéis em todas as rotas; o anterior vira o primeiro fallback.
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

## Credenciais

O catálogo guarda só **referências**, nunca valores:

- `env:NOME_DA_VARIAVEL` (padrão) — lê `process.env`. Copie `.env.example` e exporte as variáveis.
- `op://cofre/item/campo` (opcional) — lê pelo 1Password CLI (`op read`).

Chaves ficam só em memória durante a chamada.

## Segurança embutida

- Dispatch **response-only**: não edita arquivos, não executa comandos gerados pelos modelos, não faz deploy.
- Claude CLI sem tools/MCP/persistência; Codex efêmero, read-only, sem busca/plugins.
- APIs só por HTTPS e hosts em allowlist.
- Dados `confidential`/`restricted` bloqueiam provedores externos (MiniMax/GLM).
- Provedores *shadow* exigem `--approve-shadow`; alto risco/deploy/destrutivo exige `--approve`.
- Resposta rejeitada pelo verificador **não** é devolvida como final.

## Logs

JSONL em `./logs/YYYY-MM-DD.jsonl` (ou `MODEL_ROUTER_LOG_DIR`), com IDs, categoria, modelo, status, latência, tokens e erro estável. O ledger do GLM fica em `logs/budget/glm.jsonl`. Nunca grava prompt/resposta.

## Personalizando para o seu time

1. **Modelos**: edite `config/model-catalog.json` (adicione/remova modelos, ajuste `api_model`, papéis e esforço padrão).
2. **Política**: edite `config/routing-policy.json` — `primary`, `fallbacks`, `verifiers` e `effort_by_complexity` por categoria; `guardrails.safe_controller` e `critical_verifier`. A validação (`node src/cli.mjs check`) falha se uma rota citar modelo inexistente.
3. **Contas**: os aliases em `providers.*.accounts` são rótulos lógicos. O alias Claude não é verificável pelo CLI (`account_verified=false`).
4. **Provedores opcionais**: para desativar MiniMax/GLM, ponha `"enabled": false`.
5. **Novos modelos**: após adicionar, faça um smoke real de dispatch antes de promover a primário — estar listado no CLI não prova equivalência de qualidade.
6. Rode `npm test` e ajuste as asserções de `tests/router.test.mjs` à sua política.

## Limitações

- Os preços/modelos do catálogo refletem o estado de 2026-11-12; o `update-check` mantém os modelos em dia, mas confira preços nos docs dos provedores.
- O Codex CLI injeta o catálogo global de skills no contexto de entrada (visível em `usage`).
- Custo do GLM é estimativa local por tokens; reconcilie no painel do provedor.

## Licença

[MIT](LICENSE). Use, adapte e redistribua à vontade.
