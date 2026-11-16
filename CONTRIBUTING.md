# Como contribuir

Obrigado por ajudar! Este é um repositório público e open-source (MIT). Qualquer pessoa pode abrir issue e pull request, e todo PR passa por uma revisão antes de entrar.

## Quem manda em quê

| Papel | Quem | O que pode |
|---|---|---|
| Dono do código (CODEOWNER) | [@romulohenricco](https://github.com/romulohenricco) | Aprovar, fazer merge, publicar versão, mexer em `main` |
| Contribuidor | Qualquer pessoa com PR aceito | Entra em [CONTRIBUTORS.md](CONTRIBUTORS.md). **Não** recebe acesso de escrita, push em `main`/`stage`, nem permissão de admin |

Ser listado como contribuidor é reconhecimento, não permissão. O acesso de escrita continua só com o dono.

## Branches

| Branch | Para quê | Quem faz merge |
|---|---|---|
| `main` | Produção: o que quem instala recebe | Só o dono, a partir de `stage` |
| `stage` | Integração das contribuições da comunidade (ex.: provedores do Backlog) | Só o dono, depois de revisar o PR |
| `seu-fork/...` | Seu trabalho | Você |

Fluxo:

1. Abra (ou escolha) uma issue, por exemplo **"Novo provedor / LLM"**.
2. Faça um **fork** e crie uma branch: `feat/provider-grok`, `fix/descricao-curta` ou `docs/descricao-curta` (padrão `tipo/descricao` em kebab-case; tipos: feat, fix, chore, docs, refactor, test, perf, ci).
3. Abra o PR **para `stage`**. PR para `main` é fechado e redirecionado.
4. O CI precisa passar e o dono precisa aprovar (CODEOWNERS). Ninguém faz merge sem essa aprovação.
5. Quando `stage` estiver estável, o dono promove para `main`, sobe a versão e atualiza o **Backlog** do README.

## Regras de segurança (inegociáveis)

- **Nunca** commite chave, token, `.env`, prompt privado ou dado pessoal. O catálogo só aceita referência: `env:NOME_DA_VARIAVEL` ou `op://cofre/item/campo`.
- Provedor novo entra **desligado** (`"enabled": false`, stand-by) e, se for API externa, na lista `guardrails.external_sensitive_providers`, para nunca receber trabalho `confidential`/`restricted`.
- Só HTTPS e só hosts na allowlist do provedor (`allowed_hosts`).
- O dispatch é **response-only**: o adaptador não pode dar ao modelo tools, execução de comando, navegação ou escrita em disco.
- Não enfraqueça guardrails, aprovações (`--approve`, `--approve-shadow`), *fail closed* ou o verificador independente. PR que faz isso é recusado.
- Nada de dependência npm nova sem discussão na issue: hoje o projeto tem **zero** dependências.
- Falha de segurança: relate em privado (veja [SECURITY.md](SECURITY.md)), nunca em issue pública.

## Como adicionar um provedor do Backlog

1. Em `config/model-catalog.json`: o provedor (`adapter`, `base_url`, `allowed_hosts`, `secret_ref: "env:SUA_VAR"`, `"enabled": false`) e os modelos com `api_model` **exato** da documentação oficial.
2. Se a API for OpenAI- ou Anthropic-compatível, reaproveite `glm_openai`/`minimax_anthropic` em `src/adapters/` antes de criar adaptador novo.
3. Em `config/routing-policy.json`: só como fallback ou verificador. Promover a primário é decisão do dono, depois de um smoke real.
4. A variável em `.env.example`, sem valor.
5. Testes em `tests/` (sem rede: use *fakes*, como em `tests/gemini.test.mjs`).
6. A linha do provedor em **Pendentes** do [BACKLOG.md](BACKLOG.md) muda para "em revisão (PR #n)".

## Antes de abrir o PR

```bash
node --test
node src/cli.mjs check
```

## Regra do README

Toda mudança no README atualiza o [BACKLOG.md](BACKLOG.md) (lista completa: versões, modelos, pendentes) e a seção **Backlog** do README (só a última atualização, com link para o BACKLOG.md). O teste `tests/readme-backlog.test.mjs` confere se a versão bate com o `package.json` e se todo modelo do catálogo aparece no BACKLOG.md.
