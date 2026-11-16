# Política de segurança

## Como relatar uma vulnerabilidade

**Não abra issue pública.** Use o relato privado do GitHub:
<https://github.com/romulohenricco/model-router/security/advisories/new>

Inclua o comando ou passo para reproduzir, o impacto e a versão (veja [BACKLOG.md](BACKLOG.md)). Nunca envie chaves reais: se uma chave sua vazou, **revogue-a primeiro** no painel do provedor.

Resposta inicial em até 7 dias. A correção sai primeiro em `main`, com crédito para quem relatou, se a pessoa quiser.

## Versões com suporte

Só a versão mais recente indicada no [BACKLOG.md](BACKLOG.md).

## O que conta como vulnerabilidade

- Vazamento de chave, prompt ou resposta em log, erro, URL ou argumento de linha de comando.
- Trabalho `confidential`/`restricted` chegando a um provedor externo.
- Contornar `--approve`, `--approve-shadow`, *fail closed*, verificador independente ou orçamento.
- Adaptador que dá ao modelo tools, execução de comando, escrita em disco ou rede fora da allowlist.
- Atualização automática que aplica modelo sem o smoke ou altera arquivos além do config.

## Garantias do projeto

- Zero dependências npm.
- Catálogo guarda só referências (`env:`/`op://`), nunca valores.
- `main` e `next` protegidas: merge só com aprovação do CODEOWNER e CI verde; sem force-push.
