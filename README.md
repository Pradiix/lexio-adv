# Lexio

SaaS juridico para operacao de escritorios de advocacia, com IA confiavel, automacao e governanca.

## Documentacao inicial

- `docs/ESTRUTURA_SAAS_COMPETITIVO.md`
- `docs/ARQUITETURA_SAAS_JURIDICO.md`
- `docs/PLANO_EXECUCAO_MVP.md`
- `docs/PRD_MVP_V1.md`
- `docs/ARQUITETURA_TECNICA_V1.md`
- `docs/BACKLOG_SPRINT_1.md`

## Infra local

1. Copiar `infra/.env.example` para `infra/.env`.
2. Subir servicos:
   - `docker compose --env-file infra/.env -f infra/docker-compose.yml up -d`

Servicos previstos:
- Postgres
- Redis
- n8n
