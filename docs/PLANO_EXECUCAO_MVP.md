# Plano de Execucao MVP - SaaS Juridico

## Objetivo do plano
Transformar a arquitetura em entregas executaveis, com ordem clara e baixo risco.

## Epicos do MVP

## E1) Fundacao de plataforma

### Entregas
- Estrutura multi-tenant no banco.
- Autenticacao e autorizacao (RBAC basico).
- Auditoria de eventos criticos.
- Base de configuracoes por tenant.

### Criterios de aceite
- Todas as tabelas principais com `tenant_id`.
- Usuario de um tenant nao acessa dados de outro.
- Toda acao critica gera `audit_event`.

## E2) CRM Juridico

### Entregas
- Cadastro de contatos/clientes.
- Cadastro de casos.
- Status e historico resumido.

### Criterios de aceite
- Criar, atualizar, listar e filtrar contatos/casos por tenant.
- Vinculo entre caso e cliente.
- Alteracao de status com trilha de auditoria.

## E3) Inbox + Conversa

### Entregas
- Ingestao de mensagens (WhatsApp inicial).
- Timeline de conversa no painel.
- Persistencia de mensagens e metadata.

### Criterios de aceite
- Mensagem recebida aparece em inbox em ate 3s (meta inicial).
- Conversa agrupada por cliente/sessao.
- Deduplicacao ativa para evitar processamento duplo.

## E4) Atendimento IA com memoria

### Entregas
- Rota de atendimento com agente IA.
- Memoria por cliente (contexto no Postgres).
- Resumo automatizado de atendimento.

### Criterios de aceite
- Resposta coerente com contexto existente.
- Resumo salvo ao encerrar atendimento.
- Fallback claro quando ferramenta externa falhar.

## E5) Agenda segura (deterministica)

### Entregas
- Agendamento/cancelamento com confirmacao em 2 etapas.
- Fluxo deterministico para operacoes criticas.
- Registro de operacao e status final.

### Criterios de aceite
- Criacao exige `CONFIRMAR XXXXXX`.
- Cancelamento exige `CONFIRMAR XXXXXX`.
- Auditoria completa de solicitacao -> confirmacao -> execucao.

## E6) Dashboard operacional

### Entregas
- Metricas de atendimento (volume, tempo, sucesso/erro).
- Metricas de agenda e falhas.
- Visao de saude das automacoes.

### Criterios de aceite
- Painel com filtros por tenant e periodo.
- Indicadores principais atualizados diariamente.

## Ordem recomendada de construcao

1. E1 Fundacao.
2. E2 CRM.
3. E3 Inbox.
4. E5 Agenda segura (antes de escalar IA).
5. E4 IA com memoria.
6. E6 Dashboard.

## Sprints sugeridas (2 semanas)

### Sprint 1
- E1 completo.
- Base de E2 (contato/caso CRUD).

### Sprint 2
- E2 completo.
- E3 ingestao e timeline inicial.

### Sprint 3
- E5 completo.
- E3 estabilizacao.

### Sprint 4
- E4 completo.
- E6 versao inicial.

## Requisitos nao funcionais minimos

- Observabilidade: logs estruturados por `tenant_id`.
- Resiliencia: retry + DLQ em tarefas assincronas.
- Seguranca: segredo fora de codigo, rotacao de chave.
- Compliance: politica de retencao ativa.

## Checklist de inicio da implementacao

1. Confirmar stack do Core API (ex: Node/NestJS, Go, etc).
2. Confirmar stack do painel web (ex: Next.js).
3. Confirmar provedor de fila (ex: Redis + BullMQ).
4. Confirmar estrategia de deploy (cloud e ambientes).
5. Confirmar metas de KPI do trimestre.

