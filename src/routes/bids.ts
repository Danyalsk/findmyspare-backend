import { Elysia, t } from "elysia";
import { db } from "../db";
import {
  bids,
  inquiries,
  orders,
  escrowTransactions,
  users,
  notifications,
} from "../db/schema";
import { eq, and, ne, desc, sql } from "drizzle-orm";
import { authGuard } from "../middleware/auth";

export const bidRoutes = new Elysia()
  .use(authGuard)

  // ─── Submit a Bid (Supplier Only) ───────────────────
  .post(
    "/inquiries/:inquiryId/bids",
    async ({ params, body, user, set }) => {
      if (user.role !== "supplier") {
        set.status = 403;
        return { error: "Only suppliers can submit bids" };
      }

      const [inquiry] = await db
        .select()
        .from(inquiries)
        .where(and(eq(inquiries.id, params.inquiryId), eq(inquiries.isActive, true)))
        .limit(1);

      if (!inquiry) {
        set.status = 404;
        return { error: "Inquiry not found or no longer active" };
      }

      const [existing] = await db
        .select({ id: bids.id })
        .from(bids)
        .where(
          and(
            eq(bids.inquiryId, params.inquiryId),
            eq(bids.supplierId, user.id),
            ne(bids.status, "rejected")
          )
        )
        .limit(1);

      if (existing) {
        set.status = 409;
        return { error: "You have already submitted a bid for this inquiry" };
      }

      const [bid] = await db
        .insert(bids)
        .values({
          inquiryId: params.inquiryId,
          supplierId: user.id,
          price: body.price,
          condition: body.condition || "oem",
          warrantyMonths: body.warrantyMonths ?? 0,
          etaDays: body.etaDays ?? 3,
          notes: body.notes,
        })
        .returning();

      // Update inquiry status to "responded" on first bid
      if (inquiry.status === "pending") {
        await db
          .update(inquiries)
          .set({ status: "responded", updatedAt: new Date() })
          .where(eq(inquiries.id, params.inquiryId));
      }

      // Notify buyer
      await db.insert(notifications).values({
        userId: inquiry.buyerId,
        type: "new_bid",
        title: "New Bid Received",
        message: `A supplier submitted a bid of ₹${body.price} for your "${inquiry.partName}" inquiry`,
        metadata: { inquiryId: inquiry.id, bidId: bid.id },
      });

      set.status = 201;
      return { bid };
    },
    {
      params: t.Object({ inquiryId: t.String() }),
      body: t.Object({
        price: t.String(),
        condition: t.Optional(t.String()),
        warrantyMonths: t.Optional(t.Number()),
        etaDays: t.Optional(t.Number()),
        notes: t.Optional(t.String()),
      }),
      detail: { summary: "Submit a bid on an inquiry (supplier only)", tags: ["Bids"] },
    }
  )

  // ─── List Bids on an Inquiry ─────────────────────────
  .get(
    "/inquiries/:inquiryId/bids",
    async ({ params, user, set }) => {
      const [inquiry] = await db
        .select()
        .from(inquiries)
        .where(eq(inquiries.id, params.inquiryId))
        .limit(1);

      if (!inquiry) {
        set.status = 404;
        return { error: "Inquiry not found" };
      }

      // Buyer must own the inquiry; supplier can view their own bid only
      if (user.role === "buyer" && inquiry.buyerId !== user.id) {
        set.status = 403;
        return { error: "You do not own this inquiry" };
      }

      const conditions =
        user.role === "supplier"
          ? [eq(bids.inquiryId, params.inquiryId), eq(bids.supplierId, user.id)]
          : [eq(bids.inquiryId, params.inquiryId)];

      const items = await db
        .select({
          id: bids.id,
          price: bids.price,
          condition: bids.condition,
          warrantyMonths: bids.warrantyMonths,
          etaDays: bids.etaDays,
          notes: bids.notes,
          status: bids.status,
          orderId: bids.orderId,
          createdAt: bids.createdAt,
          supplierId: bids.supplierId,
          supplierName: users.name,
          supplierBusinessName: users.businessName,
          completedOrders: sql<number>`(
            SELECT COUNT(*)::int FROM orders
            WHERE supplier_id = ${bids.supplierId}
            AND status = 'completed'
          )`,
        })
        .from(bids)
        .leftJoin(users, eq(bids.supplierId, users.id))
        .where(and(...conditions))
        .orderBy(bids.price);

      return { bids: items, inquiry };
    },
    {
      params: t.Object({ inquiryId: t.String() }),
      detail: { summary: "List bids on an inquiry", tags: ["Bids"] },
    }
  )

  // ─── My Bids (Supplier) ──────────────────────────────
  .get(
    "/bids/mine",
    async ({ user, query, set }) => {
      if (user.role !== "supplier") {
        set.status = 403;
        return { error: "Only suppliers can view their bids" };
      }

      const page = Math.max(1, parseInt(query.page || "1"));
      const limit = Math.min(50, parseInt(query.limit || "20"));
      const offset = (page - 1) * limit;

      const items = await db
        .select({
          id: bids.id,
          price: bids.price,
          condition: bids.condition,
          warrantyMonths: bids.warrantyMonths,
          etaDays: bids.etaDays,
          notes: bids.notes,
          status: bids.status,
          orderId: bids.orderId,
          createdAt: bids.createdAt,
          inquiryId: bids.inquiryId,
          partName: inquiries.partName,
          make: inquiries.make,
          model: inquiries.model,
          year: inquiries.year,
          inquiryStatus: inquiries.status,
        })
        .from(bids)
        .leftJoin(inquiries, eq(bids.inquiryId, inquiries.id))
        .where(eq(bids.supplierId, user.id))
        .orderBy(desc(bids.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(bids)
        .where(eq(bids.supplierId, user.id));

      return {
        bids: items,
        pagination: { page, limit, total: count, totalPages: Math.ceil(count / limit) },
      };
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "Get supplier's own bids", tags: ["Bids"] },
    }
  )

  // ─── Accept a Bid (Buyer Only) ───────────────────────
  .post(
    "/bids/:id/accept",
    async ({ params, user, set }) => {
      if (user.role !== "buyer") {
        set.status = 403;
        return { error: "Only buyers can accept bids" };
      }

      const [bid] = await db
        .select()
        .from(bids)
        .where(and(eq(bids.id, params.id), eq(bids.status, "pending")))
        .limit(1);

      if (!bid) {
        set.status = 404;
        return { error: "Bid not found or no longer pending" };
      }

      const [inquiry] = await db
        .select()
        .from(inquiries)
        .where(and(eq(inquiries.id, bid.inquiryId), eq(inquiries.buyerId, user.id)))
        .limit(1);

      if (!inquiry) {
        set.status = 403;
        return { error: "You do not own the inquiry for this bid" };
      }

      const autoCloseAt = new Date();
      autoCloseAt.setDate(autoCloseAt.getDate() + 14);

      // Create order
      const [order] = await db
        .insert(orders)
        .values({
          buyerId: user.id,
          supplierId: bid.supplierId,
          status: "placed",
          totalAmount: bid.price,
          autoCloseAt,
        })
        .returning();

      // Create escrow
      await db.insert(escrowTransactions).values({
        orderId: order.id,
        amount: bid.price,
        status: "held",
      });

      // Accept this bid, reject others
      await db
        .update(bids)
        .set({ status: "accepted", orderId: order.id, updatedAt: new Date() })
        .where(eq(bids.id, bid.id));

      await db
        .update(bids)
        .set({ status: "rejected", updatedAt: new Date() })
        .where(
          and(
            eq(bids.inquiryId, bid.inquiryId),
            ne(bids.id, bid.id),
            eq(bids.status, "pending")
          )
        );

      // Close inquiry
      await db
        .update(inquiries)
        .set({ status: "closed", isActive: false, updatedAt: new Date() })
        .where(eq(inquiries.id, bid.inquiryId));

      // Notify supplier
      await db.insert(notifications).values({
        userId: bid.supplierId,
        type: "bid_accepted",
        title: "Your Bid Was Accepted!",
        message: `Your bid of ₹${bid.price} for "${inquiry.partName}" has been accepted.`,
        metadata: { bidId: bid.id, orderId: order.id, inquiryId: inquiry.id },
      });

      set.status = 201;
      return { order, orderId: order.id };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Accept a bid and create an order (buyer only)", tags: ["Bids"] },
    }
  )

  // ─── Get Single Bid ──────────────────────────────────
  .get(
    "/bids/:id",
    async ({ params, user, set }) => {
      const [bid] = await db
        .select({
          id: bids.id,
          price: bids.price,
          condition: bids.condition,
          warrantyMonths: bids.warrantyMonths,
          etaDays: bids.etaDays,
          notes: bids.notes,
          status: bids.status,
          orderId: bids.orderId,
          createdAt: bids.createdAt,
          inquiryId: bids.inquiryId,
          supplierId: bids.supplierId,
          supplierName: users.name,
          supplierBusinessName: users.businessName,
        })
        .from(bids)
        .leftJoin(users, eq(bids.supplierId, users.id))
        .where(eq(bids.id, params.id))
        .limit(1);

      if (!bid) {
        set.status = 404;
        return { error: "Bid not found" };
      }

      // Only bid's supplier or inquiry's buyer can view
      if (bid.supplierId !== user.id) {
        const [inquiry] = await db
          .select({ buyerId: inquiries.buyerId })
          .from(inquiries)
          .where(eq(inquiries.id, bid.inquiryId))
          .limit(1);

        if (!inquiry || inquiry.buyerId !== user.id) {
          set.status = 403;
          return { error: "Not authorized to view this bid" };
        }
      }

      return { bid };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get a single bid by ID", tags: ["Bids"] },
    }
  );
