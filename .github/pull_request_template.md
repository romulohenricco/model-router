## O que muda

<!-- Uma frase. Se for provedor novo, qual e por quê. -->

## Checklist (obrigatório)

- [ ] O PR aponta para a branch **`next`**, não para `main`.
- [ ] `node --test` e `node src/cli.mjs check` passam localmente.
- [ ] Nenhuma chave, token, `.env`, prompt privado ou dado pessoal no diff.
- [ ] Credenciais só como referência (`env:VAR` ou `op://...`) no catálogo.
- [ ] Provedor novo entra com `"enabled": false` (stand-by) e, se for externo, na lista `guardrails.external_sensitive_providers`.
- [ ] Hosts novos estão na allowlist do provedor; nada de HTTP sem TLS.
- [ ] O dispatch continua *response-only* (sem tools, sem execução de comandos, sem escrita em disco).
- [ ] Atualizei o `BACKLOG.md` (e a última atualização no README, se mudou versão).
- [ ] Incluí meu nome em `CONTRIBUTORS.md`.

## Como testei

<!-- Comandos e saída (sem segredos). Smoke real só se você tiver a chave; diga se não teve. -->
