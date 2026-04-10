CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID,
  channel TEXT NOT NULL CHECK (channel IN ('whatsapp', 'email', 'webchat', 'manual')),
  external_thread_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed', 'archived')),
  last_message_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_tenant_id_id_unique'
  ) THEN
    ALTER TABLE conversations
    ADD CONSTRAINT conversations_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversations_contact_tenant_fkey'
  ) THEN
    ALTER TABLE conversations
    ADD CONSTRAINT conversations_contact_tenant_fkey
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
    WHERE conname = 'conversations_tenant_channel_thread_unique'
  ) THEN
    ALTER TABLE conversations
    ADD CONSTRAINT conversations_tenant_channel_thread_unique
    UNIQUE (tenant_id, channel, external_thread_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_last_message
ON conversations (tenant_id, last_message_at DESC NULLS LAST, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_conversations_tenant_contact
ON conversations (tenant_id, contact_id);

CREATE TABLE IF NOT EXISTS conversation_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  conversation_id UUID NOT NULL,
  contact_id UUID,
  source_channel TEXT NOT NULL CHECK (source_channel IN ('whatsapp', 'email', 'webchat', 'manual')),
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound', 'system')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('client', 'agent', 'ai', 'system')),
  external_message_id TEXT,
  message_text TEXT NOT NULL,
  attachments_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'conversation_messages_conversation_tenant_fkey'
  ) THEN
    ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_conversation_tenant_fkey
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
    WHERE conname = 'conversation_messages_contact_tenant_fkey'
  ) THEN
    ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_contact_tenant_fkey
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
    WHERE conname = 'conversation_messages_tenant_external_unique'
  ) THEN
    ALTER TABLE conversation_messages
    ADD CONSTRAINT conversation_messages_tenant_external_unique
    UNIQUE (tenant_id, external_message_id);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_messages_tenant_conversation_occurred
ON conversation_messages (tenant_id, conversation_id, occurred_at DESC);
