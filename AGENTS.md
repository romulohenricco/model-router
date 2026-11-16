# Instruções para agentes de IA (Codex, Claude Code, etc.)

Este repositório é o **model-router**, um roteador determinístico de modelos de IA.

## Primeira instalação

Se o usuário pedir para instalar/configurar, **não instale direto**. Siga `INSTALL.md`:

1. Rode `node src/cli.mjs --help` e detecte o ambiente (SO, Node, se `claude`, `codex` e `op` existem) sem alterar nada.
2. Faça ao usuário as perguntas da seção "As perguntas" do `INSTALL.md`, **uma rodada por vez**, explicando a recomendação. Pergunte explicitamente se ele quer uso **universal** (o mais comum) ou só no projeto.
   Na rodada de provedores, pergunte também: "Usar Google Gemini (API paga/gratuita, chave GEMINI_API_KEY)?" (padrão "sim" só se `GEMINI_API_KEY` estiver definida) e, se as chaves ficarem no 1Password, peça a referência `op://` da chave Gemini.
3. Mostre um resumo das escolhas e peça confirmação antes de: editar `config/`, rodar `npm link`, criar arquivos em `~/.claude/` ou mexer em `.env`.
4. Aplique e valide com `node src/cli.mjs check`, `node --test` e `node src/cli.mjs doctor`.

## Regras

- Nunca escreva chaves reais em arquivos versionados; o catálogo guarda só `env:VAR` ou `op://...`.
- Trabalho `confidential`/`restricted` nunca vai para provedores externos (MiniMax, GLM, Google Gemini); não contorne esse bloqueio.
- Não coloque o prompt do usuário na linha de comando: `dispatch` lê só de stdin.
- Respeite as decisões do roteador: `fail_closed` → parar; `shadow` → pedir aprovação; risco alto/deploy/destrutivo → pedir aprovação.
- Se o `route`/`dispatch` mostrar no stderr um aviso `model-router: updated ...`, conte ao usuário quais modelos mudaram.
- Toda mudança no `README.md` atualiza o `BACKLOG.md` (lista completa) e a seção **Backlog** do README (só a última atualização + link); `tests/readme-backlog.test.mjs` confere. Contribuições seguem `CONTRIBUTING.md`: PR para `stage`, nunca direto em `main`.
