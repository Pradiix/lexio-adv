CREATE TABLE IF NOT EXISTS contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  whatsapp_id TEXT,
  status TEXT NOT NULL DEFAULT 'lead' CHECK (status IN ('lead', 'client', 'archived')),
  tags_json JSONB NOT NULL DEFAULT '[]'::jsonb,
  notes TEXT,
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
    WHERE conname = 'contacts_tenant_id_id_unique'
  ) THEN
    ALTER TABLE contacts
    ADD CONSTRAINT contacts_tenant_id_id_unique UNIQUE (tenant_id, id);
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_contacts_tenant_email_unique
ON contacts (tenant_id, lower(email))
WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_created_at
ON contacts (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_contacts_tenant_status
ON contacts (tenant_id, status);

CREATE TABLE IF NOT EXISTS cases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  contact_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  practice_area TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'waiting_client', 'closed', 'archived')),
  priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low', 'medium', 'high', 'urgent')),
  opened_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  closed_at TIMESTAMPTZ,
  created_by UUID REFERENCES users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT cases_contact_tenant_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES contacts (tenant_id, id)
    ON DELETE RESTRICT
);

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cases_contact_id_fkey'
  ) THEN
    ALTER TABLE cases DROP CONSTRAINT cases_contact_id_fkey;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'cases_contact_tenant_fkey'
  ) THEN
    ALTER TABLE cases
    ADD CONSTRAINT cases_contact_tenant_fkey
    FOREIGN KEY (tenant_id, contact_id)
    REFERENCES contacts (tenant_id, id)
    ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_cases_tenant_created_at
ON cases (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_cases_tenant_status
ON cases (tenant_id, status);

CREATE INDEX IF NOT EXISTS idx_cases_tenant_priority
ON cases (tenant_id, priority);

CREATE INDEX IF NOT EXISTS idx_cases_tenant_contact
ON cases (tenant_id, contact_id);
