import { Elysia } from "elysia";
import { db } from "../db";
import { orders, escrowTransactions, bids, inquiries } from "../db/schema";
import { eq, and, inArray, gte, sql } from "drizzle-orm";
import { requireApprovedSupplier } from "../middleware/auth";

export const supplierRoutes = new Elysia({ prefix: "/supplier" })
  .use(requireApprovedSupplier)

  // ─── Supplier Dashboard KPIs ─────────────────────────
  .get("/dashboard", async ({ user }) => {
    const activeStatuses = ["placed", "confirmed", "shipped", "in_transit", "delivered"] as const;
    const pendingStatuses = ["placed", "confirmed", "shipped", "in_transit"] as const;

    const weekAgo = new Date();
    weekAgo.setDate(weekAgo.getDate() - 7);

    const twoWeeksAgo = new Date();
    twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);

    // Pending escrow held for supplier's active orders
    const [{ pendingEscrow }] = await db
      .select({ pendingEscrow: sql<number>`COALESCE(SUM(${escrowTransactions.amount}::numeric), 0)::float` })
      .from(escrowTransactions)
      .innerJoin(orders, eq(escrowTransactions.orderId, orders.id))
      .where(
        and(
          eq(orders.supplierId, user.id),
          inArray(orders.status, activeStatuses),
          eq(escrowTransactions.status, "held")
        )
      );

    // Pending order count
    const [{ pendingOrderCount }] = await db
      .select({ pendingOrderCount: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.supplierId, user.id),
          inArray(orders.status, pendingStatuses)
        )
      );

    // Released this week
    const [{ releasedThisWeek }] = await db
      .select({ releasedThisWeek: sql<number>`COALESCE(SUM(${escrowTransactions.amount}::numeric), 0)::float` })
      .from(escrowTransactions)
      .innerJoin(orders, eq(escrowTransactions.orderId, orders.id))
      .where(
        and(
          eq(orders.supplierId, user.id),
          eq(escrowTransactions.status, "released"),
          gte(escrowTransactions.releasedAt, weekAgo)
        )
      );

    // Released previous week (for % change)
    const [{ releasedPrevWeek }] = await db
      .select({ releasedPrevWeek: sql<number>`COALESCE(SUM(${escrowTransactions.amount}::numeric), 0)::float` })
      .from(escrowTransactions)
      .innerJoin(orders, eq(escrowTransactions.orderId, orders.id))
      .where(
        and(
          eq(orders.supplierId, user.id),
          eq(escrowTransactions.status, "released"),
          gte(escrowTransactions.releasedAt, twoWeeksAgo),
          sql`${escrowTransactions.releasedAt} < ${weekAgo}`
        )
      );

    // Active bids
    const [{ activeBids }] = await db
      .select({ activeBids: sql<number>`count(*)::int` })
      .from(bids)
      .where(and(eq(bids.supplierId, user.id), eq(bids.status, "pending")));

    // Open inquiries on platform
    const [{ openInquiries }] = await db
      .select({ openInquiries: sql<number>`count(*)::int` })
      .from(inquiries)
      .where(eq(inquiries.isActive, true));

    const releasedChange =
      releasedPrevWeek > 0
        ? Math.round(((releasedThisWeek - releasedPrevWeek) / releasedPrevWeek) * 100)
        : releasedThisWeek > 0
        ? 100
        : 0;

    return {
      pendingEscrow,
      pendingOrderCount,
      releasedThisWeek,
      releasedChange,
      activeBids,
      openInquiries,
    };
  });
