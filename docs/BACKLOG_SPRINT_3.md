# Backlog Sprint 3 - Lexio

## Meta do sprint
Entregar Inbox Conversacional com ingestao/timeline e Agenda Deterministica com confirmacao em 2 etapas.

## Historias (prioridade)

1. Como sistema, quero ingerir mensagens de canais externos com idempotencia.
   - Aceite: ingestao cria/atualiza conversa e ignora duplicatas por `external_message_id`.

2. Como equipe de atendimento, quero visualizar conversas e timeline por tenant.
   - Aceite: listagem de conversas com busca/filtros e timeline paginada de mensagens.

3. Como operador, quero registrar mensagens de saida no historico.
   - Aceite: endpoint para anexar mensagem outbound na conversa.

4. Como sistema, quero manter isolamento multi-tenant no banco para inbox.
   - Aceite: FKs compostas garantem consistencia tenant+conversation e tenant+contact.

5. Como sistema, quero registrar auditoria de acoes de inbox.
   - Aceite: eventos `inbox.message.ingest`, `inbox.message.duplicate`, `inbox.message.create`, `inbox.conversation.update`.

6. Como sistema, quero impedir agendamentos equivocados com confirmacao explicita.
   - Aceite: toda operacao de agenda nasce como `pending_confirmation` com frase `CONFIRMAR CODIGO`.

7. Como operador, quero confirmar ou rejeitar uma solicitacao de agenda.
   - Aceite: confirmacao com texto incorreto retorna `400`; confirmacao correta muda status para `executed`; rejeicao muda para `rejected`.

## Tarefas tecnicas
- Criar migracao SQL `004_inbox_conversations_messages.sql`.
- Implementar upsert de conversa por `(tenant_id, channel, external_thread_id)`.
- Implementar deduplicacao por `UNIQUE (tenant_id, external_message_id)`.
- Implementar endpoints de inbox e filtros de busca.
- Adicionar criacao/associacao automatica de contato na ingestao quando possivel.
- Criar migracao SQL `005_scheduling_operations.sql`.
- Implementar endpoints de agenda deterministica (`create/list/get/confirm/reject`).
- Implementar codigo de confirmacao e expiracao de solicitacao.
- Validar E2E com cenarios de duplicidade, timeline e auditoria.

## Definition of Done
1. Build da API sem erros.
2. Migracao aplicada e validada no Postgres local.
3. Fluxo E2E de inbox validado.
4. Documentacao de sprint atualizada.
