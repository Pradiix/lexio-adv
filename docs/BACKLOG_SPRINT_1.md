# Backlog Sprint 1 - Lexio

## Meta do sprint
Entregar fundacao tecnica para desenvolvimento do MVP com base multi-tenant.

## Historias (prioridade)

1. Como owner, quero criar tenants para separar dados por escritorio.
   - Aceite: CRUD de tenant na API com validacoes.

2. Como owner, quero convidar usuarios ao tenant.
   - Aceite: usuario criado com papel e vinculo ao tenant.

3. Como sistema, quero autenticar usuario e aplicar RBAC basico.
   - Aceite: endpoints protegidos por papel.

4. Como sistema, quero registrar auditoria em acoes criticas.
   - Aceite: evento salvo com actor, acao, alvo e timestamp.

5. Como dev, quero infraestrutura local padrao (Postgres, Redis, n8n).
   - Aceite: ambiente sobe com `docker compose`.

6. Como dev, quero endpoint health e metadata.
   - Aceite: `GET /health` e `GET /v1/meta` respondendo 200.

## Tarefas tecnicas
- Criar schema SQL inicial (tenants/users/audit).
- Criar modulo de auth.
- Criar middleware de tenant context.
- Criar middleware de audit.
- Estruturar projeto API por modulos.
- Documentar contratos iniciais de API.

## Definition of Done
1. Codigo versionado.
2. Testes minimos de smoke.
3. Docs atualizadas.
4. Sem segredos hardcoded.

