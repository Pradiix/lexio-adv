# Teste Local Sprint 1

Data: 2026-04-10

## Ambiente
- Docker compose local ativo (`postgres`, `redis`, `n8n`).
- API buildada e executada em `localhost:3001`.

## Fluxo validado
1. `GET /health` com banco ativo:
   - retorno: `status=ok`, `db=up`.
2. `POST /v1/tenants/bootstrap`:
   - tenant e owner criados com sucesso.
3. `POST /v1/auth/login`:
   - JWT emitido corretamente.
4. `POST /v1/users` autenticado como `owner`:
   - usuario `agent` criado.
5. `GET /v1/users`:
   - listagem limitada ao tenant.
6. `GET /v1/audit-events`:
   - evento `user.create` registrado.

## Regras de seguranca validadas
- RBAC: `agent` nao acessa `GET /v1/audit-events` (`403`).
- Tenant scope: header `x-tenant-id` divergente do token retorna `403`.

## Observacao
- `GET /health` foi ajustado para retornar `degraded` quando banco estiver indisponivel, evitando erro 500 global.

