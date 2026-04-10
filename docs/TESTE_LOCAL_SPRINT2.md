# Teste Local Sprint 2

Data: 2026-04-10

## Ambiente
- Docker compose local ativo (`postgres`, `redis`, `n8n`).
- Migracao `infra/sql/003_contacts_cases.sql` aplicada no Postgres.
- API buildada com `npm run build:api`.

## Fluxo validado
1. `POST /v1/contacts`
   - retorno `201` com contato criado.
2. `GET /v1/contacts?limit=10&offset=0&search=Cliente`
   - retorno `200` com filtro funcionando.
3. `GET /v1/contacts/:contactId`
   - retorno `200` para item do tenant.
4. `PATCH /v1/contacts/:contactId`
   - retorno `200`, alterando status para `client`.
5. `POST /v1/cases`
   - retorno `201` com caso vinculado ao contato.
6. `GET /v1/cases?limit=10&offset=0&search=indenizatoria`
   - retorno `200` com filtro funcionando.
7. `GET /v1/cases/:caseId`
   - retorno `200` para item do tenant.
8. `PATCH /v1/cases/:caseId`
   - retorno `200`, alterando status para `closed` e preenchendo `closed_at`.
9. `DELETE /v1/cases/:caseId`
   - `403` para `agent` (RBAC), `200` para `owner`.
10. `DELETE /v1/contacts/:contactId`
   - `200` para `owner`.

## Regras de seguranca validadas
- RBAC:
  - `agent` nao pode excluir casos (`DELETE /v1/cases/:caseId` retorna `403`).
  - `agent` nao pode listar auditoria (`GET /v1/audit-events` retorna `403`).
- Tenant scope:
  - `GET /v1/me` com `x-tenant-id` divergente retorna `403`.
- Auditoria:
  - Eventos `contact.create`, `case.create` e `case.delete` presentes em `GET /v1/audit-events` do owner.

## Observacoes
- O endpoint `cases` valida se `contactId` pertence ao mesmo tenant antes de criar/atualizar.
- O banco reforca isolamento com FK composta `cases(tenant_id, contact_id) -> contacts(tenant_id, id)`.
- A API segue isolamento por `tenant_id` em listagem e detalhamento.
