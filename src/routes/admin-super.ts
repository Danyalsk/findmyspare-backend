import { Elysia, t } from "elysia";
import { eq, and, desc, sql, gte, inArray, isNotNull, isNull, gt } from "drizzle-orm";
import { db } from "../db";
import {
  users,
  sessions,
  adminActions,
  rejectionReasons,
  platformConfig,
  flaggedContent,
  messages,
  inquiries,
  products,
} from "../db/schema";
import { requireAdmin, requireSuperAdmin, jwtPlugin } from "../middleware/auth";
import { logAdminAction } from "../lib/audit";
import { sendSupplierStatusEmail } from "../lib/email";
import { paginate } from "../lib/pagination";
import { isGstApiConfigured } from "../lib/sandbox-gst";
import { isWhatsAppConfigured } from "../lib/whatsapp-otp";

// Mask a secret: never expose the value, just confirm it's set + a hint.
function mask(v: string | undefined): { set: boolean; hint: string } {
  if (!v) return { set: false, hint: "— not set —" };
  if (v.length <= 8) return { set: true, hint: "••••" };
  return { set: true, hint: `${v.slice(0, 3)}…${v.slice(-3)} (${v.length} chars)` };
}
function shown(v: string | undefined): { set: boolean; value: string } {
  return { set: Boolean(v), value: v || "— not set —" };
}
function dbHost(url: string | undefined): string {
  if (!url) return "— not set —";
  const m = url.match(/@([^/:]+)/);
  return m ? m[1]! : "set";
}

// New super-admin and ops-admin endpoints. Older admin.ts is left intact for
// existing pages; this module adds the operational surface needed for live
// supplier launch.
export const adminSuperRoutes = new Elysia({ prefix: "/admin" })
  .use(jwtPlugin)
  .use(requireAdmin)

  // ─── Audit log ──────────────────────────────────────
  .get(
    "/audit-log",
    async ({ query }) => {
      const { actorId, targetId, action, page = "1", limit = "50" } = query;
      const { pageNum, limitNum, offset } = paginate(page, limit);
      const conditions = [] as Array<ReturnType<typeof eq>>;
      if (actorId) conditions.push(eq(adminActions.actorId, actorId));
      if (targetId) conditions.push(eq(adminActions.targetId, targetId));
      if (action) conditions.push(eq(adminActions.action, action as never));

      const where = conditions.length ? and(...conditions) : undefined;

      const items = await db
        .select({
          id: adminActions.id,
          actorId: adminActions.actorId,
          actorName: users.name,
          actorEmail: users.email,
          action: adminActions.action,
          targetType: adminActions.targetType,
          targetId: adminActions.targetId,
          metadata: adminActions.metadata,
          ipAddress: adminActions.ipAddress,
          userAgent: adminActions.userAgent,
          createdAt: adminActions.createdAt,
        })
        .from(adminActions)
        .leftJoin(users, eq(adminActions.actorId, users.id))
        .where(where)
        .orderBy(desc(adminActions.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(adminActions)
        .where(where);

      return {
        items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        actorId: t.Optional(t.String()),
        targetId: t.Optional(t.String()),
        action: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List audit log entries", tags: ["Admin"] },
    }
  )

  // ─── Metrics ────────────────────────────────────────
  .get(
    "/metrics",
    async ({ query }) => {
      const rangeDays = query.range === "30d" ? 30 : query.range === "90d" ? 90 : 7;
      const from = new Date();
      from.setDate(from.getDate() - rangeDays);

      const series = await db.execute(sql`
        WITH days AS (
          SELECT generate_series(
            date_trunc('day', ${from}::timestamp),
            date_trunc('day', now()),
            interval '1 day'
          )::date AS d
        )
        SELECT
          days.d::text AS day,
          (SELECT count(*)::int FROM users WHERE date_trunc('day', users.created_at) = days.d AND users.role = 'buyer') AS "buyerSignups",
          (SELECT count(*)::int FROM users WHERE date_trunc('day', users.created_at) = days.d AND users.role = 'supplier') AS "supplierSignups",
          (SELECT count(*)::int FROM inquiries WHERE date_trunc('day', inquiries.created_at) = days.d) AS "inquiries",
          (SELECT count(*)::int FROM bids WHERE date_trunc('day', bids.created_at) = days.d) AS "bids",
          (SELECT count(*)::int FROM messages WHERE date_trunc('day', messages.created_at) = days.d) AS "messages"
        FROM days
        ORDER BY days.d ASC
      `);

      return { series };
    },
    {
      query: t.Object({ range: t.Optional(t.String()) }),
      detail: { summary: "Daily platform metrics", tags: ["Admin"] },
    }
  )

  // ─── Health ─────────────────────────────────────────
  .get(
    "/health",
    async () => {
      const [{ activeUsers }] = await db
        .select({ activeUsers: sql<number>`count(*)::int` })
        .from(sessions)
        .where(and(isNull(sessions.revokedAt), gt(sessions.expiresAt, new Date())));

      let dbOk = true;
      let dbError: string | null = null;
      try {
        await db.execute(sql`SELECT 1`);
      } catch (e) {
        dbOk = false;
        dbError = e instanceof Error ? e.message : String(e);
      }

      return {
        db: { ok: dbOk, error: dbError },
        activeSessions: activeUsers,
        uptime: process.uptime(),
        timestamp: new Date().toISOString(),
      };
    },
    { detail: { summary: "Admin-side system health", tags: ["Admin"] } }
  )

  // ─── Platform config ────────────────────────────────
  .get(
    "/config",
    async () => {
      const [cfg] = await db.select().from(platformConfig).limit(1);
      if (!cfg) {
        // Lazy-create the singleton row on first read.
        const [created] = await db.insert(platformConfig).values({ id: 1 }).returning();
        return { config: created };
      }
      return { config: cfg };
    },
    { detail: { summary: "Read platform configuration", tags: ["Admin"] } }
  )

  // ─── Rejection reason templates ─────────────────────
  .get("/rejection-reasons", async () => {
    const items = await db
      .select()
      .from(rejectionReasons)
      .where(eq(rejectionReasons.isActive, true))
      .orderBy(rejectionReasons.sortOrder);
    return { items };
  })

  // ─── Supplier: request more info ────────────────────
  .post(
    "/suppliers/:id/request-info",
    async ({ params, body, user, request, set }) => {
      const [target] = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target || target.role !== "supplier") {
        set.status = 404;
        return { error: "Supplier not found" };
      }

      await db
        .update(users)
        .set({
          verificationStatus: "pending",
          rejectionReason: body.note,
          updatedAt: new Date(),
        })
        .where(eq(users.id, params.id));

      if (target.email)
        sendSupplierStatusEmail(target.email, target.name ?? "there", "info_requested", body.note).catch(
          (e) => console.error("[admin] info-requested email failed:", e)
        );
      logAdminAction(
        { actorId: user.id, request },
        "supplier_request_info",
        { type: "user", id: params.id },
        { note: body.note }
      );
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ note: t.String({ minLength: 5 }) }),
      detail: { summary: "Ask the supplier for more KYC info", tags: ["Admin"] },
    }
  )

  // ─── User: ban (with reason + expiry) ───────────────
  .post(
    "/users/:id/ban",
    async ({ params, body, user, request, set }) => {
      const [target] = await db
        .select({ id: users.id, name: users.name, email: users.email, role: users.role })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { error: "User not found" };
      }
      if (target.role === "admin" || target.role === "super_admin") {
        set.status = 403;
        return { error: "Cannot ban another admin from this endpoint" };
      }

      const expiresAt = body.expiresAt ? new Date(body.expiresAt) : null;
      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({
            isActive: false,
            banReason: body.reason,
            banExpiresAt: expiresAt,
            updatedAt: new Date(),
          })
          .where(eq(users.id, params.id));
        // Revoke all live sessions immediately.
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, params.id), isNull(sessions.revokedAt)));
      });
      logAdminAction(
        { actorId: user.id, request },
        "user_ban",
        { type: "user", id: params.id },
        { reason: body.reason, expiresAt: body.expiresAt }
      );
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        reason: t.String({ minLength: 5 }),
        expiresAt: t.Optional(t.String()),
      }),
      detail: { summary: "Ban a user (revokes sessions)", tags: ["Admin"] },
    }
  )

  .post(
    "/users/:id/unban",
    async ({ params, user, request, set }) => {
      const [target] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { error: "User not found" };
      }
      await db
        .update(users)
        .set({
          isActive: true,
          banReason: null,
          banExpiresAt: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, params.id));
      logAdminAction({ actorId: user.id, request }, "user_unban", {
        type: "user",
        id: params.id,
      });
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Unban a user", tags: ["Admin"] },
    }
  )

  // ─── Moderation: flagged content ────────────────────
  .get(
    "/flags",
    async ({ query }) => {
      const status = query.status ?? "open";
      const { pageNum, limitNum, offset } = paginate(query.page, query.limit);
      const items = await db
        .select()
        .from(flaggedContent)
        .where(eq(flaggedContent.status, status as never))
        .orderBy(desc(flaggedContent.createdAt))
        .limit(limitNum)
        .offset(offset);
      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(flaggedContent)
        .where(eq(flaggedContent.status, status as never));
      return {
        items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List flagged content", tags: ["Admin"] },
    }
  )

  .post(
    "/flags/:id/action",
    async ({ params, body, user, request, set }) => {
      const [row] = await db
        .select()
        .from(flaggedContent)
        .where(eq(flaggedContent.id, params.id))
        .limit(1);
      if (!row) {
        set.status = 404;
        return { error: "Flag not found" };
      }

      await db
        .update(flaggedContent)
        .set({
          status: body.action === "dismiss" ? "dismissed" : "actioned",
          reviewerId: user.id,
          reviewedAt: new Date(),
          actionNotes: body.notes ?? null,
        })
        .where(eq(flaggedContent.id, params.id));

      // If the action is "hide", soft-hide the underlying content where possible.
      if (body.action === "hide") {
        if (row.contentType === "message") {
          await db
            .update(messages)
            .set({ content: "[removed by admin]" })
            .where(eq(messages.id, row.contentId));
          logAdminAction({ actorId: user.id, request }, "message_hide", {
            type: "message",
            id: row.contentId,
          });
        } else if (row.contentType === "inquiry") {
          await db
            .update(inquiries)
            .set({ isActive: false })
            .where(eq(inquiries.id, row.contentId));
          logAdminAction({ actorId: user.id, request }, "inquiry_hide", {
            type: "inquiry",
            id: row.contentId,
          });
        } else if (row.contentType === "product") {
          await db
            .update(products)
            .set({ status: "paused" })
            .where(eq(products.id, row.contentId));
          logAdminAction({ actorId: user.id, request }, "product_hide", {
            type: "product",
            id: row.contentId,
          });
        }
      }

      logAdminAction({ actorId: user.id, request }, "flag_action", {
        type: "flag",
        id: params.id,
      }, { action: body.action });

      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        action: t.Union([t.Literal("hide"), t.Literal("dismiss")]),
        notes: t.Optional(t.String()),
      }),
      detail: { summary: "Take an action on a flagged item", tags: ["Admin"] },
    }
  )

  // Routes below this point require super_admin specifically.
  .use(requireSuperAdmin)

  // ─── Runbook: ops/config snapshot (super_admin only) ─
  // A "Swagger for everything" — env presence (masked), service URLs,
  // integration status, deploy + runtime info. Secrets never exposed.
  .get(
    "/runbook",
    async () => {
      const env = process.env;
      let dbOk = true;
      let dbError: string | null = null;
      try {
        await db.execute(sql`SELECT 1`);
      } catch (e) {
        dbOk = false;
        dbError = e instanceof Error ? e.message : String(e);
      }

      return {
        runtime: {
          nodeEnv: env.NODE_ENV || "development",
          port: env.PORT || "8000",
          uptimeSeconds: Math.round(process.uptime()),
          bunVersion: typeof Bun !== "undefined" ? Bun.version : "n/a",
          timestamp: new Date().toISOString(),
        },
        integrations: {
          database: { status: dbOk ? "connected" : "error", host: dbHost(env.DATABASE_URL), error: dbError },
          email_resend: { configured: Boolean(env.RESEND_API_KEY), from: env.RESEND_FROM || "— not set —" },
          gst_rapidapi: { configured: isGstApiConfigured(), host: env.RAPIDAPI_GST_HOST || "— not set —" },
          storage_blob: {
            configured: Boolean(env.BLOB_READ_WRITE_TOKEN),
            provider: "Vercel Blob",
          },
          whatsapp_otp: { configured: isWhatsAppConfigured(), note: "dormant in v1 (email OTP only)" },
        },
        env: {
          server: {
            NODE_ENV: shown(env.NODE_ENV),
            PORT: shown(env.PORT),
            FRONTEND_URL: shown(env.FRONTEND_URL),
            PROD_EXTRA_ORIGINS: shown(env.PROD_EXTRA_ORIGINS),
          },
          database: {
            DATABASE_URL: { set: Boolean(env.DATABASE_URL), hint: dbHost(env.DATABASE_URL) },
          },
          auth: {
            JWT_SECRET: mask(env.JWT_SECRET),
            JWT_ACCESS_TTL: shown(env.JWT_ACCESS_TTL),
            JWT_REFRESH_TTL: shown(env.JWT_REFRESH_TTL),
          },
          email: {
            RESEND_API_KEY: mask(env.RESEND_API_KEY),
            RESEND_FROM: shown(env.RESEND_FROM),
          },
          gst: {
            RAPIDAPI_KEY: mask(env.RAPIDAPI_KEY),
            RAPIDAPI_GST_HOST: shown(env.RAPIDAPI_GST_HOST),
            RAPIDAPI_GST_URL: shown(env.RAPIDAPI_GST_URL),
            RAPIDAPI_GST_METHOD: shown(env.RAPIDAPI_GST_METHOD),
          },
          storage: {
            BLOB_READ_WRITE_TOKEN: mask(env.BLOB_READ_WRITE_TOKEN),
          },
          whatsapp: {
            WHATSAPP_TOKEN: mask(env.WHATSAPP_TOKEN),
            WHATSAPP_PHONE_NUMBER_ID: shown(env.WHATSAPP_PHONE_NUMBER_ID),
            WHATSAPP_OTP_TEMPLATE: shown(env.WHATSAPP_OTP_TEMPLATE),
          },
        },
      };
    },
    { detail: { summary: "Ops runbook — config + integration snapshot", tags: ["Admin"] } }
  )

  .delete(
    "/users/:id",
    async ({ params, user, request, set }) => {
      const [target] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target) {
        set.status = 404;
        return { error: "User not found" };
      }
      if (target.id === user.id) {
        set.status = 400;
        return { error: "You cannot delete your own account from this endpoint" };
      }
      if (target.role === "super_admin") {
        set.status = 403;
        return { error: "Cannot delete a super admin account" };
      }

      await db.transaction(async (tx) => {
        await tx
          .update(users)
          .set({ deletedAt: new Date(), isActive: false, updatedAt: new Date() })
          .where(eq(users.id, params.id));
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, params.id), isNull(sessions.revokedAt)));
      });
      logAdminAction({ actorId: user.id, request }, "user_delete", {
        type: "user",
        id: params.id,
      });
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Soft-delete a user (super_admin only)", tags: ["Admin"] },
    }
  )

  .post(
    "/users/:id/impersonate",
    async ({ params, user, jwt, request, set }) => {
      const [target] = await db
        .select({ id: users.id, email: users.email, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, params.id))
        .limit(1);
      if (!target || !target.isActive) {
        set.status = 404;
        return { error: "User not found or inactive" };
      }
      if (target.role === "super_admin") {
        set.status = 403;
        return { error: "Cannot impersonate a super admin" };
      }

      // Short-lived impersonation token (5 minutes). Carries `impersonatedBy`
      // claim so audit hooks can attribute downstream actions.
      const accessToken = await jwt.sign({
        sub: target.id,
        email: target.email,
        role: target.role,
        impersonatedBy: user.id,
        exp: Math.floor(Date.now() / 1000) + 300,
      });
      logAdminAction({ actorId: user.id, request }, "user_impersonate", {
        type: "user",
        id: target.id,
      });
      return { accessToken, expiresInSeconds: 300 };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Mint a short-lived impersonation token (super_admin only)", tags: ["Admin"] },
    }
  )

  .patch(
    "/config",
    async ({ body, user, request }) => {
      // Upsert the singleton row.
      const existing = await db.select().from(platformConfig).limit(1);
      if (existing.length === 0) {
        await db.insert(platformConfig).values({ id: 1, ...body, updatedBy: user.id });
      } else {
        await db
          .update(platformConfig)
          .set({ ...body, updatedBy: user.id, updatedAt: new Date() })
          .where(eq(platformConfig.id, 1));
      }
      logAdminAction({ actorId: user.id, request }, "config_update", {
        type: "config",
      }, body);
      return { ok: true };
    },
    {
      body: t.Partial(
        t.Object({
          maintenanceMode: t.Boolean(),
          waitlistOnly: t.Boolean(),
          signupsOpen: t.Boolean(),
          bannerText: t.String(),
        })
      ),
      detail: { summary: "Update platform configuration (super_admin only)", tags: ["Admin"] },
    }
  )

  // ─── CSV exports ────────────────────────────────────
  .get(
    "/export/users.csv",
    async ({ set }) => {
      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          phone: users.phone,
          businessName: users.businessName,
          verificationStatus: users.verificationStatus,
          isActive: users.isActive,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(isNull(users.deletedAt));
      const header = "id,email,name,role,phone,businessName,verificationStatus,isActive,createdAt";
      const csv = [
        header,
        ...rows.map((r) =>
          [
            r.id,
            r.email ?? "",
            csvEscape(r.name ?? ""),
            r.role,
            r.phone ?? "",
            csvEscape(r.businessName ?? ""),
            r.verificationStatus,
            r.isActive ? "true" : "false",
            r.createdAt.toISOString(),
          ].join(",")
        ),
      ].join("\n");
      set.headers["content-type"] = "text/csv; charset=utf-8";
      set.headers["content-disposition"] = `attachment; filename=users-${new Date().toISOString().slice(0, 10)}.csv`;
      return csv;
    },
    { detail: { summary: "Export users CSV (super_admin only)", tags: ["Admin"] } }
  );

function csvEscape(v: string): string {
  if (/[",\n]/.test(v)) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

// Suppress unused-import warnings for symbols referenced via SQL templates only.
void gte;
void isNotNull;
void inArray;
