# PRD MVP v1 - Lexio

## Objetivo
Lancar a primeira versao comercial de um SaaS juridico para escritorio de advocacia com foco em:
- atendimento omnichannel,
- operacao juridica,
- agenda confiavel,
- e visibilidade gerencial.

## Problema
Escritorios perdem eficiencia e receita por:
1. atendimento disperso,
2. perda de contexto,
3. falhas em operacoes criticas (agendamento/mensagens),
4. pouca previsibilidade de resultado.

## Publico-alvo (ICP)
- Escritorios pequenos e medios (5-50 pessoas).
- Alto volume de atendimento por WhatsApp.
- Necessidade de padrao operacional.

## Proposta de valor
"Transformar atendimento em resultado juridico e financeiro com IA confiavel e governanca."

## Escopo MVP
1. Multi-tenant + usuarios + permissoes basicas.
2. CRM juridico (contatos e casos).
3. Inbox WhatsApp com timeline por cliente.
4. Assistente IA com memoria por cliente.
5. Agenda com confirmacao em 2 etapas.
6. Dashboard operacional basico.
7. Auditoria de eventos criticos.

## Fora do escopo MVP
- Aplicativo mobile nativo.
- Marketplace de integracoes.
- Benchmark entre escritorios.
- Portal do cliente completo.

## Requisitos funcionais
1. Criar/editar/listar contatos e casos por tenant.
2. Receber e exibir mensagens por conversa.
3. Responder com IA mantendo contexto.
4. Exigir confirmacao para criar/cancelar agenda.
5. Registrar auditoria (quem, quando, o que).

## Requisitos nao funcionais
1. Segregacao de dados por tenant.
2. Logs estruturados.
3. Retentativa em tarefas assincronas.
4. Politica de retencao minima (LGPD).

## KPI de sucesso (MVP)
1. Erro em operacoes criticas < 1%.
2. Tempo medio de primeira resposta < 2 min.
3. Taxa de agendamento concluido > 70%.
4. Atendimento com resumo salvo > 80%.

