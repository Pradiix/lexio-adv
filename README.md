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
- `docs/TESTE_LOCAL_SPRINT1.md`
- `docs/TESTE_LOCAL_SPRINT2.md`

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
