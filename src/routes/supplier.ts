import { Elysia } from "elysia";
import { db } from "../db";
import { orders, bids, inquiries } from "../db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";
import { requireApprovedSupplier } from "../middleware/auth";

// v1 ships without payment / escrow. Dashboard surfaces operational counts only:
// pending orders awaiting action, active bids, and open inquiries the supplier can bid on.
// Escrow SUM aggregates removed (numeric→float cast lost precision; recurring errors).
export const supplierRoutes = new Elysia({ prefix: "/supplier" })
  .use(requireApprovedSupplier)

  .get("/dashboard", async ({ user }) => {
    const pendingStatuses = ["placed", "confirmed", "shipped", "in_transit"] as const;

    const [{ pendingOrderCount }] = await db
      .select({ pendingOrderCount: sql<number>`count(*)::int` })
      .from(orders)
      .where(
        and(
          eq(orders.supplierId, user.id),
          inArray(orders.status, pendingStatuses)
        )
      );

    const [{ activeBids }] = await db
      .select({ activeBids: sql<number>`count(*)::int` })
      .from(bids)
      .where(and(eq(bids.supplierId, user.id), eq(bids.status, "pending")));

    const [{ openInquiries }] = await db
      .select({ openInquiries: sql<number>`count(*)::int` })
      .from(inquiries)
      .where(eq(inquiries.isActive, true));

    return {
      pendingOrderCount,
      activeBids,
      openInquiries,
    };
  });
