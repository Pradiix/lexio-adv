# Teste Local Sprint 3

Data: 2026-04-10

## Ambiente
- Docker compose local ativo (`postgres`, `redis`, `n8n`).
- Migracao `infra/sql/004_inbox_conversations_messages.sql` aplicada no Postgres.
- Migracao `infra/sql/005_scheduling_operations.sql` aplicada no Postgres.
- API buildada com `npm run build:api`.

## Fluxo validado
1. `POST /v1/inbox/ingest` com `external_message_id` novo:
   - retorno `201`.
   - `deduplicated=false`.
2. `POST /v1/inbox/ingest` repetindo mesmo `external_message_id`:
   - retorno `200`.
   - `deduplicated=true`.
3. `GET /v1/inbox/conversations?search=...`:
   - retorno `200` com conversa criada.
4. `GET /v1/inbox/conversations/:conversationId`:
   - retorno `200` com status da conversa.
5. `GET /v1/inbox/conversations/:conversationId/messages`:
   - retorno `200` com timeline.
6. `POST /v1/inbox/conversations/:conversationId/messages`:
   - retorno `201`.
   - mensagem outbound adicionada.
7. `PATCH /v1/inbox/conversations/:conversationId`:
   - retorno `200` alterando status para `closed`.
8. `GET /v1/audit-events`:
   - eventos de inbox presentes com total retornado.

## Fluxo validado - Agenda deterministica
1. `POST /v1/scheduling/requests`:
   - retorno `201`.
   - status inicial `pending_confirmation`.
   - resposta inclui `confirmation_phrase` no formato `CONFIRMAR CODIGO`.
2. `POST /v1/scheduling/requests/:operationId/confirm` com texto incorreto:
   - retorno `400`.
3. `POST /v1/scheduling/requests/:operationId/confirm` com frase correta:
   - retorno `200`.
   - status final `executed`.
4. `POST /v1/scheduling/requests/:operationId/reject`:
   - retorno `200`.
   - status final `rejected`.
5. `GET /v1/scheduling/requests` e `GET /v1/scheduling/requests/:operationId`:
   - retorno `200` com listagem e detalhe consistentes.
6. `GET /v1/audit-events`:
   - eventos `scheduling.request.create`, `scheduling.request.confirm_execute` e `scheduling.request.reject` presentes.

## Regras de seguranca validadas
- Todas as rotas de inbox usam autenticacao + tenant scope + RBAC (`owner`, `manager`, `agent`).
- Integridade no banco:
  - `conversation_messages(tenant_id, conversation_id)` referencia `conversations(tenant_id, id)`.
  - `conversations(tenant_id, contact_id)` referencia `contacts(tenant_id, id)`.
  - deduplicacao por `UNIQUE (tenant_id, external_message_id)`.
  - `scheduling_operations(tenant_id, case_id)` referencia `cases(tenant_id, id)`.
  - `scheduling_operations(tenant_id, contact_id)` referencia `contacts(tenant_id, id)`.

## Observacoes
- A ingestao tenta resolver contato por `contactId` ou por `email/phone`; se nao encontrar, cria lead automaticamente quando houver dados minimos.
- A listagem de conversas traz preview da ultima mensagem para acelerar renderizacao de inbox.
