# Backlog do model-router

Registro completo das versões: o que cada versão entrega, quais modelos exatos ela roteia e o que está pendente. A seção **Backlog** do [README](README.md) mostra só a última atualização e aponta para este arquivo.

> **Regra:** toda mudança no README ou no catálogo atualiza este arquivo. O teste `tests/readme-backlog.test.mjs` falha se a versão não bater com o `package.json` ou se algum modelo do catálogo faltar aqui.

---

## v1.0.0 — Roteamento Determinístico de LLMs (2026-11-16)

Primeira versão pública. O roteador decide provedor, modelo, esforço, fallbacks e verificador independente sem inferência e sem rede. O despacho é *response-only*, há atualização diária de modelos com smoke antes de aplicar, e a instalação é guiada pelo seu agente de IA (provedores que você não usa ficam em stand-by).

Catálogo conferido em `config/model-catalog.json` (`updated_at: 2026-11-14`). A coluna **Situação** compara com a documentação oficial de cada provedor em 2026-11-16.

### Claude (Anthropic) — via `claude` CLI, assinatura

| Modelo | ID | Papel | Situação |
|---|---|---|---|
| Fable 5.2 | `claude-fable-5-2` | topo de raciocínio; primário em `executive_synthesis` | ✅ última versão |
| Opus 5.5 | `claude-opus-5-5` | controlador / worker / verificador | ✅ última versão |
| Sonnet 5.5 | `claude-sonnet-5-5` | controlador e worker padrão | ✅ última versão |
| Haiku 5.5 | `claude-haiku-5-5` | worker de baixo custo | ✅ última versão |
| Fable 5.1 | `claude-fable-5-1` | fallback | legado |
| Sonnet 5 | `claude-sonnet-5` | fallback | legado |
| Haiku 4.5 | `claude-haiku-4-5-20251001` | fora das rotas | legado |

### ChatGPT (OpenAI) — via `codex` CLI ≥ 0.159, assinatura

| Modelo | ID | Papel | Situação |
|---|---|---|---|
| GPT-6.1 Sol | `gpt-6.1-sol` | primário/verificador em revisão crítica e análise comparativa | ✅ última versão |
| GPT-6.1 Terra | `gpt-6.1-terra` | worker padrão de código | ✅ última versão |
| GPT-6 Astra | `gpt-6-astra` | fronteira, raciocínio mais difícil | ✅ última versão |
| GPT-6 Luna | `gpt-6-luna` | rápido e barato, tarefas mecânicas | ✅ última versão |
| GPT-6 Sol | `gpt-6-sol` | geração anterior, fallback | legado |
| GPT-5.6 Terra | `gpt-5.6-terra` | fallback | legado |

### Gemini (Google) — API, chave `GEMINI_API_KEY`

| Modelo | ID | Papel | Situação |
|---|---|---|---|
| Gemini 4 Carbon | `gemini-4-carbon` | raciocínio mais forte do Google | ✅ última versão |
| Gemini 4 Argon | `gemini-4-argon` | fronteira, arquitetura e bugs sutis | ✅ última versão |
| Gemini 4 Hydrogen | `gemini-4-hydrogen` | execução agêntica rápida | ✅ última versão |
| Gemini 3.8 Flash | `gemini-3.8-flash` | rápido e barato | ✅ última versão |
| Gemini 2.5 Pro | `gemini-2.5-pro` | obsoleto, fora das rotas | legado |
| Gemini 2.5 Flash | `gemini-2.5-flash` | obsoleto, fora das rotas | legado |

### MiniMax — API Anthropic-compatível, chave `MINIMAX_API_KEY`, modo *shadow*

| Modelo | ID | Papel | Situação |
|---|---|---|---|
| MiniMax M2.7 | `MiniMax-M2.7` (catálogo: `minimax-m2.7`) | fallback opcional | ⚠️ **desatualizado** — já existem `MiniMax-M3` (2026-06-01) e `MiniMax-M3.1-Flash` (2026-10-19), e a documentação do endpoint Anthropic não lista mais o M2.7 |

### GLM (Z.ai) — API OpenAI-compatível, chave `ZAI_API_KEY`, modo *shadow* + orçamento

| Modelo | ID | Papel | Situação |
|---|---|---|---|
| GLM 5.1 | `glm-5.1` | fallback opcional com *hard stop* de custo | ⚠️ **desatualizado** — já existem `glm-5.2` (2026-06-16), `glm-5.3` (2026-08-18) e `glm-5.3-flash` (2026-08-26) |

Fontes: [MiniMax release notes](https://platform.minimax.io/docs/release-notes/models.md), [MiniMax Anthropic API](https://platform.minimax.io/docs/api-reference/text-anthropic-api), [Z.ai release notes](https://docs.z.ai/release-notes/new-released), [GLM-5.3](https://docs.z.ai/guides/llm/glm-5.3).

---

## Próxima versão (v1.1.0) — em preparação

- [ ] MiniMax: trocar `MiniMax-M2.7` por `MiniMax-M3` (principal) e `MiniMax-M3.1-Flash` (barato), depois de smoke real.
- [ ] GLM: trocar `glm-5.1` por `glm-5.3` (principal) e `glm-5.3-flash` (barato), depois de smoke real.
- [ ] Ensinar o `update-check` a reconhecer troca de geração (M2 → M3), não só sucessor direto.

---

## Pendentes — LLMs ainda não suportadas

Quer ajudar? Abra uma issue **"Novo provedor / LLM"** e um PR para a branch `stage` (veja [CONTRIBUTING.md](CONTRIBUTING.md)). Todo provedor novo entra **desligado** (stand-by) e na lista de provedores externos, para nunca receber dado confidencial.

| Prioridade | Provedor | Modelo mais recente (ID da API) | API | Base URL | Chave sugerida | Esforço | Status |
|---|---|---|---|---|---|---|---|
| 1 | **Grok** (xAI) | `grok-4.7` | OpenAI-compatível | `https://api.x.ai/v1` | `XAI_API_KEY` | baixo | aberto |
| 1 | **DeepSeek** | `deepseek-v4-pro`, `deepseek-flash` (V4.1 Flash) | OpenAI- e Anthropic-compatível | `https://api.deepseek.com` | `DEEPSEEK_API_KEY` | baixo | aberto |
| 1 | **Muse** (Meta) | `muse-wonder-1.0` (preview), `muse-spark-1.3`, `muse-ember-1.0` | OpenAI- e Anthropic-compatível | `https://api.meta.ai/v1` | `META_MODEL_API_KEY` | baixo | aberto |
| 2 | **Kimi** (Moonshot) | `kimi-k3.1-pro`, `kimi-k3.1-pro-highspeed` | OpenAI- e Anthropic-compatível | `https://api.moonshot.ai/v1` | `MOONSHOT_API_KEY` | baixo | aberto |
| 2 | **Qwen** (Alibaba) | `qwen4-max`, `qwen3.8-flash` | OpenAI- e Anthropic-compatível | DashScope / Model Studio (varia por região) | `DASHSCOPE_API_KEY` | médio | aberto |
| 2 | **Mistral** | `mistral-large-4` (preview), `mistral-small-latest` | própria (parecida com OpenAI) | `https://api.mistral.ai/v1` | `MISTRAL_API_KEY` | médio | aberto |
| 2 | **Modelos locais** (Ollama / LM Studio) | o que você tiver baixado | OpenAI-compatível (Ollama também Anthropic) | `http://localhost:11434/v1` · `http://localhost:1234/v1` | — | médio (exige liberar `localhost` na allowlist) | aberto |
| 3 | **Cohere** | `command-a-plus-05-2026` | OpenAI-compatível (Compatibility API) | `https://api.cohere.ai/compatibility/v1` | `COHERE_API_KEY` | baixo | aberto |
| 3 | **OpenRouter** (agregador) | slugs `fornecedor/modelo` | OpenAI-compatível | `https://openrouter.ai/api/v1` | `OPENROUTER_API_KEY` | médio (vários modelos sob uma chave) | aberto |
| 3 | **Perplexity** | Agent API (busca na web) | OpenAI-compatível | `https://api.perplexity.ai` | `PERPLEXITY_API_KEY` | médio (encaixa em `research`) | aberto |
| 3 | **Amazon Nova** (Bedrock) | `amazon.nova-2-lite-v1:0` | proprietária (Bedrock Converse) | por região AWS | credenciais AWS | alto (adaptador próprio) | aberto |

Notas:
- "Esforço baixo" = a API já é OpenAI- ou Anthropic-compatível; dá para reaproveitar os adaptadores `glm_openai` / `minimax_anthropic`.
- IDs e URLs vêm das documentações oficiais consultadas em 2026-11-16; confira de novo no PR, porque provedores renomeiam modelos com frequência.
- Fontes: [xAI](https://docs.x.ai/docs/release-notes), [DeepSeek](https://api-docs.deepseek.com/updates), [Meta Muse](https://dev.meta.ai/docs/models.md), [Kimi](https://platform.kimi.ai/docs/guide/start-using-kimi-api), [Qwen](https://www.alibabacloud.com/help/en/model-studio/text-generation), [Mistral](https://docs.mistral.ai/resources/changelogs), [Ollama](https://docs.ollama.com/api/openai-compatibility), [LM Studio](https://lmstudio.ai/docs/developer/openai-compat), [Cohere](https://docs.cohere.com/docs/compatibility-api), [OpenRouter](https://openrouter.ai/docs/quickstart), [Perplexity](https://docs.perplexity.ai/changelog/changelog), [Amazon Bedrock](https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards-amazon.md).
