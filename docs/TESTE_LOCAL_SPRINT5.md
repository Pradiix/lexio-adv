# Teste Local Sprint 5

Data: 2026-04-10

## Ambiente
- Docker compose local ativo (`postgres`, `redis`, `n8n`).
- API buildada com `npm run build:api`.
- Endpoints testados com tenant dedicado de homologacao.

## Fluxo validado
1. `POST /v1/scheduling/expire-pending` (`dryRun=true`):
   - retorno `200` com `matched` e lista de IDs elegiveis.
2. `POST /v1/scheduling/expire-pending` (`dryRun=false`):
   - retorno `200` com `expired` > 0 para operacoes vencidas.
3. `GET /v1/dashboard/overview?days=30`:
   - retorno `200` com:
     - contatos totais e novos no periodo
     - casos abertos/criados/fechados
     - volume inbound/outbound e cobertura de resposta
     - status de agenda (pending/executed/rejected/expired)
     - geracoes IA e taxa de fallback
4. `GET /v1/dashboard/channels?days=30`:
   - retorno `200` com breakdown de mensagens e conversas por canal.
5. `GET /v1/audit-events`:
   - evento `scheduling.request.expire_sweep` presente.

## Evidencia de resultado
- `dashboardOverview.contactsTotal = 1`
- `dashboardOverview.messagesInPeriod = 2`
- `dashboardOverview.expiredInPeriod = 1`
- `dashboardChannels.messagesByChannel[0].channel = whatsapp`
- `expireDryRun.matched = 1`
- `expireSweep.expired = 1`

## Observacao
- O dashboard e calculado sob demanda no Postgres por tenant e janela de tempo (`days`), sem cache nesta etapa do MVP.
