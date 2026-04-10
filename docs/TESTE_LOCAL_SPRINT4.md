# Teste Local Sprint 4

Data: 2026-04-10

## Ambiente
- Docker compose local ativo (`postgres`, `redis`, `n8n`).
- Migracao `infra/sql/006_ai_memory_and_generation_logs.sql` aplicada no Postgres.
- API buildada com `npm run build:api`.
- Teste executado sem `OPENAI_API_KEY` para validar fallback seguro.

## Fluxo validado
1. `POST /v1/inbox/ingest`:
   - cria conversa base para contexto IA.
2. `POST /v1/ai/conversations/:conversationId/memory/snapshots`:
   - retorno `201` com snapshot persistido.
3. `GET /v1/ai/conversations/:conversationId/context`:
   - retorno `200` com conversa, `latestMemory` e mensagens recentes.
4. `POST /v1/ai/conversations/:conversationId/respond`:
   - retorno `201`.
   - `used_fallback=true` (esperado sem chave OpenAI).
   - mensagem AI registrada na timeline.
5. `GET /v1/ai/conversations/:conversationId/memory/snapshots`:
   - retorno `200` com historico de snapshots.
6. `GET /v1/ai/conversations/:conversationId/generations`:
   - retorno `200` com log da geracao.
7. `GET /v1/audit-events`:
   - eventos `ai.memory.snapshot.create` e `ai.response.generate` presentes.

## Integridade e observabilidade validadas
- `ai_conversation_memory_snapshots` vinculado por `(tenant_id, conversation_id)` e `(tenant_id, contact_id)`.
- `ai_generation_logs` vinculado por `(tenant_id, conversation_id)` e opcionalmente ao `output_message_id`.
- `ai_generation_logs` armazena provider/model/latencia/fallback/metadata.

## Observacao
- Com `OPENAI_API_KEY` configurada, o mesmo endpoint `/respond` tenta gerar resposta real pela Responses API e so usa fallback em falha de rede/HTTP/payload vazio.
