# Gestão de ausências

Aplicação para controle e projeção de férias e demais ausências, com autenticação, equipes, feriados e perfis de acesso.

## Funcionalidades

- Autenticação com PBKDF2 e sessão em cookie `HttpOnly`.
- Perfis Administrador, Supervisor e Colaborador.
- Fluxo de ausências com solicitação, aprovação interna, registro no Quantum e aprovação no Quantum.
- Toda solicitação nasce pendente; somente supervisores aprovam e o solicitante pode cancelar até a aprovação final no Quantum.
- Inclusão de solicitação pelo supervisor para integrantes da equipe.
- Edição e inativação de colaboradores por administradores e supervisores.
- Regras individuais de acréscimo mensal e fator de desconto de férias.
- Projeção mensal do saldo, incluindo férias solicitadas e confirmadas.
- Feriados globais ou por equipe, integrais ou de meio período, no cálculo de dias úteis.
- Importação de feriados por CSV (`data;nome;equipe;duracao;saldo_administrativo`), além de edição e exclusão.
- Saldo administrativo separado, com créditos automáticos por ausência e créditos eventuais por trabalho em feriado.
- Comunicado semanal editável, preservado após a publicação e pronto para copiar no Teams.
- Notificações por e-mail ao solicitante e envio do comunicado aos supervisores.
- Calendário anual em matriz com os saldos e ausências de todos os integrantes da equipe, de janeiro a dezembro.
- Limites anuais de 4 dias não justificados e 15 dias justificados.
- Licenças paternidade (30 dias corridos) e maternidade (150 dias corridos).
- Registro de auditoria das principais operações.

## Regras de cálculo adotadas

1. O saldo inicial é informado com uma data-base.
2. O crédito mensal ocorre a cada mudança de mês após a data-base.
3. O crédito continua sendo acumulado durante qualquer ausência.
4. Férias descontam `dias úteis × fator de desconto` do colaborador.
5. O saldo oficial considera férias aprovadas no Quantum já concluídas; a projeção também considera os status anteriores.
6. Fins de semana e feriados cadastrados são excluídos total ou parcialmente dos dias úteis.
7. Limites anuais são reiniciados em 1º de janeiro.

## Desenvolvimento local

```bash
npm install
npx wrangler d1 create gestao-ausencia
```

Substitua o `database_id` zerado de `wrangler.jsonc` pelo ID retornado. Depois:

```bash
npm run db:migrate:local
npm run dev
```

Em outro terminal, execute o backend:

```bash
npx wrangler dev
```

O Vite abre em `http://localhost:5173` e encaminha `/api` ao Worker em `http://localhost:8787`.

## Publicação no Cloudflare

1. Crie o banco D1: `npx wrangler d1 create gestao-ausencia`.
2. Informe o ID criado em `wrangler.jsonc`.
3. Aplique a estrutura: `npm run db:migrate:remote`.
4. Publique: `npm run cf:deploy`.
5. No primeiro acesso, a aplicação abrirá a criação do administrador inicial.

O Worker serve a aplicação React e a API no mesmo domínio.

Após atualizar uma instalação existente, aplique obrigatoriamente a migração `0002_workflow_communications.sql` antes de usar o novo Worker:

```bash
npm run db:migrate:remote
```

## Envio de e-mail

O Worker usa a API do Resend. Configure os segredos no Cloudflare Worker:

```bash
npx wrangler secret put RESEND_API_KEY
npx wrangler secret put EMAIL_FROM
```

`EMAIL_FROM` deve ser um remetente autorizado no Resend, por exemplo `Gestão de ausências <ausencias@seudominio.br>`. Sem essas configurações, a operação continua funcionando e a tentativa fica registrada como `SKIPPED` no banco para auditoria.

## Segurança

- Não existem senhas padrão no repositório.
- Senhas são derivadas com PBKDF2-SHA-256 e salt individual (100 mil iterações).
- Sessões usam tokens aleatórios, armazenados no banco apenas como SHA-256.
- Cookies são `HttpOnly`, `Secure` e `SameSite=Lax`.
- Operações administrativas são validadas novamente no backend.
