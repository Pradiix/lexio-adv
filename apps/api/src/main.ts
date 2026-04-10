import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import { Pool } from "pg";
import { z } from "zod";

type Role = "owner" | "manager" | "agent";

type AuthUser = {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
};

const app = Fastify({ logger: true });

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? "0.0.0.0";
const jwtSecret = process.env.JWT_SECRET ?? "lexio_dev_change_me";

const databaseUrl =
  process.env.DATABASE_URL ??
  `postgres://${process.env.POSTGRES_USER ?? "lexio"}:${process.env.POSTGRES_PASSWORD ?? "lexio_pass"}@${process.env.POSTGRES_HOST ?? "127.0.0.1"}:${process.env.POSTGRES_PORT ?? "5432"}/${process.env.POSTGRES_DB ?? "lexio_db"}`;

const pool = new Pool({ connectionString: databaseUrl });

await app.register(cors, { origin: true });
await app.register(jwt, { secret: jwtSecret });

const tenantBootstrapSchema = z.object({
  tenantName: z.string().min(2),
  tenantSlug: z.string().min(2).regex(/^[a-z0-9-]+$/),
  ownerName: z.string().min(2),
  ownerEmail: z.email(),
  ownerPassword: z.string().min(8)
});

const loginSchema = z.object({
  tenantSlug: z.string().min(2),
  email: z.email(),
  password: z.string().min(1)
});

const createUserSchema = z.object({
  fullName: z.string().min(2),
  email: z.email(),
  password: z.string().min(8),
  role: z.enum(["owner", "manager", "agent"])
});

const auditListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional()
});

const listQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().min(1).max(120).optional()
});

const contactStatusSchema = z.enum(["lead", "client", "archived"]);

const contactCreateSchema = z.object({
  fullName: z.string().min(2),
  email: z.email().optional().nullable(),
  phone: z.string().min(6).max(30).optional().nullable(),
  whatsappId: z.string().min(3).max(80).optional().nullable(),
  status: contactStatusSchema.optional(),
  tags: z.array(z.string().min(1).max(40)).optional(),
  notes: z.string().max(3000).optional().nullable()
});

const contactUpdateSchema = z
  .object({
    fullName: z.string().min(2).optional(),
    email: z.email().optional().nullable(),
    phone: z.string().min(6).max(30).optional().nullable(),
    whatsappId: z.string().min(3).max(80).optional().nullable(),
    status: contactStatusSchema.optional(),
    tags: z.array(z.string().min(1).max(40)).optional(),
    notes: z.string().max(3000).optional().nullable()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Nenhum campo para atualizar"
  });

const caseStatusSchema = z.enum([
  "open",
  "in_progress",
  "waiting_client",
  "closed",
  "archived"
]);
const casePrioritySchema = z.enum(["low", "medium", "high", "urgent"]);

const caseCreateSchema = z.object({
  contactId: z.uuid(),
  title: z.string().min(3).max(200),
  description: z.string().max(5000).optional().nullable(),
  practiceArea: z.string().min(2).max(80).optional().nullable(),
  status: caseStatusSchema.optional(),
  priority: casePrioritySchema.optional()
});

const caseUpdateSchema = z
  .object({
    contactId: z.uuid().optional(),
    title: z.string().min(3).max(200).optional(),
    description: z.string().max(5000).optional().nullable(),
    practiceArea: z.string().min(2).max(80).optional().nullable(),
    status: caseStatusSchema.optional(),
    priority: casePrioritySchema.optional()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Nenhum campo para atualizar"
  });

const getAuthUser = (request: FastifyRequest): AuthUser => {
  const user = request.user as Partial<AuthUser> | undefined;
  if (!user?.userId || !user?.tenantId || !user?.role || !user?.email) {
    throw new Error("Token invalido");
  }
  return {
    userId: user.userId,
    tenantId: user.tenantId,
    role: user.role,
    email: user.email
  };
};

const authenticate = async (request: FastifyRequest, reply: FastifyReply) => {
  try {
    await request.jwtVerify();
  } catch {
    return reply.status(401).send({ message: "Nao autenticado" });
  }
};

const requireRoles =
  (roles: Role[]) =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getAuthUser(request);
    if (!roles.includes(user.role)) {
      reply.status(403).send({ message: "Sem permissao" });
    }
  };

const ensureTenantScope =
  () =>
  async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const user = getAuthUser(request);
    const tenantIdFromHeader = request.headers["x-tenant-id"];
    if (
      typeof tenantIdFromHeader === "string" &&
      tenantIdFromHeader !== user.tenantId
    ) {
      reply.status(403).send({ message: "Escopo de tenant invalido" });
    }
  };

const writeAuditEvent = async (params: {
  tenantId: string;
  actorUserId: string;
  action: string;
  targetType: string;
  targetId: string;
  metadata?: Record<string, unknown>;
}) => {
  await pool.query(
    `INSERT INTO audit_events
     (tenant_id, actor_user_id, action, target_type, target_id, metadata_json)
     VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
    [
      params.tenantId,
      params.actorUserId,
      params.action,
      params.targetType,
      params.targetId,
      JSON.stringify(params.metadata ?? {})
    ]
  );
};

app.get("/health", async () => {
  let dbStatus: "up" | "down" = "down";
  try {
    const db = await pool.query("SELECT 1 AS ok");
    dbStatus = db.rows[0]?.ok === 1 ? "up" : "down";
  } catch {
    dbStatus = "down";
  }
  return {
    status: dbStatus === "up" ? "ok" : "degraded",
    service: "lexio-api",
    db: dbStatus,
    timestamp: new Date().toISOString()
  };
});

app.get("/v1/meta", async () => {
  return {
    product: "Lexio",
    stage: "mvp-foundation",
    version: "0.1.0",
    now: new Date().toISOString()
  };
});

app.post("/v1/tenants/bootstrap", async (request, reply) => {
  const parsed = tenantBootstrapSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      message: "Payload invalido",
      issues: parsed.error.issues
    });
  }

  const { tenantName, tenantSlug, ownerName, ownerEmail, ownerPassword } =
    parsed.data;

  const existing = await pool.query("SELECT id FROM tenants WHERE slug = $1", [
    tenantSlug
  ]);
  if (existing.rowCount && existing.rowCount > 0) {
    return reply.status(409).send({ message: "Slug de tenant ja existe" });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const tenantRes = await client.query<{ id: string }>(
      "INSERT INTO tenants (name, slug) VALUES ($1, $2) RETURNING id",
      [tenantName, tenantSlug]
    );
    const tenantId = tenantRes.rows[0].id;
    const passwordHash = await bcrypt.hash(ownerPassword, 12);
    const ownerRes = await client.query<{ id: string }>(
      `INSERT INTO users
       (tenant_id, full_name, email, role, password_hash)
       VALUES ($1, $2, $3, 'owner', $4)
       RETURNING id`,
      [tenantId, ownerName, ownerEmail, passwordHash]
    );
    await client.query("COMMIT");
    return reply.status(201).send({
      tenantId,
      ownerUserId: ownerRes.rows[0].id
    });
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
});

app.post("/v1/auth/login", async (request, reply) => {
  const parsed = loginSchema.safeParse(request.body);
  if (!parsed.success) {
    return reply.status(400).send({
      message: "Payload invalido",
      issues: parsed.error.issues
    });
  }

  const { tenantSlug, email, password } = parsed.data;

  const userRes = await pool.query<{
    id: string;
    tenant_id: string;
    role: Role;
    email: string;
    password_hash: string | null;
  }>(
    `SELECT u.id, u.tenant_id, u.role, u.email, u.password_hash
     FROM users u
     JOIN tenants t ON t.id = u.tenant_id
     WHERE t.slug = $1 AND u.email = $2
     LIMIT 1`,
    [tenantSlug, email]
  );

  if (!userRes.rowCount) {
    return reply.status(401).send({ message: "Credenciais invalidas" });
  }

  const user = userRes.rows[0];
  if (!user.password_hash) {
    return reply.status(401).send({ message: "Credenciais invalidas" });
  }

  const valid = await bcrypt.compare(password, user.password_hash);
  if (!valid) {
    return reply.status(401).send({ message: "Credenciais invalidas" });
  }

  const token = await reply.jwtSign({
    userId: user.id,
    tenantId: user.tenant_id,
    role: user.role,
    email: user.email
  });

  return {
    token,
    user: {
      id: user.id,
      tenantId: user.tenant_id,
      role: user.role,
      email: user.email
    }
  };
});

app.get(
  "/v1/me",
  { preHandler: [authenticate, ensureTenantScope()] },
  async (request) => {
    const user = getAuthUser(request);
    return { user };
  }
);

app.post(
  "/v1/users",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = createUserSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }

    const { fullName, email, role, password } = parsed.data;
    const passwordHash = await bcrypt.hash(password, 12);

    try {
      const insertRes = await pool.query<{
        id: string;
        tenant_id: string;
        full_name: string;
        email: string;
        role: Role;
      }>(
        `INSERT INTO users (tenant_id, full_name, email, role, password_hash)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, tenant_id, full_name, email, role`,
        [auth.tenantId, fullName, email, role, passwordHash]
      );

      const created = insertRes.rows[0];
      await writeAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "user.create",
        targetType: "user",
        targetId: created.id,
        metadata: { email: created.email, role: created.role }
      });

      return reply.status(201).send({
        user: {
          id: created.id,
          tenantId: created.tenant_id,
          fullName: created.full_name,
          email: created.email,
          role: created.role
        }
      });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro interno";
      if (msg.includes("users_tenant_id_email_key")) {
        return reply.status(409).send({ message: "Email ja cadastrado" });
      }
      throw error;
    }
  }
);

app.get(
  "/v1/users",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request) => {
    const auth = getAuthUser(request);
    const usersRes = await pool.query<{
      id: string;
      full_name: string;
      email: string;
      role: Role;
      created_at: string;
    }>(
      `SELECT id, full_name, email, role, created_at
       FROM users
       WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [auth.tenantId]
    );
    return { users: usersRes.rows };
  }
);

app.post(
  "/v1/contacts",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = contactCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    try {
      const createdRes = await pool.query<{
        id: string;
        full_name: string;
        email: string | null;
        phone: string | null;
        whatsapp_id: string | null;
        status: "lead" | "client" | "archived";
        tags_json: string[];
        notes: string | null;
        created_at: string;
        updated_at: string;
      }>(
        `INSERT INTO contacts
         (tenant_id, full_name, email, phone, whatsapp_id, status, tags_json, notes, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $9)
         RETURNING id, full_name, email, phone, whatsapp_id, status, tags_json, notes, created_at, updated_at`,
        [
          auth.tenantId,
          data.fullName,
          data.email ?? null,
          data.phone ?? null,
          data.whatsappId ?? null,
          data.status ?? "lead",
          JSON.stringify(data.tags ?? []),
          data.notes ?? null,
          auth.userId
        ]
      );

      const created = createdRes.rows[0];
      await writeAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "contact.create",
        targetType: "contact",
        targetId: created.id,
        metadata: {
          status: created.status,
          fullName: created.full_name
        }
      });

      return reply.status(201).send({ contact: created });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro interno";
      if (msg.includes("idx_contacts_tenant_email_unique")) {
        return reply.status(409).send({ message: "Email ja cadastrado no tenant" });
      }
      throw error;
    }
  }
);

app.get(
  "/v1/contacts",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const search = parsed.data.search?.trim() || null;

    const where = `
      tenant_id = $1
      AND (
        $2::text IS NULL
        OR full_name ILIKE '%' || $2 || '%'
        OR COALESCE(email, '') ILIKE '%' || $2 || '%'
        OR COALESCE(phone, '') ILIKE '%' || $2 || '%'
      )`;

    const itemsRes = await pool.query(
      `SELECT id, full_name, email, phone, whatsapp_id, status, tags_json, notes, created_at, updated_at
       FROM contacts
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $3 OFFSET $4`,
      [auth.tenantId, search, limit, offset]
    );
    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM contacts
       WHERE ${where}`,
      [auth.tenantId, search]
    );

    return {
      items: itemsRes.rows,
      total: Number(totalRes.rows[0].total),
      limit,
      offset
    };
  }
);

app.get(
  "/v1/contacts/:contactId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { contactId?: string };
    const contactId = params.contactId;
    if (!contactId) {
      return reply.status(400).send({ message: "contactId obrigatorio" });
    }

    const contactRes = await pool.query(
      `SELECT id, full_name, email, phone, whatsapp_id, status, tags_json, notes, created_at, updated_at
       FROM contacts
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, contactId]
    );
    if (!contactRes.rowCount) {
      return reply.status(404).send({ message: "Contato nao encontrado" });
    }

    return { contact: contactRes.rows[0] };
  }
);

app.patch(
  "/v1/contacts/:contactId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { contactId?: string };
    const contactId = params.contactId;
    if (!contactId) {
      return reply.status(400).send({ message: "contactId obrigatorio" });
    }

    const parsed = contactUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const existingRes = await pool.query<{
      id: string;
      full_name: string;
      email: string | null;
      phone: string | null;
      whatsapp_id: string | null;
      status: "lead" | "client" | "archived";
      tags_json: string[];
      notes: string | null;
    }>(
      `SELECT id, full_name, email, phone, whatsapp_id, status, tags_json, notes
       FROM contacts
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, contactId]
    );

    if (!existingRes.rowCount) {
      return reply.status(404).send({ message: "Contato nao encontrado" });
    }

    const existing = existingRes.rows[0];

    try {
      const updatedRes = await pool.query(
        `UPDATE contacts
         SET full_name = $3,
             email = $4,
             phone = $5,
             whatsapp_id = $6,
             status = $7,
             tags_json = $8::jsonb,
             notes = $9,
             updated_by = $10,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2
         RETURNING id, full_name, email, phone, whatsapp_id, status, tags_json, notes, created_at, updated_at`,
        [
          auth.tenantId,
          contactId,
          data.fullName ?? existing.full_name,
          data.email === undefined ? existing.email : data.email,
          data.phone === undefined ? existing.phone : data.phone,
          data.whatsappId === undefined ? existing.whatsapp_id : data.whatsappId,
          data.status ?? existing.status,
          JSON.stringify(data.tags ?? existing.tags_json ?? []),
          data.notes === undefined ? existing.notes : data.notes,
          auth.userId
        ]
      );
      const updated = updatedRes.rows[0];

      await writeAuditEvent({
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        action: "contact.update",
        targetType: "contact",
        targetId: contactId,
        metadata: { changedFields: Object.keys(data) }
      });

      return { contact: updated };
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Erro interno";
      if (msg.includes("idx_contacts_tenant_email_unique")) {
        return reply.status(409).send({ message: "Email ja cadastrado no tenant" });
      }
      throw error;
    }
  }
);

app.delete(
  "/v1/contacts/:contactId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { contactId?: string };
    const contactId = params.contactId;
    if (!contactId) {
      return reply.status(400).send({ message: "contactId obrigatorio" });
    }

    const deletedRes = await pool.query<{
      id: string;
      full_name: string;
    }>(
      `DELETE FROM contacts
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, full_name`,
      [auth.tenantId, contactId]
    );

    if (!deletedRes.rowCount) {
      return reply.status(404).send({ message: "Contato nao encontrado" });
    }

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "contact.delete",
      targetType: "contact",
      targetId: contactId,
      metadata: { fullName: deletedRes.rows[0].full_name }
    });

    return { success: true };
  }
);

app.post(
  "/v1/cases",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = caseCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const contactRes = await pool.query(
      `SELECT id FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, data.contactId]
    );
    if (!contactRes.rowCount) {
      return reply.status(400).send({ message: "contactId invalido para este tenant" });
    }

    const createdRes = await pool.query(
      `INSERT INTO cases
       (tenant_id, contact_id, title, description, practice_area, status, priority, created_by, updated_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
       RETURNING id, contact_id, title, description, practice_area, status, priority, opened_at, closed_at, created_at, updated_at`,
      [
        auth.tenantId,
        data.contactId,
        data.title,
        data.description ?? null,
        data.practiceArea ?? null,
        data.status ?? "open",
        data.priority ?? "medium",
        auth.userId
      ]
    );
    const created = createdRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "case.create",
      targetType: "case",
      targetId: created.id,
      metadata: {
        title: created.title,
        status: created.status,
        priority: created.priority
      }
    });

    return reply.status(201).send({ case: created });
  }
);

app.get(
  "/v1/cases",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = listQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const search = parsed.data.search?.trim() || null;

    const where = `
      c.tenant_id = $1
      AND (
        $2::text IS NULL
        OR c.title ILIKE '%' || $2 || '%'
        OR COALESCE(c.practice_area, '') ILIKE '%' || $2 || '%'
        OR COALESCE(ct.full_name, '') ILIKE '%' || $2 || '%'
      )`;

    const itemsRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.full_name AS contact_name, c.title, c.description, c.practice_area, c.status, c.priority, c.opened_at, c.closed_at, c.created_at, c.updated_at
       FROM cases c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE ${where}
       ORDER BY c.created_at DESC
       LIMIT $3 OFFSET $4`,
      [auth.tenantId, search, limit, offset]
    );
    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM cases c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE ${where}`,
      [auth.tenantId, search]
    );

    return {
      items: itemsRes.rows,
      total: Number(totalRes.rows[0].total),
      limit,
      offset
    };
  }
);

app.get(
  "/v1/cases/:caseId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { caseId?: string };
    const caseId = params.caseId;
    if (!caseId) {
      return reply.status(400).send({ message: "caseId obrigatorio" });
    }

    const caseRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.full_name AS contact_name, c.title, c.description, c.practice_area, c.status, c.priority, c.opened_at, c.closed_at, c.created_at, c.updated_at
       FROM cases c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.tenant_id = $1 AND c.id = $2
       LIMIT 1`,
      [auth.tenantId, caseId]
    );
    if (!caseRes.rowCount) {
      return reply.status(404).send({ message: "Caso nao encontrado" });
    }

    return { case: caseRes.rows[0] };
  }
);

app.patch(
  "/v1/cases/:caseId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { caseId?: string };
    const caseId = params.caseId;
    if (!caseId) {
      return reply.status(400).send({ message: "caseId obrigatorio" });
    }

    const parsed = caseUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const existingRes = await pool.query<{
      id: string;
      contact_id: string;
      title: string;
      description: string | null;
      practice_area: string | null;
      status: "open" | "in_progress" | "waiting_client" | "closed" | "archived";
      priority: "low" | "medium" | "high" | "urgent";
      opened_at: string;
      closed_at: string | null;
    }>(
      `SELECT id, contact_id, title, description, practice_area, status, priority, opened_at, closed_at
       FROM cases
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, caseId]
    );
    if (!existingRes.rowCount) {
      return reply.status(404).send({ message: "Caso nao encontrado" });
    }
    const existing = existingRes.rows[0];

    if (data.contactId) {
      const contactRes = await pool.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [auth.tenantId, data.contactId]
      );
      if (!contactRes.rowCount) {
        return reply.status(400).send({ message: "contactId invalido para este tenant" });
      }
    }

    const nextStatus = data.status ?? existing.status;
    const closedAt =
      nextStatus === "closed"
        ? existing.closed_at ?? new Date().toISOString()
        : null;

    const updatedRes = await pool.query(
      `UPDATE cases
       SET contact_id = $3,
           title = $4,
           description = $5,
           practice_area = $6,
           status = $7,
           priority = $8,
           closed_at = $9,
           updated_by = $10,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, contact_id, title, description, practice_area, status, priority, opened_at, closed_at, created_at, updated_at`,
      [
        auth.tenantId,
        caseId,
        data.contactId ?? existing.contact_id,
        data.title ?? existing.title,
        data.description === undefined ? existing.description : data.description,
        data.practiceArea === undefined ? existing.practice_area : data.practiceArea,
        nextStatus,
        data.priority ?? existing.priority,
        closedAt,
        auth.userId
      ]
    );
    const updated = updatedRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "case.update",
      targetType: "case",
      targetId: caseId,
      metadata: { changedFields: Object.keys(data), status: updated.status }
    });

    return { case: updated };
  }
);

app.delete(
  "/v1/cases/:caseId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { caseId?: string };
    const caseId = params.caseId;
    if (!caseId) {
      return reply.status(400).send({ message: "caseId obrigatorio" });
    }

    const deletedRes = await pool.query<{
      id: string;
      title: string;
    }>(
      `DELETE FROM cases
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, title`,
      [auth.tenantId, caseId]
    );
    if (!deletedRes.rowCount) {
      return reply.status(404).send({ message: "Caso nao encontrado" });
    }

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "case.delete",
      targetType: "case",
      targetId: caseId,
      metadata: { title: deletedRes.rows[0].title }
    });

    return { success: true };
  }
);

app.get(
  "/v1/audit-events",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = auditListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 50;

    const auditRes = await pool.query<{
      id: string;
      actor_user_id: string | null;
      action: string;
      target_type: string;
      target_id: string;
      metadata_json: Record<string, unknown>;
      created_at: string;
    }>(
      `SELECT id, actor_user_id, action, target_type, target_id, metadata_json, created_at
       FROM audit_events
       WHERE tenant_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [auth.tenantId, limit]
    );

    return { events: auditRes.rows };
  }
);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (!reply.sent) {
    reply.status(500).send({ message: "Erro interno" });
  }
});

const start = async () => {
  try {
    await app.listen({ port, host });
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
};

await start();
