DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cases_tenant_id_id_unique'
  ) THEN
    ALTER TABLE cases
    ADD CONSTRAINT cases_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS scheduling_operations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID,
  case_id UUID,
  operation_type TEXT NOT NULL CHECK (operation_type IN ('create', 'cancel', 'reschedule')),
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'webchat', 'manual')),
  requested_start_at TIMESTAMPTZ,
  requested_end_at TIMESTAMPTZ,
  timezone TEXT NOT NULL DEFAULT 'America/Sao_Paulo',
  note TEXT,
  status TEXT NOT NULL DEFAULT 'pending_confirmation' CHECK (status IN ('pending_confirmation', 'confirmed', 'executed', 'cancelled', 'expired', 'rejected')),
  confirmation_code TEXT NOT NULL,
  confirmation_phrase TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  payload_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  result_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  requested_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  confirmed_at TIMESTAMPTZ,
  executed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduling_operations_contact_tenant_fkey'
  ) THEN
    ALTER TABLE scheduling_operations
    ADD CONSTRAINT scheduling_operations_contact_tenant_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES contacts (tenant_id, id)
    ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'scheduling_operations_case_tenant_fkey'
  ) THEN
    ALTER TABLE scheduling_operations
    ADD CONSTRAINT scheduling_operations_case_tenant_fkey
    FOREIGN KEY (tenant_id, case_id)
    REFERENCES cases (tenant_id, id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_sched_ops_tenant_status_created
ON scheduling_operations (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_sched_ops_tenant_expires
ON scheduling_operations (tenant_id, expires_at);

CREATE INDEX IF NOT EXISTS idx_sched_ops_tenant_contact
ON scheduling_operations (tenant_id, contact_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_sched_ops_tenant_confirmation_code
ON scheduling_operations (tenant_id, confirmation_code)
WHERE status IN ('pending_confirmation', 'confirmed');
