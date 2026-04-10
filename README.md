# Lexio

SaaS juridico para operacao de escritorios de advocacia, com IA confiavel, automacao e governanca.

## Documentacao inicial

- `docs/ESTRUTURA_SAAS_COMPETITIVO.md`
- `docs/ARQUITETURA_SAAS_JURIDICO.md`
- `docs/PLANO_EXECUCAO_MVP.md`
- `docs/PRD_MVP_V1.md`
- `docs/ARQUITETURA_TECNICA_V1.md`
- `docs/BACKLOG_SPRINT_1.md`
- `docs/BACKLOG_SPRINT_2.md`
- `docs/BACKLOG_SPRINT_3.md`
- `docs/BACKLOG_SPRINT_4.md`
- `docs/TESTE_LOCAL_SPRINT1.md`
- `docs/TESTE_LOCAL_SPRINT2.md`
- `docs/TESTE_LOCAL_SPRINT3.md`
- `docs/TESTE_LOCAL_SPRINT4.md`

## Infra local

1. Copiar `infra/.env.example` para `infra/.env`.
2. Subir servicos:
   - `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d`

Servicos previstos:
- Postgres
- Redis
- n8n

## API (Sprint 1 + Sprint 2)

1. Instalar dependencias:
   - `npm install`
2. Rodar API:
   - `npm run dev:api`
3. Endpoints base:
   - `GET /health`
   - `GET /v1/meta`
   - `POST /v1/tenants/bootstrap`
   - `POST /v1/auth/login`
   - `GET /v1/me`
   - `POST /v1/users`
   - `GET /v1/users`
   - `GET /v1/audit-events`
   - `POST /v1/contacts`
   - `GET /v1/contacts`
   - `GET /v1/contacts/:contactId`
   - `PATCH /v1/contacts/:contactId`
   - `DELETE /v1/contacts/:contactId`
   - `POST /v1/cases`
   - `GET /v1/cases`
   - `GET /v1/cases/:caseId`
   - `PATCH /v1/cases/:caseId`
   - `DELETE /v1/cases/:caseId`
   - `POST /v1/inbox/ingest`
   - `GET /v1/inbox/conversations`
   - `GET /v1/inbox/conversations/:conversationId`
   - `PATCH /v1/inbox/conversations/:conversationId`
   - `GET /v1/inbox/conversations/:conversationId/messages`
   - `POST /v1/inbox/conversations/:conversationId/messages`
   - `POST /v1/scheduling/requests`
   - `GET /v1/scheduling/requests`
   - `GET /v1/scheduling/requests/:operationId`
   - `POST /v1/scheduling/requests/:operationId/confirm`
   - `POST /v1/scheduling/requests/:operationId/reject`
   - `GET /v1/ai/conversations/:conversationId/context`
   - `GET /v1/ai/conversations/:conversationId/memory/snapshots`
   - `POST /v1/ai/conversations/:conversationId/memory/snapshots`
   - `GET /v1/ai/conversations/:conversationId/generations`
   - `POST /v1/ai/conversations/:conversationId/respond`
