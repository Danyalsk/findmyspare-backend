import { Elysia, t } from "elysia";
import { db } from "../db";
import {
  disputes,
  orders,
  escrowTransactions,
  notifications,
} from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authGuard } from "../middleware/auth";

export const disputeRoutes = new Elysia({ prefix: "/disputes" })
  .use(authGuard)

  // ─── Raise Dispute (Buyer) ───────────────────────────
  .post(
    "/orders/:orderId",
    async ({ params, body, user, set }) => {
      if (user.role !== "buyer") {
        set.status = 403;
        return { error: "Only buyers can raise disputes" };
      }

      // Verify order belongs to this buyer and is in delivered state
      const [order] = await db
        .select()
        .from(orders)
        .where(
          and(eq(orders.id, params.orderId), eq(orders.buyerId, user.id))
        )
        .limit(1);

      if (!order) {
        set.status = 404;
        return { error: "Order not found" };
      }

      if (order.status !== "delivered") {
        set.status = 400;
        return {
          error: "Disputes can only be raised for delivered orders",
        };
      }

      // Check for existing open dispute
      const [existing] = await db
        .select({ id: disputes.id })
        .from(disputes)
        .where(
          and(
            eq(disputes.orderId, params.orderId),
            eq(disputes.status, "open")
          )
        )
        .limit(1);

      if (existing) {
        set.status = 409;
        return { error: "An open dispute already exists for this order" };
      }

      // Create dispute
      const [dispute] = await db
        .insert(disputes)
        .values({
          orderId: params.orderId,
          raisedById: user.id,
          issueType: body.issueType as any,
          description: body.description,
          evidence: body.evidence || [],
        })
        .returning();

      // Update order status
      await db
        .update(orders)
        .set({ status: "disputed", updatedAt: new Date() })
        .where(eq(orders.id, params.orderId));

      // Notify supplier
      await db.insert(notifications).values({
        userId: order.supplierId,
        type: "dispute_raised",
        title: "Dispute Raised",
        message: `A buyer has raised a "${body.issueType}" dispute on order`,
        metadata: { orderId: order.id, disputeId: dispute.id },
      });

      set.status = 201;
      return { dispute };
    },
    {
      params: t.Object({ orderId: t.String() }),
      body: t.Object({
        issueType: t.Union([
          t.Literal("wrong_part"),
          t.Literal("damaged"),
          t.Literal("not_as_described"),
          t.Literal("missing_parts"),
          t.Literal("not_delivered"),
          t.Literal("other"),
        ]),
        description: t.String({ minLength: 10 }),
        evidence: t.Optional(t.Array(t.String())),
      }),
      detail: {
        summary: "Raise a dispute on a delivered order (buyer only)",
        tags: ["Disputes"],
      },
    }
  )

  // ─── Get Dispute Detail ──────────────────────────────
  .get(
    "/:id",
    async ({ params, user, set }) => {
      const [dispute] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, params.id))
        .limit(1);

      if (!dispute) {
        set.status = 404;
        return { error: "Dispute not found" };
      }

      // Verify user is part of this dispute's order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, dispute.orderId))
        .limit(1);

      if (
        order &&
        order.buyerId !== user.id &&
        order.supplierId !== user.id
      ) {
        set.status = 403;
        return { error: "You are not authorized to view this dispute" };
      }

      return { dispute, order };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get dispute details",
        tags: ["Disputes"],
      },
    }
  )

  // ─── Supplier Respond to Dispute ─────────────────────
  .patch(
    "/:id",
    async ({ params, body, user, set }) => {
      const [dispute] = await db
        .select()
        .from(disputes)
        .where(eq(disputes.id, params.id))
        .limit(1);

      if (!dispute) {
        set.status = 404;
        return { error: "Dispute not found" };
      }

      // Verify supplier owns the order
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, dispute.orderId))
        .limit(1);

      if (!order || order.supplierId !== user.id) {
        set.status = 403;
        return { error: "Only the supplier can respond to this dispute" };
      }

      const updateFields: Record<string, any> = {
        updatedAt: new Date(),
      };

      if (body.supplierResponse) {
        updateFields.supplierResponse = body.supplierResponse;
      }
      if (body.supplierEvidence) {
        updateFields.supplierEvidence = body.supplierEvidence;
      }

      // Supplier approves return
      if (body.action === "approve_return") {
        updateFields.status = "return_approved";

        await db.insert(notifications).values({
          userId: order.buyerId,
          type: "return_approved",
          title: "Return Approved",
          message: "Your return request has been approved. Please ship the item back.",
          metadata: { orderId: order.id, disputeId: dispute.id },
        });
      }

      // Supplier rejects
      if (body.action === "reject") {
        updateFields.status = "under_review";

        await db.insert(notifications).values({
          userId: order.buyerId,
          type: "dispute_update",
          title: "Dispute Under Review",
          message: "The supplier has responded to your dispute. It is now under review.",
          metadata: { orderId: order.id, disputeId: dispute.id },
        });
      }

      // Supplier confirms return received → trigger refund
      if (body.action === "confirm_return") {
        updateFields.status = "resolved";
        updateFields.returnConfirmedAt = new Date();
        updateFields.resolvedAt = new Date();

        // Refund escrow
        await db
          .update(escrowTransactions)
          .set({ status: "refund_completed", refundedAt: new Date() })
          .where(eq(escrowTransactions.orderId, dispute.orderId));

        // Update order
        await db
          .update(orders)
          .set({ status: "cancelled", closedAt: new Date(), updatedAt: new Date() })
          .where(eq(orders.id, dispute.orderId));

        await db.insert(notifications).values({
          userId: order.buyerId,
          type: "refund_processed",
          title: "Refund Processed",
          message: "Your return has been confirmed and a refund has been initiated.",
          metadata: { orderId: order.id, disputeId: dispute.id },
        });
      }

      const [updated] = await db
        .update(disputes)
        .set(updateFields)
        .where(eq(disputes.id, params.id))
        .returning();

      return { dispute: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        action: t.Optional(
          t.Union([
            t.Literal("approve_return"),
            t.Literal("reject"),
            t.Literal("confirm_return"),
          ])
        ),
        supplierResponse: t.Optional(t.String()),
        supplierEvidence: t.Optional(t.Array(t.String())),
      }),
      detail: {
        summary: "Supplier responds to or resolves a dispute",
        tags: ["Disputes"],
      },
    }
  );
