# Arquitetura Tecnica v1 - Lexio

## Stack inicial
- API: Node.js + TypeScript.
- Web: Next.js.
- Banco: Postgres.
- Fila: Redis + BullMQ.
- Automacao: n8n.
- IA: OpenAI.

## Servicos
1. `core-api`: regras de negocio, auth, tenancy, auditoria.
2. `web-app`: painel operacional.
3. `automation-engine`: n8n para integracoes e fluxos.
4. `worker`: tarefas assincronas (resumo, sync, retries).

## Multi-tenant
- Estrategia: coluna `tenant_id` em tabelas de dominio.
- Indices compostos por `tenant_id` + chave funcional.
- Preparar RLS para fases avancadas.

## Dominios de dados (v1)
- `tenants`
- `users`
- `contacts`
- `cases`
- `conversations`
- `messages`
- `appointments`
- `audit_events`

## Integracoes v1
- WhatsApp gateway (entrada/saida de mensagens).
- Google Calendar (agenda).
- OpenAI (resposta e resumo).
- DataJud (consulta processual, fase controlada).

## Seguranca
- Segredos via variaveis de ambiente.
- RBAC minimo (`owner`, `manager`, `agent`).
- Log de auditoria para acao critica.
- Sanitizacao de PII em logs tecnicos.

## Observabilidade
- Logs JSON por servico.
- Correlation ID por request/conversa.
- Metricas basicas: sucesso/erro/latencia.

