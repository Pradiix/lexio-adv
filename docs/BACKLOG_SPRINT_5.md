# Backlog Sprint 5 - Lexio

## Meta do sprint
Concluir MVP backend com dashboard operacional e rotina de saneamento de agenda pendente.

## Historias (prioridade)

1. Como gestao, quero um painel operacional por tenant para acompanhar saude do atendimento.
   - Aceite: endpoint de overview com metricas de CRM, inbox, agenda e IA por periodo.

2. Como operacao, quero visao por canal para priorizar esforco da equipe.
   - Aceite: endpoint com breakdown de mensagens e conversas por canal.

3. Como sistema, quero remover pendencias de agenda expiradas automaticamente sob demanda.
   - Aceite: endpoint de sweep expira operacoes vencidas com modo `dryRun`.

4. Como compliance, quero auditoria de sweep de expiracao.
   - Aceite: evento `scheduling.request.expire_sweep` registrado.

## Tarefas tecnicas
- Implementar `POST /v1/scheduling/expire-pending`.
- Implementar `GET /v1/dashboard/overview`.
- Implementar `GET /v1/dashboard/channels`.
- Adicionar utilitario de periodo (`days`) para consultas analiticas.
- Atualizar documentação e validar com E2E.

## Definition of Done
1. Build sem erros.
2. Endpoints de dashboard respondendo com dados reais por tenant.
3. Sweep de expiracao validado em `dryRun` e execucao real.
4. Auditoria e documentação atualizadas.
