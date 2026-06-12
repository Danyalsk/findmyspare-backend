import { Elysia, t } from "elysia";
import { db } from "../db";
import {
  orders,
  orderItems,
  products,
  users,
  addresses,
  escrowTransactions,
  notifications,
  disputes,
} from "../db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { authGuard } from "../middleware/auth";
import { recordStockMovement } from "../lib/stock";

export const orderRoutes = new Elysia({ prefix: "/orders" })
  .use(authGuard)

  // ─── List Orders ─────────────────────────────────────
  .get(
    "/",
    async ({ user, query }) => {
      const { status, page = "1", limit = "20" } = query;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      // Show orders where user is buyer or supplier
      const conditions = [
        or(eq(orders.buyerId, user.id), eq(orders.supplierId, user.id)),
      ];

      if (status) {
        conditions.push(eq(orders.status, status as any));
      }

      const items = await db
        .select({
          id: orders.id,
          status: orders.status,
          totalAmount: orders.totalAmount,
          trackingNumber: orders.trackingNumber,
          courierService: orders.courierService,
          estimatedDelivery: orders.estimatedDelivery,
          autoCloseAt: orders.autoCloseAt,
          createdAt: orders.createdAt,
          buyerId: orders.buyerId,
          supplierId: orders.supplierId,
          buyerName: sql<string>`buyer.name`,
          supplierName: sql<string>`supplier.name`,
          primaryItemName: sql<string>`(
            SELECT p.name
            FROM ${orderItems} oi
            LEFT JOIN ${products} p ON p.id = oi.product_id
            WHERE oi.order_id = ${orders.id}
            ORDER BY oi.id
            LIMIT 1
          )`,
          primaryPartNumber: sql<string>`(
            SELECT p.part_number
            FROM ${orderItems} oi
            LEFT JOIN ${products} p ON p.id = oi.product_id
            WHERE oi.order_id = ${orders.id}
            ORDER BY oi.id
            LIMIT 1
          )`,
        })
        .from(orders)
        .leftJoin(
          sql`${users} as buyer`,
          sql`buyer.id = ${orders.buyerId}`
        )
        .leftJoin(
          sql`${users} as supplier`,
          sql`supplier.id = ${orders.supplierId}`
        )
        .where(and(...conditions))
        .orderBy(desc(orders.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(orders)
        .where(and(...conditions));

      return {
        orders: items,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum),
        },
      };
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: {
        summary: "List orders for current user (buyer or supplier)",
        tags: ["Orders"],
      },
    }
  )

  // ─── Get Order Detail ────────────────────────────────
  .get(
    "/:id",
    async ({ params, user, set }) => {
      const [order] = await db
        .select()
        .from(orders)
        .where(
          and(
            eq(orders.id, params.id),
            or(eq(orders.buyerId, user.id), eq(orders.supplierId, user.id))
          )
        )
        .limit(1);

      if (!order) {
        set.status = 404;
        return { error: "Order not found" };
      }

      // Fetch order items with product details
      const items = await db
        .select({
          id: orderItems.id,
          quantity: orderItems.quantity,
          unitPrice: orderItems.unitPrice,
          subtotal: orderItems.subtotal,
          productId: orderItems.productId,
          productName: products.name,
          productImage: products.images,
          partNumber: products.partNumber,
        })
        .from(orderItems)
        .leftJoin(products, eq(orderItems.productId, products.id))
        .where(eq(orderItems.orderId, params.id));

      // Fetch escrow
      const [escrow] = await db
        .select()
        .from(escrowTransactions)
        .where(eq(escrowTransactions.orderId, params.id))
        .limit(1);

      // Fetch buyer & supplier info
      const [buyer] = await db
        .select({ id: users.id, name: users.name, email: users.email, phone: users.phone })
        .from(users)
        .where(eq(users.id, order.buyerId))
        .limit(1);

      const [supplier] = await db
        .select({ id: users.id, name: users.name, email: users.email, businessName: users.businessName })
        .from(users)
        .where(eq(users.id, order.supplierId))
        .limit(1);

      let shippingAddress: {
        id: string;
        label: string | null;
        line1: string;
        line2: string | null;
        city: string;
        state: string;
        postalCode: string;
        country: string;
        phone: string | null;
      } | null = null;

      if (order.shippingAddressId) {
        [shippingAddress] = await db
          .select({
            id: addresses.id,
            label: addresses.label,
            line1: addresses.line1,
            line2: addresses.line2,
            city: addresses.city,
            state: addresses.state,
            postalCode: addresses.postalCode,
            country: addresses.country,
            phone: addresses.phone,
          })
          .from(addresses)
          .where(eq(addresses.id, order.shippingAddressId))
          .limit(1);
      }

      // Latest dispute (if any) so the clients can deep-link to the thread.
      const [dispute] = await db
        .select({ id: disputes.id, status: disputes.status })
        .from(disputes)
        .where(eq(disputes.orderId, params.id))
        .orderBy(desc(disputes.createdAt))
        .limit(1);

      return {
        order,
        items,
        escrow,
        buyer,
        supplier,
        shippingAddress,
        dispute: dispute ?? null,
      };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Get order detail with items, escrow, and parties",
        tags: ["Orders"],
      },
    }
  )

  // ─── Place Order (Buyer) ─────────────────────────────
  .post(
    "/",
    async ({ body, user, set }) => {
      if (user.role !== "buyer") {
        set.status = 403;
        return { error: "Only buyers can place orders" };
      }

      const { items: cartItems, shippingAddressId } = body;

      // Validate all products exist and compute total
      let totalAmount = 0;
      const validatedItems: {
        productId: string;
        supplierId: string;
        quantity: number;
        unitPrice: string;
        subtotal: string;
        product: typeof products.$inferSelect;
      }[] = [];

      // All items must be from a single supplier (Phase 1)
      let orderSupplierId: string | null = null;

      for (const item of cartItems) {
        const [product] = await db
          .select()
          .from(products)
          .where(
            and(
              eq(products.id, item.productId),
              eq(products.status, "active")
            )
          )
          .limit(1);

        if (!product) {
          set.status = 400;
          return { error: `Product ${item.productId} not found or unavailable` };
        }

        if (product.stockQuantity < item.quantity) {
          set.status = 400;
          return {
            error: `Insufficient stock for "${product.name}". Available: ${product.stockQuantity}`,
          };
        }

        if (!orderSupplierId) {
          orderSupplierId = product.supplierId;
        } else if (product.supplierId !== orderSupplierId) {
          set.status = 400;
          return {
            error: "All items in an order must be from the same supplier (Phase 1)",
          };
        }

        const subtotal = parseFloat(product.price) * item.quantity;
        totalAmount += subtotal;

        validatedItems.push({
          productId: product.id,
          supplierId: product.supplierId,
          quantity: item.quantity,
          unitPrice: product.price,
          subtotal: subtotal.toFixed(2),
          product,
        });
      }

      // Calculate auto-close date (7 days after estimated delivery, or 14 days from now)
      const autoCloseAt = new Date();
      autoCloseAt.setDate(autoCloseAt.getDate() + 14);

      // Create order
      const [order] = await db
        .insert(orders)
        .values({
          buyerId: user.id,
          supplierId: orderSupplierId!,
          status: "placed",
          totalAmount: totalAmount.toFixed(2),
          shippingAddressId: shippingAddressId || null,
          autoCloseAt,
        })
        .returning();

      // Create order items
      await db.insert(orderItems).values(
        validatedItems.map((item) => ({
          orderId: order.id,
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          subtotal: item.subtotal,
        }))
      );

      // Deduct stock through the audited ledger (flips out_of_stock + fires
      // low-stock notification on threshold crossing).
      for (const item of validatedItems) {
        await recordStockMovement({
          product: item.product,
          delta: -item.quantity,
          reason: "order",
          createdBy: user.id,
        });
      }

      // Create escrow hold (100% of total)
      await db.insert(escrowTransactions).values({
        orderId: order.id,
        amount: totalAmount.toFixed(2),
        status: "held",
      });

      // Notify supplier
      await db.insert(notifications).values({
        userId: orderSupplierId!,
        type: "new_order",
        title: "New Order Received",
        message: `You have a new order worth ₹${totalAmount.toFixed(2)}`,
        metadata: { orderId: order.id },
      });

      set.status = 201;
      return { order, escrowStatus: "held", totalAmount: totalAmount.toFixed(2) };
    },
    {
      body: t.Object({
        items: t.Array(
          t.Object({
            productId: t.String(),
            quantity: t.Number({ minimum: 1 }),
          }),
          { minItems: 1 }
        ),
        shippingAddressId: t.Optional(t.String()),
      }),
      detail: {
        summary: "Place an order with escrow hold (buyer only)",
        tags: ["Orders"],
      },
    }
  )

  // ─── Update Order Status ─────────────────────────────
  .patch(
    "/:id/status",
    async ({ params, body, user, set }) => {
      const [order] = await db
        .select()
        .from(orders)
        .where(eq(orders.id, params.id))
        .limit(1);

      if (!order) {
        set.status = 404;
        return { error: "Order not found" };
      }

      const { status } = body;

      // Validate status transitions based on role
      const supplierTransitions: Record<string, string[]> = {
        placed: ["confirmed", "cancelled"],
        confirmed: ["shipped"],
        shipped: ["in_transit"],
        in_transit: ["delivered"],
      };

      const buyerTransitions: Record<string, string[]> = {
        delivered: ["completed", "disputed"],
      };

      if (user.role === "supplier" && order.supplierId === user.id) {
        const allowed = supplierTransitions[order.status] || [];
        if (!allowed.includes(status)) {
          set.status = 400;
          return {
            error: `Cannot transition from '${order.status}' to '${status}' as supplier`,
          };
        }
      } else if (user.role === "buyer" && order.buyerId === user.id) {
        const allowed = buyerTransitions[order.status] || [];
        if (!allowed.includes(status)) {
          set.status = 400;
          return {
            error: `Cannot transition from '${order.status}' to '${status}' as buyer`,
          };
        }
      } else {
        set.status = 403;
        return { error: "You are not authorized to update this order" };
      }

      // Build update fields
      const updateFields: Record<string, any> = {
        status,
        updatedAt: new Date(),
      };

      if (status === "shipped") {
        updateFields.trackingNumber = body.trackingNumber || null;
        updateFields.courierService = body.courierService || null;
        updateFields.estimatedDelivery = body.estimatedDelivery
          ? new Date(body.estimatedDelivery)
          : null;
      }

      if (status === "delivered") {
        updateFields.deliveredAt = new Date();
        // Set auto-close to 7 days from delivery
        const autoClose = new Date();
        autoClose.setDate(autoClose.getDate() + 7);
        updateFields.autoCloseAt = autoClose;
      }

      if (status === "completed") {
        updateFields.closedAt = new Date();
        // Release escrow
        await db
          .update(escrowTransactions)
          .set({ status: "released", releasedAt: new Date() })
          .where(eq(escrowTransactions.orderId, params.id));
      }

      if (status === "cancelled") {
        updateFields.closedAt = new Date();
        // Refund escrow
        await db
          .update(escrowTransactions)
          .set({ status: "refund_completed", refundedAt: new Date() })
          .where(eq(escrowTransactions.orderId, params.id));

        // Restock the reserved units (deducted at placement). Without this,
        // cancellations would leak stock permanently.
        const cancelledItems = await db
          .select({ productId: orderItems.productId, quantity: orderItems.quantity })
          .from(orderItems)
          .where(eq(orderItems.orderId, params.id));
        for (const ci of cancelledItems) {
          if (!ci.productId) continue;
          const [prod] = await db
            .select()
            .from(products)
            .where(eq(products.id, ci.productId))
            .limit(1);
          if (prod) {
            await recordStockMovement({
              product: prod,
              delta: ci.quantity,
              reason: "order_cancelled",
              createdBy: user.id,
            });
          }
        }
      }

      const [updated] = await db
        .update(orders)
        .set(updateFields)
        .where(eq(orders.id, params.id))
        .returning();

      // Notify the other party
      const notifyUserId =
        user.id === order.buyerId ? order.supplierId : order.buyerId;

      await db.insert(notifications).values({
        userId: notifyUserId,
        type: "order_update",
        title: `Order ${status.replace("_", " ")}`,
        message: `Order has been updated to: ${status.replace("_", " ")}`,
        metadata: { orderId: order.id, newStatus: status },
      });

      return { order: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        status: t.String(),
        trackingNumber: t.Optional(t.String()),
        courierService: t.Optional(t.String()),
        estimatedDelivery: t.Optional(t.String()),
      }),
      detail: {
        summary: "Update order status with role-based transition validation",
        tags: ["Orders"],
      },
    }
  );
