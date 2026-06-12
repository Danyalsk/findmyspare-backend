import { Elysia, t } from "elysia";
import { db } from "../db";
import { products, users, stockMovements } from "../db/schema";
import { eq, ilike, and, gte, lte, ne, notInArray, sql, desc, asc } from "drizzle-orm";
import { authGuard, requireApprovedSupplier } from "../middleware/auth";

// PUBLIC product routes live in their OWN plugin with NO authGuard, so the
// global auth derive never touches them (guests can browse without a token).
// The authenticated supplier routes are in `productRoutes` below.
export const publicProductRoutes = new Elysia({ prefix: "/products" })

  // ─── List Products (Public) ──────────────────────────
  .get(
    "/",
    async ({ query }) => {
      const {
        search,
        category,
        minPrice,
        maxPrice,
        supplierId,
        page = "1",
        limit = "20",
        sort = "newest",
      } = query;

      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [eq(products.status, "active")];

      if (search) {
        conditions.push(
          sql`(${ilike(products.name, `%${search}%`)} OR ${ilike(
            products.partNumber,
            `%${search}%`
          )} OR ${ilike(products.description, `%${search}%`)})`
        );
      }
      if (category) conditions.push(eq(products.category, category));
      if (minPrice) conditions.push(gte(products.price, minPrice));
      if (maxPrice) conditions.push(lte(products.price, maxPrice));
      if (supplierId) conditions.push(eq(products.supplierId, supplierId));

      const orderBy =
        sort === "price_asc"
          ? asc(products.price)
          : sort === "price_desc"
          ? desc(products.price)
          : desc(products.createdAt);

      const items = await db
        .select({
          id: products.id,
          name: products.name,
          partNumber: products.partNumber,
          category: products.category,
          price: products.price,
          stockQuantity: products.stockQuantity,
          images: products.images,
          status: products.status,
          supplierId: products.supplierId,
          supplierName: users.name,
          createdAt: products.createdAt,
        })
        .from(products)
        .leftJoin(users, eq(products.supplierId, users.id))
        .where(and(...conditions))
        .orderBy(orderBy)
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(...conditions));

      return {
        products: items,
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
        category: t.Optional(t.String()),
        minPrice: t.Optional(t.String()),
        maxPrice: t.Optional(t.String()),
        supplierId: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
        sort: t.Optional(t.String()),
      }),
      detail: { summary: "List products with search, filters, and pagination", tags: ["Products"] },
    }
  )

  // ─── Get Single Product (Public) ─────────────────────
  .get(
    "/:id",
    async ({ params, set }) => {
      const [product] = await db
        .select({
          id: products.id,
          name: products.name,
          description: products.description,
          partNumber: products.partNumber,
          category: products.category,
          price: products.price,
          stockQuantity: products.stockQuantity,
          lowStockThreshold: products.lowStockThreshold,
          images: products.images,
          specifications: products.specifications,
          compatibleVehicles: products.compatibleVehicles,
          warrantyInfo: products.warrantyInfo,
          status: products.status,
          viewCount: products.viewCount,
          supplierId: products.supplierId,
          supplierName: users.name,
          supplierBusinessName: users.businessName,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .leftJoin(users, eq(products.supplierId, users.id))
        // Exclude soft-deleted AND private drafts — neither should be reachable
        // by guests via a direct product ID.
        .where(and(eq(products.id, params.id), notInArray(products.status, ["deleted", "draft"])))
        .limit(1);

      if (!product) {
        set.status = 404;
        return { error: "Product not found" };
      }

      await db
        .update(products)
        .set({ viewCount: sql`${products.viewCount} + 1` })
        .where(eq(products.id, params.id));

      return { product };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get a single product by ID", tags: ["Products"] },
    }
  );

// ─── Authenticated supplier product routes ───────────
// Separate plugin → the global authGuard derive applies here but NOT to the
// public browse routes above.
export const productRoutes = new Elysia({ prefix: "/products" })
  .use(requireApprovedSupplier)

  .get(
    "/mine",
    async ({ user, query }) => {
      const { status, page = "1", limit = "20" } = query;
      const pageNum = Math.max(1, parseInt(page));
      const limitNum = Math.min(50, Math.max(1, parseInt(limit)));
      const offset = (pageNum - 1) * limitNum;

      const conditions: any[] = [
        eq(products.supplierId, user.id),
        ne(products.status, "deleted"),
      ];
      if (status) conditions.push(eq(products.status, status as any));

      const items = await db
        .select({
          id: products.id,
          name: products.name,
          partNumber: products.partNumber,
          category: products.category,
          price: products.price,
          stockQuantity: products.stockQuantity,
          lowStockThreshold: products.lowStockThreshold,
          images: products.images,
          status: products.status,
          viewCount: products.viewCount,
          createdAt: products.createdAt,
          updatedAt: products.updatedAt,
        })
        .from(products)
        .where(and(...conditions))
        .orderBy(desc(products.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(...conditions));

      return {
        products: items,
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
      detail: { summary: "List authenticated supplier's own products", tags: ["Products"] },
    }
  )

  // ─── Create Product (Approved Supplier) ──────────────
  .post(
    "/",
    async ({ body, user, set }) => {
      const initialStock = body.stockQuantity ?? 0;
      const [product] = await db
        .insert(products)
        .values({
          supplierId: user.id,
          name: body.name,
          description: body.description,
          partNumber: body.partNumber,
          category: body.category,
          price: body.price,
          stockQuantity: initialStock,
          lowStockThreshold: body.lowStockThreshold ?? 5,
          images: body.images ?? [],
          specifications: body.specifications ?? {},
          compatibleVehicles: body.compatibleVehicles ?? [],
          warrantyInfo: body.warrantyInfo,
          status: body.status ?? "active",
        })
        .returning();

      // Seed the ledger so opening stock is auditable.
      if (initialStock > 0) {
        await db.insert(stockMovements).values({
          productId: product.id,
          supplierId: user.id,
          delta: initialStock,
          previousQuantity: 0,
          newQuantity: initialStock,
          reason: "initial",
          createdBy: user.id,
        });
      }

      set.status = 201;
      return { product };
    },
    {
      body: t.Object({
        name: t.String({ minLength: 2 }),
        description: t.Optional(t.String()),
        partNumber: t.Optional(t.String()),
        category: t.Optional(t.String()),
        price: t.String(),
        stockQuantity: t.Optional(t.Number()),
        lowStockThreshold: t.Optional(t.Number()),
        images: t.Optional(t.Array(t.String())),
        specifications: t.Optional(t.Record(t.String(), t.String())),
        compatibleVehicles: t.Optional(
          t.Array(
            t.Object({
              make: t.String(),
              model: t.String(),
              year: t.Optional(t.String()),
            })
          )
        ),
        warrantyInfo: t.Optional(t.String()),
        // "draft" keeps the item private (inventory only); default "active" lists it.
        status: t.Optional(t.Union([t.Literal("draft"), t.Literal("active")])),
      }),
      detail: { summary: "Create a new product (approved supplier only)", tags: ["Products"] },
    }
  )

  // ─── Update Product ───────────────────────────────────
  .patch(
    "/:id",
    async ({ params, body, user, set }) => {
      const [existing] = await db
        .select({ supplierId: products.supplierId })
        .from(products)
        .where(and(eq(products.id, params.id), ne(products.status, "deleted")))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Product not found" };
      }
      if (existing.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only update your own products" };
      }

      const [updated] = await db
        .update(products)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(products.id, params.id))
        .returning();

      return { product: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(
        t.Object({
          name: t.String({ minLength: 2 }),
          description: t.String(),
          partNumber: t.String(),
          category: t.String(),
          price: t.String(),
          stockQuantity: t.Number(),
          lowStockThreshold: t.Number(),
          images: t.Array(t.String()),
          specifications: t.Record(t.String(), t.String()),
          compatibleVehicles: t.Array(
            t.Object({
              make: t.String(),
              model: t.String(),
              year: t.Optional(t.String()),
            })
          ),
          warrantyInfo: t.String(),
          status: t.Union([
            t.Literal("active"),
            t.Literal("paused"),
            t.Literal("out_of_stock"),
            t.Literal("draft"),
          ]),
        })
      ),
      detail: { summary: "Update a product (owner only)", tags: ["Products"] },
    }
  )

  // ─── Delete Product (Soft) ────────────────────────────
  .delete(
    "/:id",
    async ({ params, user, set }) => {
      const [existing] = await db
        .select({ supplierId: products.supplierId })
        .from(products)
        .where(and(eq(products.id, params.id), ne(products.status, "deleted")))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Product not found" };
      }
      if (existing.supplierId !== user.id) {
        set.status = 403;
        return { error: "You can only delete your own products" };
      }

      await db
        .update(products)
        .set({ status: "deleted", updatedAt: new Date() })
        .where(eq(products.id, params.id));

      return { message: "Product deleted successfully" };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Soft delete a product (owner only)", tags: ["Products"] },
    }
  );
