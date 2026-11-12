# Instalação guiada

> **Regra para quem instala (pessoa ou agente de IA):** não instale direto. Primeiro **pergunte e confirme** cada ponto abaixo — a maioria das pessoas quer o roteador **universal** (disponível em qualquer pasta e para os agentes de IA), mas isso muda o que é instalado na máquina.

## Jeito mais fácil

```bash
git clone <seu-repo-criado-a-partir-do-template> model-router
cd model-router
node src/cli.mjs init      # pergunta tudo e só aplica depois do seu "sim"
```

Requisito: Node.js 20.12+ (sem dependências npm).

## As perguntas (o `init` faz; um agente de IA deve fazer as mesmas)

1. **Escopo de uso**
   - *Universal (recomendado):* comando `model-router` em qualquer pasta (`npm link`) + integração com seus agentes de IA.
   - *Só neste projeto:* roda com `node src/cli.mjs` dentro da pasta.
2. **Provedores que você tem** — o roteador desliga os que você não tiver:
   - Claude via `claude` CLI logado (assinatura) · OpenAI via `codex` CLI logado (assinatura, ≥ 0.159)
   - Opcionais pagos por API, em modo *shadow*: MiniMax (`MINIMAX_API_KEY`) e GLM/Z.ai (`ZAI_API_KEY`).
3. **Onde ficam as chaves** (só se usar MiniMax/GLM): variáveis de ambiente / arquivo `.env` (ignorado pelo Git) ou 1Password (`op://...`). O roteador guarda só a referência.
4. **Atualização de modelos:** checar diariamente (recomendado), semanalmente ou só manual.
5. **Ao achar modelo novo:** aplicar sozinho sucessores diretos depois de um smoke real (recomendado) ou só recomendar.
6. **Integrações (se universal):** skill do Claude Code em `~/.claude/skills/model-router/` e/ou trecho para o `AGENTS.md` (Codex e outros agentes).

## Depois de instalar

```bash
model-router check                       # ou: node src/cli.mjs check
model-router doctor                      # quais provedores estão prontos
model-router route --category standard_coding
model-router update-check                # tem modelo novo?
```

## Desinstalar

- `npm unlink -g model-router` (se usou `npm link`)
- apagar `~/.claude/skills/model-router/` (se instalou a skill)
- apagar a pasta do repositório
