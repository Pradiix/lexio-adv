DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_messages_tenant_id_id_unique'
  ) THEN
    ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS ai_conversation_memory_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  contact_id UUID,
  summary_text TEXT NOT NULL,
  key_facts_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  open_tasks_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  risk_flags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  intent TEXT,
  sentiment TEXT CHECK (sentiment IN ('positive', 'neutral', 'negative', 'urgent')),
  confidence NUMERIC(4,3) NOT NULL DEFAULT 0.5 CHECK (confidence >= 0 AND confidence <= 1),
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_memory_conversation_tenant_fkey'
  ) THEN
    ALTER TABLE ai_conversation_memory_snapshots
    ADD CONSTRAINT ai_memory_conversation_tenant_fkey
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES conversations (tenant_id, id)
    ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_memory_contact_tenant_fkey'
  ) THEN
    ALTER TABLE ai_conversation_memory_snapshots
    ADD CONSTRAINT ai_memory_contact_tenant_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES contacts (tenant_id, id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_memory_tenant_conversation_created
ON ai_conversation_memory_snapshots (tenant_id, conversation_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_generation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  contact_id UUID,
  provider TEXT NOT NULL DEFAULT 'openai',
  model TEXT NOT NULL,
  used_fallback BOOLEAN NOT NULL DEFAULT false,
  input_messages_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  memory_snapshot_id UUID,
  output_text TEXT NOT NULL,
  finish_reason TEXT,
  latency_ms INTEGER,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generation_conversation_tenant_fkey'
  ) THEN
    ALTER TABLE ai_generation_logs
    ADD CONSTRAINT ai_generation_conversation_tenant_fkey
    FOREIGN KEY (tenant_id, conversation_id)
    REFERENCES conversations (tenant_id, id)
    ON DELETE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generation_contact_tenant_fkey'
  ) THEN
    ALTER TABLE ai_generation_logs
    ADD CONSTRAINT ai_generation_contact_tenant_fkey
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
    WHERE conname = 'ai_generation_memory_snapshot_fkey'
  ) THEN
    ALTER TABLE ai_generation_logs
    ADD CONSTRAINT ai_generation_memory_snapshot_fkey
    FOREIGN KEY (memory_snapshot_id)
    REFERENCES ai_conversation_memory_snapshots (id)
    ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'ai_generation_message_tenant_fkey'
  ) THEN
    ALTER TABLE ai_generation_logs
    ADD COLUMN IF NOT EXISTS output_message_id UUID;

    ALTER TABLE ai_generation_logs
    ADD CONSTRAINT ai_generation_message_tenant_fkey
    FOREIGN KEY (tenant_id, output_message_id)
    REFERENCES conversation_messages (tenant_id, id)
    ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_ai_generation_tenant_conversation_created
ON ai_generation_logs (tenant_id, conversation_id, created_at DESC);
