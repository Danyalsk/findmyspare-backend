import { Elysia, t } from "elysia";
import { db } from "../db";
import { inquiries, users } from "../db/schema";
import { eq, desc, and, sql } from "drizzle-orm";
import { authGuard, requireRole } from "../middleware/auth";
import { broadcastInquiryCreated } from "../lib/io";

// ─── Per-user rate limiter (in-memory token bucket) ──
// 5 inquiries per 60s window, keyed by userId. Simple and sufficient for
// this endpoint — swap for Redis if the app goes multi-instance.
const INQUIRY_WINDOW_MS = 60_000;
const INQUIRY_MAX = 5;
const inquiryHits = new Map<string, number[]>();

function checkInquiryRate(userId: string): { ok: true } | { ok: false; retryAfter: number } {
  const now = Date.now();
  const cutoff = now - INQUIRY_WINDOW_MS;
  const hits = (inquiryHits.get(userId) || []).filter((t) => t > cutoff);
  if (hits.length >= INQUIRY_MAX) {
    const retryAfter = Math.ceil((hits[0] + INQUIRY_WINDOW_MS - now) / 1000);
    inquiryHits.set(userId, hits);
    return { ok: false, retryAfter };
  }
  hits.push(now);
  inquiryHits.set(userId, hits);
  return { ok: true };
}

export const inquiryRoutes = new Elysia({ prefix: "/inquiries" })

  // ─── Create Inquiry (Buyer) ──────────────────────────
  .use(authGuard)
  .post(
    "/",
    async ({ body, user, set }) => {
      if (user.role !== "buyer") {
        set.status = 403;
        return { error: "Only buyers can create inquiries" };
      }

      const rate = checkInquiryRate(user.id);
      if (!rate.ok) {
        set.status = 429;
        set.headers["retry-after"] = String(rate.retryAfter);
        return {
          error: `Too many inquiries. Try again in ${rate.retryAfter}s.`,
        };
      }

      const [newInquiry] = await db
        .insert(inquiries)
        .values({
          buyerId: user.id,
          partName: body.partName,
          make: body.make,
          model: body.model,
          year: body.year,
          description: body.description || null,
          imageUrl: body.imageUrl || null,
        })
        .returning();

      broadcastInquiryCreated({
        ...newInquiry,
        buyerName: user.name,
        bidCount: 0,
      });

      set.status = 201;
      return { inquiry: newInquiry };
    },
    {
      body: t.Object({
        partName: t.String({ minLength: 2 }),
        make: t.String(),
        model: t.String(),
        year: t.String(),
        description: t.Optional(t.String()),
        imageUrl: t.Optional(t.String()),
      }),
      detail: { summary: "Create a new part inquiry (buyer only)", tags: ["Inquiries"] },
    }
  )

  // ─── Buyer's Own Inquiries ───────────────────────────
  .get(
    "/me",
    async ({ user }) => {
      const items = await db
        .select({
          id: inquiries.id,
          partName: inquiries.partName,
          make: inquiries.make,
          model: inquiries.model,
          year: inquiries.year,
          description: inquiries.description,
          imageUrl: inquiries.imageUrl,
          status: inquiries.status,
          isActive: inquiries.isActive,
          createdAt: inquiries.createdAt,
          updatedAt: inquiries.updatedAt,
          bidCount: sql<number>`(SELECT COUNT(*)::int FROM bids WHERE inquiry_id = inquiries.id AND status != 'rejected')`,
        })
        .from(inquiries)
        .where(eq(inquiries.buyerId, user.id))
        .orderBy(desc(inquiries.createdAt));

      return { inquiries: items };
    },
    {
      detail: { summary: "Get current buyer's inquiries with bid counts", tags: ["Inquiries"] },
    }
  )

  // ─── Get Single Inquiry (Auth) ───────────────────────
  .get(
    "/:inquiryId",
    async ({ params, user, set }) => {
      const [inquiry] = await db
        .select({
          id: inquiries.id,
          buyerId: inquiries.buyerId,
          partName: inquiries.partName,
          make: inquiries.make,
          model: inquiries.model,
          year: inquiries.year,
          description: inquiries.description,
          imageUrl: inquiries.imageUrl,
          status: inquiries.status,
          isActive: inquiries.isActive,
          createdAt: inquiries.createdAt,
          updatedAt: inquiries.updatedAt,
          buyerName: users.name,
          bidCount: sql<number>`(SELECT COUNT(*)::int FROM bids WHERE inquiry_id = inquiries.id AND status != 'rejected')`,
        })
        .from(inquiries)
        .leftJoin(users, eq(inquiries.buyerId, users.id))
        .where(eq(inquiries.id, params.inquiryId))
        .limit(1);

      if (!inquiry) {
        set.status = 404;
        return { error: "Inquiry not found" };
      }

      if (user.role === "buyer" && inquiry.buyerId !== user.id) {
        set.status = 403;
        return { error: "Not authorized to view this inquiry" };
      }

      if (user.role === "supplier" && !inquiry.isActive) {
        set.status = 404;
        return { error: "Inquiry not found or no longer active" };
      }

      return { inquiry };
    },
    {
      params: t.Object({ inquiryId: t.String() }),
      detail: { summary: "Get a single inquiry by ID", tags: ["Inquiries"] },
    }
  )

  // ─── All Active Inquiries (Supplier Only) ────────────
  .use(requireRole("supplier"))
  .get(
    "/",
    async ({ query }) => {
      const page = Math.max(1, parseInt((query as any).page || "1"));
      const limit = Math.min(50, parseInt((query as any).limit || "20"));
      const offset = (page - 1) * limit;

      const items = await db
        .select({
          id: inquiries.id,
          buyerId: inquiries.buyerId,
          partName: inquiries.partName,
          make: inquiries.make,
          model: inquiries.model,
          year: inquiries.year,
          description: inquiries.description,
          imageUrl: inquiries.imageUrl,
          status: inquiries.status,
          isActive: inquiries.isActive,
          createdAt: inquiries.createdAt,
          updatedAt: inquiries.updatedAt,
          buyerName: users.name,
          bidCount: sql<number>`(SELECT COUNT(*)::int FROM bids WHERE inquiry_id = inquiries.id AND status != 'rejected')`,
        })
        .from(inquiries)
        .leftJoin(users, eq(inquiries.buyerId, users.id))
        .where(eq(inquiries.isActive, true))
        .orderBy(desc(inquiries.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(inquiries)
        .where(eq(inquiries.isActive, true));

      return {
        inquiries: items,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "Get all active platform inquiries (supplier only)", tags: ["Inquiries"] },
    }
  );
