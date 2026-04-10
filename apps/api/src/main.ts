import "dotenv/config";
import Fastify, { type FastifyReply, type FastifyRequest } from "fastify";
import cors from "@fastify/cors";
import jwt from "@fastify/jwt";
import bcrypt from "bcryptjs";
import { randomBytes } from "crypto";
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
const openAiApiKey = process.env.OPENAI_API_KEY?.trim() || null;
const openAiModel = process.env.OPENAI_MODEL?.trim() || "gpt-4.1-mini";
const openAiBaseUrl =
  process.env.OPENAI_BASE_URL?.trim() || "https://api.openai.com/v1";

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

const inboxChannelSchema = z.enum(["whatsapp", "email", "webchat", "manual"]);
const inboxConversationStatusSchema = z.enum(["open", "closed", "archived"]);
const inboxDirectionSchema = z.enum(["inbound", "outbound", "system"]);
const inboxSenderTypeSchema = z.enum(["client", "agent", "ai", "system"]);

const inboxConversationListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  search: z.string().min(1).max(120).optional(),
  channel: inboxChannelSchema.optional(),
  status: inboxConversationStatusSchema.optional(),
  contactId: z.uuid().optional()
});

const inboxMessageListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional()
});

const inboxIngestSchema = z.object({
  channel: inboxChannelSchema,
  externalThreadId: z.string().min(2).max(150),
  externalMessageId: z.string().min(2).max(180).optional().nullable(),
  direction: inboxDirectionSchema,
  senderType: inboxSenderTypeSchema,
  messageText: z.string().min(1).max(10000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  contactId: z.uuid().optional().nullable(),
  contactName: z.string().min(2).max(180).optional().nullable(),
  contactEmail: z.email().optional().nullable(),
  contactPhone: z.string().min(6).max(30).optional().nullable(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).optional()
});

const inboxCreateMessageSchema = z.object({
  externalMessageId: z.string().min(2).max(180).optional().nullable(),
  direction: inboxDirectionSchema,
  senderType: inboxSenderTypeSchema,
  messageText: z.string().min(1).max(10000),
  occurredAt: z.iso.datetime({ offset: true }).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  attachments: z.array(z.record(z.string(), z.unknown())).optional()
});

const inboxUpdateConversationSchema = z
  .object({
    status: inboxConversationStatusSchema.optional(),
    contactId: z.uuid().optional().nullable()
  })
  .refine((payload) => Object.keys(payload).length > 0, {
    message: "Nenhum campo para atualizar"
  });

const schedulingOperationTypeSchema = z.enum(["create", "cancel", "reschedule"]);
const schedulingStatusSchema = z.enum([
  "pending_confirmation",
  "confirmed",
  "executed",
  "cancelled",
  "expired",
  "rejected"
]);

const schedulingCreateSchema = z
  .object({
    operationType: schedulingOperationTypeSchema,
    channel: inboxChannelSchema,
    contactId: z.uuid().optional().nullable(),
    caseId: z.uuid().optional().nullable(),
    requestedStartAt: z.iso.datetime({ offset: true }).optional().nullable(),
    requestedEndAt: z.iso.datetime({ offset: true }).optional().nullable(),
    timezone: z.string().min(2).max(80).optional(),
    note: z.string().max(2000).optional().nullable(),
    payload: z.record(z.string(), z.unknown()).optional()
  })
  .superRefine((payload, ctx) => {
    if (
      (payload.operationType === "create" ||
        payload.operationType === "reschedule") &&
      !payload.requestedStartAt
    ) {
      ctx.addIssue({
        code: "custom",
        message: "requestedStartAt obrigatorio para create/reschedule",
        path: ["requestedStartAt"]
      });
    }
  });

const schedulingListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(200).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  status: schedulingStatusSchema.optional(),
  operationType: schedulingOperationTypeSchema.optional()
});

const schedulingConfirmSchema = z.object({
  confirmationText: z.string().min(5).max(80)
});

const schedulingRejectSchema = z.object({
  reason: z.string().min(3).max(300).optional()
});

const schedulingExpireSchema = z.object({
  dryRun: z.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(1000).optional()
});

const aiContextQuerySchema = z.object({
  messageLimit: z.coerce.number().int().min(1).max(200).optional()
});

const aiMemoryListSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional()
});

const aiMemorySnapshotCreateSchema = z.object({
  summaryText: z.string().min(10).max(10000),
  keyFacts: z.array(z.string().min(1).max(300)).optional(),
  openTasks: z.array(z.string().min(1).max(300)).optional(),
  riskFlags: z.array(z.string().min(1).max(300)).optional(),
  intent: z.string().min(2).max(180).optional().nullable(),
  sentiment: z.enum(["positive", "neutral", "negative", "urgent"]).optional(),
  confidence: z.number().min(0).max(1).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const aiRespondSchema = z.object({
  userMessage: z.string().min(1).max(10000).optional(),
  systemInstruction: z.string().min(5).max(6000).optional(),
  temperature: z.number().min(0).max(2).optional(),
  maxOutputTokens: z.number().int().min(64).max(2000).optional(),
  model: z.string().min(2).max(120).optional(),
  saveAsMessage: z.boolean().optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const dashboardOverviewQuerySchema = z.object({
  days: z.coerce.number().int().min(1).max(365).optional()
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

const resolveContactForInbox = async (params: {
  tenantId: string;
  actorUserId: string;
  contactId?: string | null;
  contactName?: string | null;
  contactEmail?: string | null;
  contactPhone?: string | null;
}) => {
  if (params.contactId) {
    const directRes = await pool.query<{ id: string }>(
      `SELECT id FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [params.tenantId, params.contactId]
    );
    if (!directRes.rowCount) {
      return null;
    }
    return directRes.rows[0].id;
  }

  const email = params.contactEmail?.trim().toLowerCase() || null;
  const phone = params.contactPhone?.trim() || null;

  if (email || phone) {
    const existingRes = await pool.query<{ id: string }>(
      `SELECT id
       FROM contacts
       WHERE tenant_id = $1
         AND (
           ($2::text IS NOT NULL AND lower(email) = $2)
           OR ($3::text IS NOT NULL AND phone = $3)
         )
       ORDER BY created_at ASC
       LIMIT 1`,
      [params.tenantId, email, phone]
    );
    if (existingRes.rowCount) {
      return existingRes.rows[0].id;
    }
  }

  if (!params.contactName && !email && !phone) {
    return null;
  }

  const fullName =
    params.contactName?.trim() || email || phone || "Contato sem nome";
  try {
    const insertedRes = await pool.query<{ id: string }>(
      `INSERT INTO contacts
       (tenant_id, full_name, email, phone, status, tags_json, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'lead', '[]'::jsonb, $5, $5)
       RETURNING id`,
      [params.tenantId, fullName, email, phone, params.actorUserId]
    );
    return insertedRes.rows[0].id;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Erro interno";
    if (email && msg.includes("idx_contacts_tenant_email_unique")) {
      const fallbackRes = await pool.query<{ id: string }>(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND lower(email) = $2 LIMIT 1`,
        [params.tenantId, email]
      );
      if (fallbackRes.rowCount) {
        return fallbackRes.rows[0].id;
      }
    }
    throw error;
  }
};

const generateConfirmationCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  const bytes = randomBytes(6);
  let code = "";
  for (let i = 0; i < bytes.length; i += 1) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
};

const buildFallbackAiReply = (userMessage?: string) => {
  if (userMessage && userMessage.trim().length > 0) {
    return `Recebi sua mensagem: "${userMessage.trim()}". Vou registrar seu pedido e um membro da equipe juridica vai confirmar os proximos passos com voce em instantes.`;
  }
  return "Recebi sua solicitacao e vou encaminhar para a equipe juridica confirmar os proximos passos.";
};

const extractResponseTextFromOpenAiPayload = (payload: unknown): string | null => {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const data = payload as Record<string, unknown>;
  if (typeof data.output_text === "string" && data.output_text.trim().length > 0) {
    return data.output_text.trim();
  }

  const output = data.output;
  if (!Array.isArray(output)) {
    return null;
  }

  const parts: string[] = [];
  for (const item of output) {
    if (!item || typeof item !== "object") {
      continue;
    }
    const content = (item as Record<string, unknown>).content;
    if (!Array.isArray(content)) {
      continue;
    }
    for (const contentItem of content) {
      if (!contentItem || typeof contentItem !== "object") {
        continue;
      }
      const maybeText = (contentItem as Record<string, unknown>).text;
      if (typeof maybeText === "string" && maybeText.trim().length > 0) {
        parts.push(maybeText.trim());
      }
    }
  }

  if (!parts.length) {
    return null;
  }
  return parts.join("\n").trim();
};

const generateAiReply = async (params: {
  systemInstruction: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  model?: string;
  temperature?: number;
  maxOutputTokens?: number;
  userMessage?: string;
}) => {
  const fallbackText = buildFallbackAiReply(params.userMessage);
  const selectedModel = params.model?.trim() || openAiModel;

  if (!openAiApiKey) {
    return {
      text: fallbackText,
      provider: "fallback",
      model: selectedModel,
      usedFallback: true,
      finishReason: "fallback_no_api_key",
      latencyMs: 0,
      requestPayload: null,
      responsePayload: null
    };
  }

  const inputPayload = [
    {
      role: "system",
      content: [{ type: "input_text", text: params.systemInstruction }]
    },
    ...params.history.map((item) => ({
      role: item.role,
      content: [{ type: "input_text", text: item.text }]
    }))
  ];

  const requestPayload: Record<string, unknown> = {
    model: selectedModel,
    input: inputPayload,
    temperature: params.temperature ?? 0.2,
    max_output_tokens: params.maxOutputTokens ?? 500
  };

  const startedAt = Date.now();
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 20000);
    const response = await fetch(`${openAiBaseUrl}/responses`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${openAiApiKey}`
      },
      body: JSON.stringify(requestPayload),
      signal: controller.signal
    });
    clearTimeout(timeout);

    const responseBody = (await response.json()) as Record<string, unknown>;
    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return {
        text: fallbackText,
        provider: "openai",
        model: selectedModel,
        usedFallback: true,
        finishReason: "fallback_http_error",
        latencyMs,
        requestPayload,
        responsePayload: responseBody,
        error: `OpenAI HTTP ${response.status}`
      };
    }

    const replyText = extractResponseTextFromOpenAiPayload(responseBody);
    if (!replyText) {
      return {
        text: fallbackText,
        provider: "openai",
        model: selectedModel,
        usedFallback: true,
        finishReason: "fallback_empty_response",
        latencyMs,
        requestPayload,
        responsePayload: responseBody
      };
    }

    return {
      text: replyText,
      provider: "openai",
      model: selectedModel,
      usedFallback: false,
      finishReason:
        typeof responseBody.status === "string" ? responseBody.status : "completed",
      latencyMs,
      requestPayload,
      responsePayload: responseBody
    };
  } catch (error: unknown) {
    const latencyMs = Date.now() - startedAt;
    const message = error instanceof Error ? error.message : "Erro ao chamar OpenAI";
    return {
      text: fallbackText,
      provider: "openai",
      model: selectedModel,
      usedFallback: true,
      finishReason: "fallback_runtime_error",
      latencyMs,
      requestPayload,
      responsePayload: null,
      error: message
    };
  }
};

const getDashboardPeriodRange = (days: number) => {
  const dateTo = new Date();
  const dateFrom = new Date(dateTo.getTime() - days * 24 * 60 * 60 * 1000);
  return {
    dateFromIso: dateFrom.toISOString(),
    dateToIso: dateTo.toISOString()
  };
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

app.post(
  "/v1/inbox/ingest",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = inboxIngestSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;
    const occurredAt = data.occurredAt
      ? new Date(data.occurredAt).toISOString()
      : new Date().toISOString();

    const contactId = await resolveContactForInbox({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      contactId: data.contactId,
      contactName: data.contactName,
      contactEmail: data.contactEmail,
      contactPhone: data.contactPhone
    });
    if (data.contactId && !contactId) {
      return reply.status(400).send({ message: "contactId invalido para este tenant" });
    }

    const conversationRes = await pool.query<{
      id: string;
      tenant_id: string;
      contact_id: string | null;
      channel: "whatsapp" | "email" | "webchat" | "manual";
      external_thread_id: string;
      status: "open" | "closed" | "archived";
      last_message_at: string | null;
      created_at: string;
      updated_at: string;
    }>(
      `INSERT INTO conversations
       (tenant_id, contact_id, channel, external_thread_id, status, last_message_at, created_by, updated_by)
       VALUES ($1, $2, $3, $4, 'open', $5, $6, $6)
       ON CONFLICT (tenant_id, channel, external_thread_id)
       DO UPDATE SET
         contact_id = COALESCE(conversations.contact_id, EXCLUDED.contact_id),
         status = 'open',
         last_message_at = GREATEST(
           COALESCE(conversations.last_message_at, EXCLUDED.last_message_at),
           EXCLUDED.last_message_at
         ),
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
       RETURNING id, tenant_id, contact_id, channel, external_thread_id, status, last_message_at, created_at, updated_at`,
      [
        auth.tenantId,
        contactId,
        data.channel,
        data.externalThreadId,
        occurredAt,
        auth.userId
      ]
    );
    const conversation = conversationRes.rows[0];

    const attachmentsJson = JSON.stringify(data.attachments ?? []);
    const metadataJson = JSON.stringify(data.metadata ?? {});

    let deduplicated = false;
    let message: Record<string, unknown> | null = null;

    if (data.externalMessageId) {
      const insertedMessageRes = await pool.query(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
         ON CONFLICT (tenant_id, external_message_id)
         DO NOTHING
         RETURNING id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at`,
        [
          auth.tenantId,
          conversation.id,
          contactId,
          data.channel,
          data.direction,
          data.senderType,
          data.externalMessageId,
          data.messageText,
          attachmentsJson,
          metadataJson,
          occurredAt,
          auth.userId
        ]
      );
      if (insertedMessageRes.rowCount) {
        message = insertedMessageRes.rows[0];
      } else {
        deduplicated = true;
        const existingMessageRes = await pool.query(
          `SELECT id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at
           FROM conversation_messages
           WHERE tenant_id = $1 AND external_message_id = $2
           LIMIT 1`,
          [auth.tenantId, data.externalMessageId]
        );
        message = existingMessageRes.rows[0] ?? null;
      }
    } else {
      const insertedMessageRes = await pool.query(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
         RETURNING id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at`,
        [
          auth.tenantId,
          conversation.id,
          contactId,
          data.channel,
          data.direction,
          data.senderType,
          data.messageText,
          attachmentsJson,
          metadataJson,
          occurredAt,
          auth.userId
        ]
      );
      message = insertedMessageRes.rows[0];
    }

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: deduplicated ? "inbox.message.duplicate" : "inbox.message.ingest",
      targetType: "conversation",
      targetId: conversation.id,
      metadata: {
        channel: data.channel,
        direction: data.direction,
        senderType: data.senderType,
        deduplicated
      }
    });

    return reply.status(deduplicated ? 200 : 201).send({
      conversation,
      message,
      deduplicated
    });
  }
);

app.get(
  "/v1/inbox/conversations",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = inboxConversationListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const search = parsed.data.search?.trim() || null;
    const status = parsed.data.status ?? null;
    const channel = parsed.data.channel ?? null;
    const contactId = parsed.data.contactId ?? null;

    const where = `
      c.tenant_id = $1
      AND ($2::text IS NULL OR c.status = $2)
      AND ($3::text IS NULL OR c.channel = $3)
      AND ($4::uuid IS NULL OR c.contact_id = $4)
      AND (
        $5::text IS NULL
        OR c.external_thread_id ILIKE '%' || $5 || '%'
        OR COALESCE(ct.full_name, '') ILIKE '%' || $5 || '%'
        OR COALESCE(last_msg.message_text, '') ILIKE '%' || $5 || '%'
      )`;

    const itemsRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.full_name AS contact_name, c.channel, c.external_thread_id, c.status, c.last_message_at, c.created_at, c.updated_at,
              last_msg.message_text AS last_message_text, last_msg.direction AS last_message_direction, last_msg.occurred_at AS last_message_occurred_at
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN LATERAL (
         SELECT m.message_text, m.direction, m.occurred_at
         FROM conversation_messages m
         WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
         ORDER BY m.occurred_at DESC
         LIMIT 1
       ) last_msg ON TRUE
       WHERE ${where}
       ORDER BY COALESCE(c.last_message_at, c.created_at) DESC
       LIMIT $6 OFFSET $7`,
      [auth.tenantId, status, channel, contactId, search, limit, offset]
    );
    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       LEFT JOIN LATERAL (
         SELECT m.message_text
         FROM conversation_messages m
         WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
         ORDER BY m.occurred_at DESC
         LIMIT 1
       ) last_msg ON TRUE
       WHERE ${where}`,
      [auth.tenantId, status, channel, contactId, search]
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
  "/v1/inbox/conversations/:conversationId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const conversationRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.full_name AS contact_name, c.channel, c.external_thread_id, c.status, c.last_message_at, c.created_at, c.updated_at,
              (
                SELECT COUNT(*)::int
                FROM conversation_messages m
                WHERE m.tenant_id = c.tenant_id AND m.conversation_id = c.id
              ) AS message_count
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.tenant_id = $1 AND c.id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }

    return { conversation: conversationRes.rows[0] };
  }
);

app.patch(
  "/v1/inbox/conversations/:conversationId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const parsed = inboxUpdateConversationSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const existingRes = await pool.query<{
      id: string;
      status: "open" | "closed" | "archived";
      contact_id: string | null;
    }>(
      `SELECT id, status, contact_id
       FROM conversations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!existingRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
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

    const updatedRes = await pool.query(
      `UPDATE conversations
       SET status = $3,
           contact_id = $4,
           updated_by = $5,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, contact_id, channel, external_thread_id, status, last_message_at, created_at, updated_at`,
      [
        auth.tenantId,
        conversationId,
        data.status ?? existing.status,
        data.contactId === undefined ? existing.contact_id : data.contactId,
        auth.userId
      ]
    );
    const updated = updatedRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "inbox.conversation.update",
      targetType: "conversation",
      targetId: conversationId,
      metadata: {
        changedFields: Object.keys(data),
        status: updated.status
      }
    });

    return { conversation: updated };
  }
);

app.get(
  "/v1/inbox/conversations/:conversationId/messages",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }
    const parsed = inboxMessageListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 100;
    const offset = parsed.data.offset ?? 0;

    const conversationRes = await pool.query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }

    const itemsRes = await pool.query(
      `SELECT id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at
       FROM conversation_messages
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY occurred_at DESC
       LIMIT $3 OFFSET $4`,
      [auth.tenantId, conversationId, limit, offset]
    );
    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM conversation_messages
       WHERE tenant_id = $1 AND conversation_id = $2`,
      [auth.tenantId, conversationId]
    );

    return {
      items: itemsRes.rows,
      total: Number(totalRes.rows[0].total),
      limit,
      offset
    };
  }
);

app.post(
  "/v1/inbox/conversations/:conversationId/messages",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }
    const parsed = inboxCreateMessageSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;
    const occurredAt = data.occurredAt
      ? new Date(data.occurredAt).toISOString()
      : new Date().toISOString();

    const conversationRes = await pool.query<{
      id: string;
      contact_id: string | null;
      channel: "whatsapp" | "email" | "webchat" | "manual";
    }>(
      `SELECT id, contact_id, channel
       FROM conversations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }
    const conversation = conversationRes.rows[0];

    const attachmentsJson = JSON.stringify(data.attachments ?? []);
    const metadataJson = JSON.stringify(data.metadata ?? {});

    let deduplicated = false;
    let message: Record<string, unknown> | null = null;

    if (data.externalMessageId) {
      const insertedRes = await pool.query(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb, $10::jsonb, $11, $12)
         ON CONFLICT (tenant_id, external_message_id)
         DO NOTHING
         RETURNING id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at`,
        [
          auth.tenantId,
          conversation.id,
          conversation.contact_id,
          conversation.channel,
          data.direction,
          data.senderType,
          data.externalMessageId,
          data.messageText,
          attachmentsJson,
          metadataJson,
          occurredAt,
          auth.userId
        ]
      );
      if (insertedRes.rowCount) {
        message = insertedRes.rows[0];
      } else {
        deduplicated = true;
        const existingRes = await pool.query(
          `SELECT id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at
           FROM conversation_messages
           WHERE tenant_id = $1 AND external_message_id = $2
           LIMIT 1`,
          [auth.tenantId, data.externalMessageId]
        );
        message = existingRes.rows[0] ?? null;
      }
    } else {
      const insertedRes = await pool.query(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10, $11)
         RETURNING id, conversation_id, contact_id, source_channel, direction, sender_type, external_message_id, message_text, attachments_json, metadata_json, occurred_at, created_at`,
        [
          auth.tenantId,
          conversation.id,
          conversation.contact_id,
          conversation.channel,
          data.direction,
          data.senderType,
          data.messageText,
          attachmentsJson,
          metadataJson,
          occurredAt,
          auth.userId
        ]
      );
      message = insertedRes.rows[0];
    }

    await pool.query(
      `UPDATE conversations
       SET status = 'open',
           last_message_at = GREATEST(COALESCE(last_message_at, $3), $3),
           updated_by = $4,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2`,
      [auth.tenantId, conversation.id, occurredAt, auth.userId]
    );

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: deduplicated ? "inbox.message.create_duplicate" : "inbox.message.create",
      targetType: "conversation",
      targetId: conversation.id,
      metadata: {
        direction: data.direction,
        senderType: data.senderType,
        deduplicated
      }
    });

    return reply.status(deduplicated ? 200 : 201).send({
      message,
      deduplicated
    });
  }
);

app.post(
  "/v1/scheduling/requests",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = schedulingCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    if (data.contactId) {
      const contactRes = await pool.query(
        `SELECT id FROM contacts WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [auth.tenantId, data.contactId]
      );
      if (!contactRes.rowCount) {
        return reply.status(400).send({ message: "contactId invalido para este tenant" });
      }
    }
    if (data.caseId) {
      const caseRes = await pool.query(
        `SELECT id FROM cases WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
        [auth.tenantId, data.caseId]
      );
      if (!caseRes.rowCount) {
        return reply.status(400).send({ message: "caseId invalido para este tenant" });
      }
    }

    const expiresAt = new Date(Date.now() + 15 * 60 * 1000).toISOString();
    const requestedStartAt = data.requestedStartAt
      ? new Date(data.requestedStartAt).toISOString()
      : null;
    const requestedEndAt = data.requestedEndAt
      ? new Date(data.requestedEndAt).toISOString()
      : null;

    let created:
      | {
          id: string;
          contact_id: string | null;
          case_id: string | null;
          operation_type: "create" | "cancel" | "reschedule";
          channel: "whatsapp" | "email" | "webchat" | "manual";
          requested_start_at: string | null;
          requested_end_at: string | null;
          timezone: string;
          note: string | null;
          status:
            | "pending_confirmation"
            | "confirmed"
            | "executed"
            | "cancelled"
            | "expired"
            | "rejected";
          confirmation_code: string;
          confirmation_phrase: string;
          expires_at: string;
          payload_json: Record<string, unknown>;
          result_json: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        }
      | undefined;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const confirmationCode = generateConfirmationCode();
      const confirmationPhrase = `CONFIRMAR ${confirmationCode}`;
      try {
        const createdRes = await pool.query<{
          id: string;
          contact_id: string | null;
          case_id: string | null;
          operation_type: "create" | "cancel" | "reschedule";
          channel: "whatsapp" | "email" | "webchat" | "manual";
          requested_start_at: string | null;
          requested_end_at: string | null;
          timezone: string;
          note: string | null;
          status:
            | "pending_confirmation"
            | "confirmed"
            | "executed"
            | "cancelled"
            | "expired"
            | "rejected";
          confirmation_code: string;
          confirmation_phrase: string;
          expires_at: string;
          payload_json: Record<string, unknown>;
          result_json: Record<string, unknown>;
          created_at: string;
          updated_at: string;
        }>(
          `INSERT INTO scheduling_operations
           (tenant_id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, requested_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending_confirmation', $10, $11, $12, $13::jsonb, '{}'::jsonb, $14)
           RETURNING id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, created_at, updated_at`,
          [
            auth.tenantId,
            data.contactId ?? null,
            data.caseId ?? null,
            data.operationType,
            data.channel,
            requestedStartAt,
            requestedEndAt,
            data.timezone ?? "America/Sao_Paulo",
            data.note ?? null,
            confirmationCode,
            confirmationPhrase,
            expiresAt,
            JSON.stringify(data.payload ?? {}),
            auth.userId
          ]
        );
        created = createdRes.rows[0];
        break;
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : "Erro interno";
        if (msg.includes("idx_sched_ops_tenant_confirmation_code")) {
          continue;
        }
        throw error;
      }
    }

    if (!created) {
      throw new Error("Falha ao gerar codigo de confirmacao");
    }

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "scheduling.request.create",
      targetType: "scheduling_operation",
      targetId: created.id,
      metadata: {
        operationType: created.operation_type,
        channel: created.channel,
        expiresAt: created.expires_at
      }
    });

    return reply.status(201).send({ operation: created });
  }
);

app.get(
  "/v1/scheduling/requests",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = schedulingListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 50;
    const offset = parsed.data.offset ?? 0;
    const status = parsed.data.status ?? null;
    const operationType = parsed.data.operationType ?? null;

    const where = `
      tenant_id = $1
      AND ($2::text IS NULL OR status = $2)
      AND ($3::text IS NULL OR operation_type = $3)`;

    const itemsRes = await pool.query(
      `SELECT id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, confirmed_at, executed_at, created_at, updated_at
       FROM scheduling_operations
       WHERE ${where}
       ORDER BY created_at DESC
       LIMIT $4 OFFSET $5`,
      [auth.tenantId, status, operationType, limit, offset]
    );
    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM scheduling_operations
       WHERE ${where}`,
      [auth.tenantId, status, operationType]
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
  "/v1/scheduling/requests/:operationId",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { operationId?: string };
    const operationId = params.operationId;
    if (!operationId) {
      return reply.status(400).send({ message: "operationId obrigatorio" });
    }

    const opRes = await pool.query(
      `SELECT id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, confirmed_at, executed_at, created_at, updated_at
       FROM scheduling_operations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, operationId]
    );
    if (!opRes.rowCount) {
      return reply.status(404).send({ message: "Operacao nao encontrada" });
    }

    return { operation: opRes.rows[0] };
  }
);

app.post(
  "/v1/scheduling/requests/:operationId/confirm",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { operationId?: string };
    const operationId = params.operationId;
    if (!operationId) {
      return reply.status(400).send({ message: "operationId obrigatorio" });
    }
    const parsed = schedulingConfirmSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }

    const opRes = await pool.query<{
      id: string;
      status:
        | "pending_confirmation"
        | "confirmed"
        | "executed"
        | "cancelled"
        | "expired"
        | "rejected";
      confirmation_phrase: string;
      expires_at: string;
    }>(
      `SELECT id, status, confirmation_phrase, expires_at
       FROM scheduling_operations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, operationId]
    );
    if (!opRes.rowCount) {
      return reply.status(404).send({ message: "Operacao nao encontrada" });
    }
    const operation = opRes.rows[0];

    if (operation.status !== "pending_confirmation") {
      return reply.status(409).send({ message: "Operacao nao esta pendente de confirmacao" });
    }

    if (new Date(operation.expires_at).getTime() < Date.now()) {
      await pool.query(
        `UPDATE scheduling_operations
         SET status = 'expired',
             result_json = result_json || $3::jsonb,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [
          auth.tenantId,
          operation.id,
          JSON.stringify({ expiredAt: new Date().toISOString() })
        ]
      );
      return reply.status(409).send({ message: "Codigo expirado. Solicite nova operacao." });
    }

    const providedText = parsed.data.confirmationText.trim().toUpperCase();
    const expectedText = operation.confirmation_phrase.trim().toUpperCase();
    if (providedText !== expectedText) {
      return reply.status(400).send({ message: "Texto de confirmacao invalido" });
    }

    const updatedRes = await pool.query(
      `UPDATE scheduling_operations
       SET status = 'executed',
           confirmed_by = $3,
           confirmed_at = NOW(),
           executed_at = NOW(),
           result_json = result_json || $4::jsonb,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, confirmed_at, executed_at, created_at, updated_at`,
      [
        auth.tenantId,
        operation.id,
        auth.userId,
        JSON.stringify({
          confirmedBy: auth.userId,
          executedAt: new Date().toISOString(),
          deterministicFlow: true
        })
      ]
    );
    const updated = updatedRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "scheduling.request.confirm_execute",
      targetType: "scheduling_operation",
      targetId: operation.id,
      metadata: {
        status: updated.status
      }
    });

    return { operation: updated };
  }
);

app.post(
  "/v1/scheduling/requests/:operationId/reject",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { operationId?: string };
    const operationId = params.operationId;
    if (!operationId) {
      return reply.status(400).send({ message: "operationId obrigatorio" });
    }
    const parsed = schedulingRejectSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }

    const opRes = await pool.query<{
      id: string;
      status:
        | "pending_confirmation"
        | "confirmed"
        | "executed"
        | "cancelled"
        | "expired"
        | "rejected";
    }>(
      `SELECT id, status
       FROM scheduling_operations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, operationId]
    );
    if (!opRes.rowCount) {
      return reply.status(404).send({ message: "Operacao nao encontrada" });
    }
    if (opRes.rows[0].status !== "pending_confirmation") {
      return reply.status(409).send({ message: "Operacao nao pode ser rejeitada neste status" });
    }

    const updatedRes = await pool.query(
      `UPDATE scheduling_operations
       SET status = 'rejected',
           result_json = result_json || $3::jsonb,
           updated_at = NOW()
       WHERE tenant_id = $1 AND id = $2
       RETURNING id, contact_id, case_id, operation_type, channel, requested_start_at, requested_end_at, timezone, note, status, confirmation_code, confirmation_phrase, expires_at, payload_json, result_json, confirmed_at, executed_at, created_at, updated_at`,
      [
        auth.tenantId,
        operationId,
        JSON.stringify({ rejectedBy: auth.userId, reason: parsed.data.reason ?? null })
      ]
    );
    const updated = updatedRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "scheduling.request.reject",
      targetType: "scheduling_operation",
      targetId: operationId,
      metadata: {
        reason: parsed.data.reason ?? null
      }
    });

    return { operation: updated };
  }
);

app.post(
  "/v1/scheduling/expire-pending",
  {
    preHandler: [authenticate, ensureTenantScope(), requireRoles(["owner", "manager"])]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = schedulingExpireSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const dryRun = parsed.data.dryRun ?? false;
    const limit = parsed.data.limit ?? 500;

    const candidatesRes = await pool.query<{ id: string; expires_at: string }>(
      `SELECT id, expires_at
       FROM scheduling_operations
       WHERE tenant_id = $1
         AND status = 'pending_confirmation'
         AND expires_at < NOW()
       ORDER BY expires_at ASC
       LIMIT $2`,
      [auth.tenantId, limit]
    );

    if (dryRun) {
      return {
        dryRun: true,
        matched: candidatesRes.rowCount ?? 0,
        operationIds: candidatesRes.rows.map((r) => r.id)
      };
    }

    if (!candidatesRes.rowCount) {
      return { expired: 0, operationIds: [] };
    }

    const ids = candidatesRes.rows.map((r) => r.id);
    const updateRes = await pool.query<{ id: string }>(
      `UPDATE scheduling_operations
       SET status = 'expired',
           result_json = result_json || $3::jsonb,
           updated_at = NOW()
       WHERE tenant_id = $1
         AND id = ANY($2::uuid[])
         AND status = 'pending_confirmation'
       RETURNING id`,
      [
        auth.tenantId,
        ids,
        JSON.stringify({
          expiredBySweep: true,
          expiredByUserId: auth.userId,
          expiredAt: new Date().toISOString()
        })
      ]
    );

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "scheduling.request.expire_sweep",
      targetType: "scheduling_operation",
      targetId: "batch",
      metadata: {
        expiredCount: updateRes.rowCount ?? 0
      }
    });

    return {
      expired: updateRes.rowCount ?? 0,
      operationIds: updateRes.rows.map((r) => r.id)
    };
  }
);

app.get(
  "/v1/ai/conversations/:conversationId/context",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const queryParsed = aiContextQuerySchema.safeParse(request.query ?? {});
    if (!queryParsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: queryParsed.error.issues
      });
    }
    const messageLimit = queryParsed.data.messageLimit ?? 30;

    const conversationRes = await pool.query(
      `SELECT c.id, c.contact_id, ct.full_name AS contact_name, ct.email AS contact_email, ct.phone AS contact_phone, c.channel, c.external_thread_id, c.status, c.last_message_at, c.created_at, c.updated_at
       FROM conversations c
       LEFT JOIN contacts ct ON ct.id = c.contact_id
       WHERE c.tenant_id = $1 AND c.id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }
    const conversation = conversationRes.rows[0];

    const latestMemoryRes = await pool.query(
      `SELECT id, summary_text, key_facts_json, open_tasks_json, risk_flags_json, intent, sentiment, confidence, metadata_json, created_at
       FROM ai_conversation_memory_snapshots
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );

    const messagesRes = await pool.query(
      `SELECT id, direction, sender_type, source_channel, external_message_id, message_text, metadata_json, occurred_at, created_at
       FROM conversation_messages
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY occurred_at DESC
       LIMIT $3`,
      [auth.tenantId, conversationId, messageLimit]
    );

    const recentMessages = messagesRes.rows.reverse();

    return {
      conversation,
      latestMemory: latestMemoryRes.rows[0] ?? null,
      recentMessages,
      messageLimit
    };
  }
);

app.get(
  "/v1/ai/conversations/:conversationId/memory/snapshots",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const parsed = aiMemoryListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 20;

    const conversationRes = await pool.query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }

    const snapshotsRes = await pool.query(
      `SELECT id, summary_text, key_facts_json, open_tasks_json, risk_flags_json, intent, sentiment, confidence, metadata_json, created_at
       FROM ai_conversation_memory_snapshots
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [auth.tenantId, conversationId, limit]
    );
    return {
      snapshots: snapshotsRes.rows,
      limit
    };
  }
);

app.post(
  "/v1/ai/conversations/:conversationId/memory/snapshots",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const parsed = aiMemorySnapshotCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const conversationRes = await pool.query<{ id: string; contact_id: string | null }>(
      `SELECT id, contact_id
       FROM conversations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }
    const conversation = conversationRes.rows[0];

    const snapshotRes = await pool.query(
      `INSERT INTO ai_conversation_memory_snapshots
       (tenant_id, conversation_id, contact_id, summary_text, key_facts_json, open_tasks_json, risk_flags_json, intent, sentiment, confidence, metadata_json, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6::jsonb, $7::jsonb, $8, $9, $10, $11::jsonb, $12)
       RETURNING id, summary_text, key_facts_json, open_tasks_json, risk_flags_json, intent, sentiment, confidence, metadata_json, created_at`,
      [
        auth.tenantId,
        conversation.id,
        conversation.contact_id,
        data.summaryText,
        JSON.stringify(data.keyFacts ?? []),
        JSON.stringify(data.openTasks ?? []),
        JSON.stringify(data.riskFlags ?? []),
        data.intent ?? null,
        data.sentiment ?? null,
        data.confidence ?? 0.5,
        JSON.stringify(data.metadata ?? {}),
        auth.userId
      ]
    );
    const snapshot = snapshotRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "ai.memory.snapshot.create",
      targetType: "conversation",
      targetId: conversation.id,
      metadata: {
        snapshotId: snapshot.id,
        sentiment: snapshot.sentiment,
        confidence: snapshot.confidence
      }
    });

    return reply.status(201).send({ snapshot });
  }
);

app.get(
  "/v1/ai/conversations/:conversationId/generations",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const parsed = aiMemoryListSchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const limit = parsed.data.limit ?? 20;

    const conversationRes = await pool.query(
      `SELECT id FROM conversations WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }

    const logsRes = await pool.query(
      `SELECT id, provider, model, used_fallback, memory_snapshot_id, output_text, finish_reason, latency_ms, metadata_json, output_message_id, created_at
       FROM ai_generation_logs
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [auth.tenantId, conversationId, limit]
    );

    return {
      generations: logsRes.rows,
      limit
    };
  }
);

app.post(
  "/v1/ai/conversations/:conversationId/respond",
  {
    preHandler: [
      authenticate,
      ensureTenantScope(),
      requireRoles(["owner", "manager", "agent"])
    ]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const params = request.params as { conversationId?: string };
    const conversationId = params.conversationId;
    if (!conversationId) {
      return reply.status(400).send({ message: "conversationId obrigatorio" });
    }

    const parsed = aiRespondSchema.safeParse(request.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Payload invalido",
        issues: parsed.error.issues
      });
    }
    const data = parsed.data;

    const conversationRes = await pool.query<{
      id: string;
      contact_id: string | null;
      channel: "whatsapp" | "email" | "webchat" | "manual";
    }>(
      `SELECT id, contact_id, channel
       FROM conversations
       WHERE tenant_id = $1 AND id = $2
       LIMIT 1`,
      [auth.tenantId, conversationId]
    );
    if (!conversationRes.rowCount) {
      return reply.status(404).send({ message: "Conversa nao encontrada" });
    }
    const conversation = conversationRes.rows[0];

    const nowIso = new Date().toISOString();
    if (data.userMessage) {
      await pool.query(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, 'inbound', 'client', $5, '[]'::jsonb, $6::jsonb, $7, $8)`,
        [
          auth.tenantId,
          conversation.id,
          conversation.contact_id,
          conversation.channel,
          data.userMessage,
          JSON.stringify({ origin: "ai.respond.userMessage", ...(data.metadata ?? {}) }),
          nowIso,
          auth.userId
        ]
      );
    }

    const memoryRes = await pool.query<{
      id: string;
      summary_text: string;
      key_facts_json: string[];
      open_tasks_json: string[];
      risk_flags_json: string[];
      intent: string | null;
    }>(
      `SELECT id, summary_text, key_facts_json, open_tasks_json, risk_flags_json, intent
       FROM ai_conversation_memory_snapshots
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY created_at DESC
       LIMIT 1`,
      [auth.tenantId, conversation.id]
    );
    const latestMemory = memoryRes.rows[0] ?? null;

    const historyRes = await pool.query<{
      direction: "inbound" | "outbound" | "system";
      sender_type: "client" | "agent" | "ai" | "system";
      message_text: string;
      occurred_at: string;
    }>(
      `SELECT direction, sender_type, message_text, occurred_at
       FROM conversation_messages
       WHERE tenant_id = $1 AND conversation_id = $2
       ORDER BY occurred_at DESC
       LIMIT 30`,
      [auth.tenantId, conversation.id]
    );

    const historyForAi = historyRes.rows
      .reverse()
      .map((row) => {
        const role: "user" | "assistant" =
          row.sender_type === "client" || row.direction === "inbound"
            ? "user"
            : "assistant";
        return {
          role,
          text: row.message_text
        };
      })
      .filter((item) => item.text.trim().length > 0);

    const systemSections = [
      "Voce e assistente virtual de um escritorio juridico brasileiro.",
      "Nunca invente fatos. Se faltar dado, diga que precisa confirmar com a equipe.",
      "Se houver pedido de agendamento, oriente uso do fluxo deterministico de confirmacao.",
      "Responda em portugues brasileiro de forma objetiva e cordial."
    ];
    if (latestMemory) {
      systemSections.push(`Resumo de contexto: ${latestMemory.summary_text}`);
      if (Array.isArray(latestMemory.key_facts_json) && latestMemory.key_facts_json.length) {
        systemSections.push(`Fatos-chave: ${latestMemory.key_facts_json.join(" | ")}`);
      }
      if (Array.isArray(latestMemory.open_tasks_json) && latestMemory.open_tasks_json.length) {
        systemSections.push(`Pendencias: ${latestMemory.open_tasks_json.join(" | ")}`);
      }
      if (Array.isArray(latestMemory.risk_flags_json) && latestMemory.risk_flags_json.length) {
        systemSections.push(`Alertas: ${latestMemory.risk_flags_json.join(" | ")}`);
      }
      if (latestMemory.intent) {
        systemSections.push(`Intencao principal: ${latestMemory.intent}`);
      }
    }
    if (data.systemInstruction) {
      systemSections.push(`Instrucao operacional: ${data.systemInstruction}`);
    }
    const systemInstruction = systemSections.join("\n");

    const aiResult = await generateAiReply({
      systemInstruction,
      history: historyForAi,
      model: data.model,
      temperature: data.temperature,
      maxOutputTokens: data.maxOutputTokens,
      userMessage: data.userMessage
    });

    const saveAsMessage = data.saveAsMessage ?? true;
    let outputMessageId: string | null = null;

    if (saveAsMessage) {
      const outputMessageRes = await pool.query<{ id: string }>(
        `INSERT INTO conversation_messages
         (tenant_id, conversation_id, contact_id, source_channel, direction, sender_type, message_text, attachments_json, metadata_json, occurred_at, created_by)
         VALUES ($1, $2, $3, $4, 'outbound', 'ai', $5, '[]'::jsonb, $6::jsonb, $7, $8)
         RETURNING id`,
        [
          auth.tenantId,
          conversation.id,
          conversation.contact_id,
          conversation.channel,
          aiResult.text,
          JSON.stringify({
            provider: aiResult.provider,
            model: aiResult.model,
            usedFallback: aiResult.usedFallback
          }),
          new Date().toISOString(),
          auth.userId
        ]
      );
      outputMessageId = outputMessageRes.rows[0].id;

      await pool.query(
        `UPDATE conversations
         SET status = 'open',
             last_message_at = NOW(),
             updated_by = $3,
             updated_at = NOW()
         WHERE tenant_id = $1 AND id = $2`,
        [auth.tenantId, conversation.id, auth.userId]
      );
    }

    const generationRes = await pool.query(
      `INSERT INTO ai_generation_logs
       (tenant_id, conversation_id, contact_id, provider, model, used_fallback, input_messages_json, memory_snapshot_id, output_text, finish_reason, latency_ms, metadata_json, output_message_id, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, $10, $11, $12::jsonb, $13, $14)
       RETURNING id, provider, model, used_fallback, output_text, finish_reason, latency_ms, output_message_id, created_at`,
      [
        auth.tenantId,
        conversation.id,
        conversation.contact_id,
        aiResult.provider,
        aiResult.model,
        aiResult.usedFallback,
        JSON.stringify(historyForAi),
        latestMemory?.id ?? null,
        aiResult.text,
        aiResult.finishReason ?? null,
        aiResult.latencyMs ?? null,
        JSON.stringify({
          openAiError: aiResult.error ?? null,
          hasApiKey: Boolean(openAiApiKey),
          metadata: data.metadata ?? {},
          responsePayload: aiResult.responsePayload ?? null
        }),
        outputMessageId,
        auth.userId
      ]
    );
    const generation = generationRes.rows[0];

    await writeAuditEvent({
      tenantId: auth.tenantId,
      actorUserId: auth.userId,
      action: "ai.response.generate",
      targetType: "conversation",
      targetId: conversation.id,
      metadata: {
        provider: generation.provider,
        model: generation.model,
        usedFallback: generation.used_fallback,
        generationId: generation.id
      }
    });

    return reply.status(201).send({
      replyText: aiResult.text,
      generation,
      outputMessageId
    });
  }
);

app.get(
  "/v1/dashboard/overview",
  {
    preHandler: [authenticate, ensureTenantScope(), requireRoles(["owner", "manager"])]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = dashboardOverviewQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const days = parsed.data.days ?? 30;
    const { dateFromIso, dateToIso } = getDashboardPeriodRange(days);

    const [
      contactsTotalRes,
      contactsPeriodRes,
      casesOpenRes,
      casesPeriodRes,
      messagesPeriodRes,
      conversationsOpenRes,
      schedulingStatusRes,
      aiPeriodRes,
      responseCoverageRes
    ] = await Promise.all([
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM contacts
         WHERE tenant_id = $1`,
        [auth.tenantId]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM contacts
         WHERE tenant_id = $1 AND created_at BETWEEN $2 AND $3`,
        [auth.tenantId, dateFromIso, dateToIso]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM cases
         WHERE tenant_id = $1
           AND status IN ('open', 'in_progress', 'waiting_client')`,
        [auth.tenantId]
      ),
      pool.query<{ total: string; closed: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE status = 'closed')::text AS closed
         FROM cases
         WHERE tenant_id = $1
           AND created_at BETWEEN $2 AND $3`,
        [auth.tenantId, dateFromIso, dateToIso]
      ),
      pool.query<{ total: string; inbound: string; outbound: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE direction = 'inbound')::text AS inbound,
                COUNT(*) FILTER (WHERE direction = 'outbound')::text AS outbound
         FROM conversation_messages
         WHERE tenant_id = $1
           AND occurred_at BETWEEN $2 AND $3`,
        [auth.tenantId, dateFromIso, dateToIso]
      ),
      pool.query<{ total: string }>(
        `SELECT COUNT(*)::text AS total
         FROM conversations
         WHERE tenant_id = $1
           AND status = 'open'`,
        [auth.tenantId]
      ),
      pool.query<{ status: string; total: string }>(
        `SELECT status, COUNT(*)::text AS total
         FROM scheduling_operations
         WHERE tenant_id = $1
           AND updated_at BETWEEN $2 AND $3
         GROUP BY status`,
        [auth.tenantId, dateFromIso, dateToIso]
      ),
      pool.query<{ total: string; fallback: string }>(
        `SELECT COUNT(*)::text AS total,
                COUNT(*) FILTER (WHERE used_fallback = true)::text AS fallback
         FROM ai_generation_logs
         WHERE tenant_id = $1
           AND created_at BETWEEN $2 AND $3`,
        [auth.tenantId, dateFromIso, dateToIso]
      ),
      pool.query<{ inbound_conversations: string; responded_conversations: string }>(
        `WITH inbound_conversations AS (
           SELECT DISTINCT conversation_id
           FROM conversation_messages
           WHERE tenant_id = $1
             AND direction = 'inbound'
             AND occurred_at BETWEEN $2 AND $3
         ),
         responded_conversations AS (
           SELECT DISTINCT ic.conversation_id
           FROM inbound_conversations ic
           JOIN conversation_messages m
             ON m.conversation_id = ic.conversation_id
            AND m.tenant_id = $1
            AND m.direction = 'outbound'
         )
         SELECT
           (SELECT COUNT(*)::text FROM inbound_conversations) AS inbound_conversations,
           (SELECT COUNT(*)::text FROM responded_conversations) AS responded_conversations`,
        [auth.tenantId, dateFromIso, dateToIso]
      )
    ]);

    const schedulingByStatus: Record<string, number> = {};
    for (const row of schedulingStatusRes.rows) {
      schedulingByStatus[row.status] = Number(row.total);
    }

    const aiTotal = Number(aiPeriodRes.rows[0]?.total ?? 0);
    const aiFallback = Number(aiPeriodRes.rows[0]?.fallback ?? 0);
    const inboundConversations = Number(
      responseCoverageRes.rows[0]?.inbound_conversations ?? 0
    );
    const respondedConversations = Number(
      responseCoverageRes.rows[0]?.responded_conversations ?? 0
    );

    return {
      period: {
        days,
        dateFrom: dateFromIso,
        dateTo: dateToIso
      },
      contacts: {
        total: Number(contactsTotalRes.rows[0]?.total ?? 0),
        newInPeriod: Number(contactsPeriodRes.rows[0]?.total ?? 0)
      },
      cases: {
        openNow: Number(casesOpenRes.rows[0]?.total ?? 0),
        createdInPeriod: Number(casesPeriodRes.rows[0]?.total ?? 0),
        closedInPeriod: Number(casesPeriodRes.rows[0]?.closed ?? 0)
      },
      inbox: {
        conversationsOpenNow: Number(conversationsOpenRes.rows[0]?.total ?? 0),
        messagesInPeriod: Number(messagesPeriodRes.rows[0]?.total ?? 0),
        inboundInPeriod: Number(messagesPeriodRes.rows[0]?.inbound ?? 0),
        outboundInPeriod: Number(messagesPeriodRes.rows[0]?.outbound ?? 0),
        responseCoveragePercent:
          inboundConversations === 0
            ? 100
            : Math.round((respondedConversations / inboundConversations) * 10000) /
              100
      },
      scheduling: {
        byStatus: schedulingByStatus,
        pendingNow: Number(schedulingByStatus.pending_confirmation ?? 0),
        executedInPeriod: Number(schedulingByStatus.executed ?? 0),
        rejectedInPeriod: Number(schedulingByStatus.rejected ?? 0),
        expiredInPeriod: Number(schedulingByStatus.expired ?? 0)
      },
      ai: {
        generationsInPeriod: aiTotal,
        fallbackInPeriod: aiFallback,
        fallbackRatePercent:
          aiTotal === 0 ? 0 : Math.round((aiFallback / aiTotal) * 10000) / 100
      }
    };
  }
);

app.get(
  "/v1/dashboard/channels",
  {
    preHandler: [authenticate, ensureTenantScope(), requireRoles(["owner", "manager"])]
  },
  async (request, reply) => {
    const auth = getAuthUser(request);
    const parsed = dashboardOverviewQuerySchema.safeParse(request.query ?? {});
    if (!parsed.success) {
      return reply.status(400).send({
        message: "Query invalida",
        issues: parsed.error.issues
      });
    }
    const days = parsed.data.days ?? 30;
    const { dateFromIso, dateToIso } = getDashboardPeriodRange(days);

    const messagesByChannelRes = await pool.query<{ channel: string; total: string }>(
      `SELECT source_channel AS channel, COUNT(*)::text AS total
       FROM conversation_messages
       WHERE tenant_id = $1
         AND occurred_at BETWEEN $2 AND $3
       GROUP BY source_channel
       ORDER BY COUNT(*) DESC`,
      [auth.tenantId, dateFromIso, dateToIso]
    );

    const conversationsByChannelRes = await pool.query<{
      channel: string;
      total: string;
      open_total: string;
    }>(
      `SELECT channel,
              COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE status = 'open')::text AS open_total
       FROM conversations
       WHERE tenant_id = $1
       GROUP BY channel
       ORDER BY COUNT(*) DESC`,
      [auth.tenantId]
    );

    return {
      period: {
        days,
        dateFrom: dateFromIso,
        dateTo: dateToIso
      },
      messagesByChannel: messagesByChannelRes.rows.map((row) => ({
        channel: row.channel,
        total: Number(row.total)
      })),
      conversationsByChannel: conversationsByChannelRes.rows.map((row) => ({
        channel: row.channel,
        total: Number(row.total),
        openTotal: Number(row.open_total)
      }))
    };
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

    const totalRes = await pool.query<{ total: string }>(
      `SELECT COUNT(*)::text AS total
       FROM audit_events
       WHERE tenant_id = $1`,
      [auth.tenantId]
    );

    return { events: auditRes.rows, total: Number(totalRes.rows[0].total), limit };
  }
);

app.setErrorHandler((error, _request, reply) => {
  app.log.error(error);
  if (!reply.sent) {
    const maybeStatus =
      typeof (error as { statusCode?: unknown }).statusCode === "number"
        ? Number((error as { statusCode: number }).statusCode)
        : 500;
    const statusCode =
      maybeStatus >= 400 && maybeStatus <= 599 ? maybeStatus : 500;
    const errorMessage =
      error instanceof Error
        ? error.message
        : typeof error === "object" &&
            error !== null &&
            "message" in error &&
            typeof (error as { message: unknown }).message === "string"
          ? (error as { message: string }).message
          : null;
    const message =
      statusCode >= 500
        ? "Erro interno"
        : errorMessage || "Erro de requisicao";
    reply.status(statusCode).send({ message });
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
