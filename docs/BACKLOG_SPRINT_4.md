# Backlog Sprint 4 - Lexio

## Meta do sprint
Entregar atendimento com IA apoiado por memoria persistente por conversa/cliente, com fallback seguro.

## Historias (prioridade)

1. Como sistema, quero manter memoria estruturada da conversa para respostas mais consistentes.
   - Aceite: snapshots com resumo, fatos, pendencias e riscos salvos no Postgres.

2. Como atendente, quero recuperar rapidamente contexto completo de uma conversa.
   - Aceite: endpoint de contexto retorna conversa, ultimo snapshot e mensagens recentes.

3. Como operacao, quero gerar resposta IA com rastreabilidade.
   - Aceite: endpoint de resposta registra log de geracao (modelo, latencia, fallback, output).

4. Como sistema, quero fallback previsivel quando OpenAI falhar ou estiver indisponivel.
   - Aceite: resposta de fallback retornada com `used_fallback=true` sem quebrar fluxo.

5. Como gestao, quero trilha de auditoria para memoria e resposta de IA.
   - Aceite: eventos `ai.memory.snapshot.create` e `ai.response.generate` salvos em `audit_events`.

## Tarefas tecnicas
- Criar migracao `006_ai_memory_and_generation_logs.sql`.
- Criar tabelas `ai_conversation_memory_snapshots` e `ai_generation_logs` com FKs multi-tenant.
- Implementar endpoints:
  - `GET /v1/ai/conversations/:conversationId/context`
  - `GET/POST /v1/ai/conversations/:conversationId/memory/snapshots`
  - `GET /v1/ai/conversations/:conversationId/generations`
  - `POST /v1/ai/conversations/:conversationId/respond`
- Integrar chamada OpenAI Responses API via `fetch` (com env vars).
- Implementar fallback local de resposta.
- Ajustar handler global de erro para respeitar `statusCode` de erros 4xx.

## Definition of Done
1. Build da API sem erros.
2. Migracao aplicada no banco local.
3. Fluxo E2E IA/memoria validado.
4. Auditoria e logs de geracao validados.
