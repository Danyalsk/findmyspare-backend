import { Elysia, t } from "elysia";
import { db } from "../db";
import { products, stockMovements } from "../db/schema";
import { eq, and, ne, ilike, lte, desc, sql } from "drizzle-orm";
import { requireApprovedSupplier } from "../middleware/auth";
import { recordStockMovement } from "../lib/stock";

// Supplier-private inventory management. An "inventory item" is simply one of the
// supplier's own non-deleted products — drafts (private) + published listings.
export const inventoryRoutes = new Elysia({ prefix: "/inventory" })
  .use(requireApprovedSupplier)

  // ─── List Inventory ──────────────────────────────────
  .get(
    "/",
    async ({ user, query }) => {
      const { search, status, lowStock, page = "1", limit = "20", sort = "newest" } = query;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [
        eq(products.supplierId, user.id),
        ne(products.status, "deleted"),
      ];

      if (search) {
        conditions.push(
          sql`(${ilike(products.name, `%${search}%`)} OR ${ilike(
            products.partNumber,
            `%${search}%`
          )})`
        );
      }
      if (status) conditions.push(eq(products.status, status as any));
      if (lowStock === "true") {
        conditions.push(lte(products.stockQuantity, products.lowStockThreshold));
      }

      const orderBy =
        sort === "stock_asc"
          ? sql`${products.stockQuantity} asc`
          : sort === "stock_desc"
          ? sql`${products.stockQuantity} desc`
          : desc(products.updatedAt);

      const items = await db
        .select({
          id: products.id,
          name: products.name,
          partNumber: products.partNumber,
          category: products.category,
          price: products.price,
          stockQuantity: products.stockQuantity,
          lowStockThreshold: products.lowStockThreshold,
          status: products.status,
          images: products.images,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(...conditions));

      return {
        items,
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
        search: t.Optional(t.String()),
        status: t.Optional(t.String()),
        lowStock: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
      detail: { summary: "List supplier inventory (drafts + listings)", tags: ["Inventory"] },
    }
  )

  // ─── Inventory Summary (dashboard cards) ─────────────
  .get(
    "/summary",
    async ({ user }) => {
      const base = and(eq(products.supplierId, user.id), ne(products.status, "deleted"));
      const [row] = await db
        .select({
          totalItems: sql<number>`count(*)::int`,
          drafts: sql<number>`count(*) filter (where ${products.status} = 'draft')::int`,
          listed: sql<number>`count(*) filter (where ${products.status} <> 'draft')::int`,
          lowStock: sql<number>`count(*) filter (where ${products.stockQuantity} <= ${products.lowStockThreshold} and ${products.stockQuantity} > 0)::int`,
          outOfStock: sql<number>`count(*) filter (where ${products.stockQuantity} <= 0)::int`,
        })
        .from(products)
        .where(base);

      return row ?? { totalItems: 0, drafts: 0, listed: 0, lowStock: 0, outOfStock: 0 };
    },
    { detail: { summary: "Inventory KPI counts for supplier dashboard", tags: ["Inventory"] } }
  )

  // ─── Adjust Stock ────────────────────────────────────
  .post(
    "/:productId/adjust",
    async ({ params, body, user, set }) => {
      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.productId), ne(products.status, "deleted")))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Inventory item not found" };
      }
      if (product.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only adjust your own inventory" };
      }
      if (!Number.isInteger(body.delta) || body.delta === 0) {
        set.status = 400;
        return { error: "Adjustment delta must be a non-zero whole number" };
      }
      if (product.stockQuantity + body.delta < 0) {
        set.status = 400;
        return {
          error: `Adjustment would make stock negative. Current: ${product.stockQuantity}`,
        };
      }

      const result = await recordStockMovement({
        product,
        delta: body.delta,
        reason: body.reason,
        note: body.note,
        createdBy: user.id,
      });

      return result;
    },
    {
      params: t.Object({ productId: t.String() }),
      body: t.Object({
        // t.Number (not t.Integer) for compatibility across TypeBox versions;
        // integer-ness is enforced in the handler above.
        delta: t.Number(),
        reason: t.Union([
          t.Literal("received"),
          t.Literal("damaged"),
          t.Literal("correction"),
          t.Literal("returned"),
        ]),
        note: t.Optional(t.String()),
      }),
      detail: { summary: "Adjust stock with an audited movement", tags: ["Inventory"] },
    }
  )

  // ─── Movement History ────────────────────────────────
  .get(
    "/:productId/movements",
    async ({ params, user, query, set }) => {
      const [product] = await db
        .select({ supplierId: products.supplierId })
        .from(products)
        .where(eq(products.id, params.productId))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Inventory item not found" };
      }
      if (product.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only view your own inventory history" };
      }

      const { page = "1", limit = "20" } = query;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const movements = await db
        .select({
          id: stockMovements.id,
          delta: stockMovements.delta,
          previousQuantity: stockMovements.previousQuantity,
          newQuantity: stockMovements.newQuantity,
          reason: stockMovements.reason,
          note: stockMovements.note,
          createdAt: stockMovements.createdAt,
        })
        .from(stockMovements)
        .where(eq(stockMovements.productId, params.productId))
        .orderBy(desc(stockMovements.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(stockMovements)
        .where(eq(stockMovements.productId, params.productId));

      return {
        movements,
        pagination: {
          page: pageNum,
          limit: limitNum,
          total: count,
          totalPages: Math.ceil(count / limitNum),
        },
      };
    },
    {
      params: t.Object({ productId: t.String() }),
      query: t.Object({ page: t.Optional(t.String()), limit: t.Optional(t.String()) }),
      detail: { summary: "Stock movement history for an inventory item", tags: ["Inventory"] },
    }
  )

  // ─── Publish (draft/paused → listed) ─────────────────
  .post(
    "/:productId/publish",
    async ({ params, user, set }) => {
      const [product] = await db
        .select()
        .from(products)
        .where(and(eq(products.id, params.productId), ne(products.status, "deleted")))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Inventory item not found" };
      }
      if (product.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only publish your own inventory" };
      }
      if (product.status !== "draft" && product.status !== "paused") {
        set.status = 400;
        return { error: "Only draft or paused items can be published" };
      }
      if (!product.name || product.name.trim().length < 2 || parseFloat(product.price) <= 0) {
        set.status = 400;
        return { error: "Item needs a name and a price greater than 0 before publishing" };
      }

      const [updated] = await db
        .update(products)
        .set({
          status: product.stockQuantity > 0 ? "active" : "out_of_stock",
          updatedAt: new Date(),
        })
        .where(eq(products.id, params.productId))
        .returning();

      return { product: updated };
    },
    {
      params: t.Object({ productId: t.String() }),
      detail: { summary: "Publish an inventory item to the marketplace", tags: ["Inventory"] },
    }
  )

  // ─── Unpublish (listed → draft) ──────────────────────
  .post(
    "/:productId/unpublish",
    async ({ params, user, set }) => {
      const [product] = await db
        .select({ supplierId: products.supplierId, status: products.status })
        .from(products)
        .where(and(eq(products.id, params.productId), ne(products.status, "deleted")))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Inventory item not found" };
      }
      if (product.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only unpublish your own inventory" };
      }
      if (product.status === "draft") {
        set.status = 400;
        return { error: "Item is already a draft" };
      }

      const [updated] = await db
        .update(products)
        .set({ status: "draft", updatedAt: new Date() })
        .where(eq(products.id, params.productId))
        .returning();

      return { product: updated };
    },
    {
      params: t.Object({ productId: t.String() }),
      detail: { summary: "Delist an inventory item back to draft", tags: ["Inventory"] },
    }
  );
