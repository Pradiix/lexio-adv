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
