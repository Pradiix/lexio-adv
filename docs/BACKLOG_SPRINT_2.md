# Backlog Sprint 2 - Lexio

## Meta do sprint
Concluir o modulo inicial de CRM juridico com `contacts` e `cases`, mantendo isolamento por tenant e trilha de auditoria.

## Historias (prioridade)

1. Como agente, quero cadastrar e editar contatos para organizar atendimento.
   - Aceite: criar, listar, buscar por termo, detalhar, atualizar e excluir contato por tenant.

2. Como agente, quero cadastrar e editar casos vinculados a um contato.
   - Aceite: criar, listar, buscar por termo, detalhar, atualizar e excluir caso por tenant.

3. Como sistema, quero validar vinculo de caso com contato do mesmo tenant.
   - Aceite: `contactId` invalido para tenant retorna `400`.

4. Como sistema, quero restringir exclusoes de contato/caso por RBAC.
   - Aceite: apenas `owner` e `manager` podem excluir.

5. Como sistema, quero registrar auditoria das operacoes criticas.
   - Aceite: `contact.create/update/delete` e `case.create/update/delete` gravados em `audit_events`.

## Tarefas tecnicas
- Criar migracao SQL `003_contacts_cases.sql`.
- Adicionar schemas de validacao com Zod para payloads de contato/caso.
- Implementar endpoints REST de CRUD com filtros (`limit`, `offset`, `search`).
- Aplicar guardas de autenticacao, tenant scope e RBAC.
- Registrar eventos de auditoria nos pontos de mutacao.
- Executar teste E2E local e documentar evidencias.

## Definition of Done
1. Migracao aplicada no Postgres local.
2. Build da API sem erros.
3. Fluxo E2E com cenarios positivos e de seguranca validado.
4. README e documentacao de teste atualizados.
