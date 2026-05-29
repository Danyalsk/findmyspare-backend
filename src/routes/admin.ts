import { Elysia, t } from "elysia";
import { db } from "../db";
import { users, products, inquiries, banners, rejectionReasons, magicLoginTokens } from "../db/schema";
import { eq, ilike, and, ne, sql, desc, or, inArray } from "drizzle-orm";
import { randomBytes, createHash } from "crypto";
import { requireAdmin } from "../middleware/auth";
import { parsePagination, paginate } from "../lib/pagination";
import { logAdminAction } from "../lib/audit";
import { sendSupplierStatusEmail } from "../lib/email";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

// Mint a single-use 7-day magic-login link for a user.
async function createMagicLoginUrl(userId: string): Promise<string> {
  const token = randomBytes(48).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(magicLoginTokens).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
  });
  return `${FRONTEND_URL}/auth/magic?token=${token}`;
}

void parsePagination;
void inArray;

export const adminRoutes = new Elysia({ prefix: "/admin" })
  .use(requireAdmin)

  // ─── Stats ───────────────────────────────────────────
  .get(
    "/stats",
    async () => {
      const [[{ pendingSuppliers }], [{ totalUsers }], [{ totalSuppliers }], [{ totalBuyers }], [{ totalProducts }], [{ totalInquiries }], [{ activeBanners: activeBannersCount }]] =
        await Promise.all([
          db.select({ pendingSuppliers: sql<number>`count(*)::int` }).from(users).where(and(eq(users.role, "supplier"), eq(users.verificationStatus, "pending"))),
          db.select({ totalUsers: sql<number>`count(*)::int` }).from(users).where(ne(users.role, "admin")),
          db.select({ totalSuppliers: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "supplier")),
          db.select({ totalBuyers: sql<number>`count(*)::int` }).from(users).where(eq(users.role, "buyer")),
          db.select({ totalProducts: sql<number>`count(*)::int` }).from(products).where(ne(products.status, "deleted")),
          db.select({ totalInquiries: sql<number>`count(*)::int` }).from(inquiries),
          db.select({ "activeBanners": sql<number>`count(*)::int` }).from(banners).where(eq(banners.status, "active")),
        ]);

      return {
        pendingSuppliers,
        totalUsers,
        totalSuppliers,
        totalBuyers,
        totalProducts,
        totalInquiries,
        activeBanners: activeBannersCount,
      };
    },
    { detail: { summary: "Platform statistics overview", tags: ["Admin"] } }
  )

  // ─── Suppliers ───────────────────────────────────────
  .get(
    "/suppliers",
    async ({ query }) => {
      const { status, page = "1", limit = "20" } = query;
      const { pageNum, limitNum, offset } = paginate(page, limit);

      const conditions = [eq(users.role, "supplier")] as ReturnType<typeof eq>[];
      if (status) conditions.push(eq(users.verificationStatus, status as any));

      const items = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          businessName: users.businessName,
          verificationStatus: users.verificationStatus,
          gstNumber: users.gstNumber,
          submittedAt: users.updatedAt,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(desc(users.updatedAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(...conditions));

      return {
        suppliers: items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List all suppliers (filterable by verification status)", tags: ["Admin"] },
    }
  )

  .get(
    "/suppliers/:id",
    async ({ params, set }) => {
      const [supplier] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          phone: users.phone,
          image: users.image,
          businessName: users.businessName,
          businessType: users.businessType,
          verificationStatus: users.verificationStatus,
          gstNumber: users.gstNumber,
          panNumber: users.panNumber,
          gstCertificateUrl: users.gstCertificateUrl,
          gstVerification: users.gstVerification,
          businessAddress: users.businessAddress,
          rejectionReason: users.rejectionReason,
          isActive: users.isActive,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt,
        })
        .from(users)
        .where(and(eq(users.id, params.id), eq(users.role, "supplier")))
        .limit(1);

      if (!supplier) {
        set.status = 404;
        return { error: "Supplier not found" };
      }
      return { supplier };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get supplier detail by ID", tags: ["Admin"] },
    }
  )

  .post(
    "/suppliers/:id/approve",
    async ({ params, user, request, set }) => {
      const [existing] = await db
        .select({ id: users.id, role: users.role, email: users.email, name: users.name })
        .from(users)
        .where(and(eq(users.id, params.id), eq(users.role, "supplier")))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Supplier not found" };
      }

      const [updated] = await db
        .update(users)
        .set({ verificationStatus: "approved", rejectionReason: null, updatedAt: new Date() })
        .where(eq(users.id, params.id))
        .returning({
          id: users.id, email: users.email, name: users.name,
          verificationStatus: users.verificationStatus,
        });

      if (existing.email) {
        const loginUrl = await createMagicLoginUrl(params.id);
        sendSupplierStatusEmail(existing.email, existing.name ?? "there", "approved", undefined, loginUrl).catch((e) =>
          console.error("[admin/approve] email failed:", e)
        );
      }
      logAdminAction({ actorId: user.id, request }, "supplier_approve", {
        type: "user",
        id: params.id,
      });
      return { supplier: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Approve supplier verification", tags: ["Admin"] },
    }
  )

  .post(
    "/suppliers/:id/reject",
    async ({ params, body, user, request, set }) => {
      const [existing] = await db
        .select({ id: users.id, role: users.role, email: users.email, name: users.name })
        .from(users)
        .where(and(eq(users.id, params.id), eq(users.role, "supplier")))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Supplier not found" };
      }

      // Optional templated reason: resolve a slug to a stored template body.
      let reasonText = body.reason ?? "";
      if (body.reasonSlug) {
        const [tmpl] = await db
          .select({ body: rejectionReasons.body })
          .from(rejectionReasons)
          .where(eq(rejectionReasons.slug, body.reasonSlug))
          .limit(1);
        if (tmpl) reasonText = `${tmpl.body}${reasonText ? `\n\n${reasonText}` : ""}`;
      }
      if (!reasonText || reasonText.length < 5) {
        set.status = 400;
        return { error: "Rejection reason or template slug required" };
      }

      const [updated] = await db
        .update(users)
        .set({ verificationStatus: "rejected", rejectionReason: reasonText, updatedAt: new Date() })
        .where(eq(users.id, params.id))
        .returning({
          id: users.id, email: users.email, name: users.name,
          verificationStatus: users.verificationStatus, rejectionReason: users.rejectionReason,
        });

      if (existing.email)
        sendSupplierStatusEmail(existing.email, existing.name ?? "there", "rejected", reasonText).catch((e) =>
          console.error("[admin/reject] email failed:", e)
        );
      logAdminAction(
        { actorId: user.id, request },
        "supplier_reject",
        { type: "user", id: params.id },
        { reasonSlug: body.reasonSlug, reason: body.reason }
      );
      return { supplier: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        reason: t.Optional(t.String()),
        reasonSlug: t.Optional(t.String()),
      }),
      detail: { summary: "Reject supplier verification with templated reason", tags: ["Admin"] },
    }
  )

  // ─── Users ───────────────────────────────────────────
  .get(
    "/users",
    async ({ query }) => {
      const { role, search, page = "1", limit = "20" } = query;
      const { pageNum, limitNum, offset } = paginate(page, limit);

      const conditions = [ne(users.role, "admin")] as any[];
      if (role) conditions.push(eq(users.role, role as any));
      if (search) {
        conditions.push(
          or(ilike(users.name, `%${search}%`), ilike(users.email, `%${search}%`))
        );
      }

      const items = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          phone: users.phone,
          businessName: users.businessName,
          verificationStatus: users.verificationStatus,
          isBlocked: sql<boolean>`NOT ${users.isActive}`,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(...conditions))
        .orderBy(desc(users.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(users)
        .where(and(...conditions));

      return {
        users: items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        role: t.Optional(t.String()),
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List all users (filterable by role)", tags: ["Admin"] },
    }
  )

  .get(
    "/users/:id",
    async ({ params, set }) => {
      const [user] = await db
        .select({
          id: users.id,
          name: users.name,
          email: users.email,
          role: users.role,
          phone: users.phone,
          businessName: users.businessName,
          verificationStatus: users.verificationStatus,
          isBlocked: sql<boolean>`NOT ${users.isActive}`,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(and(eq(users.id, params.id), ne(users.role, "admin")))
        .limit(1);

      if (!user) {
        set.status = 404;
        return { error: "User not found" };
      }
      return { user };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get user detail by ID", tags: ["Admin"] },
    }
  )

  .post(
    "/users/:id/block",
    async ({ params, body, user, request, set }) => {
      const [existing] = await db
        .select({ id: users.id, role: users.role })
        .from(users)
        .where(
          and(
            eq(users.id, params.id),
            ne(users.role, "admin"),
            ne(users.role, "super_admin")
          )
        )
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "User not found" };
      }

      const [updated] = await db
        .update(users)
        .set({ isActive: !body.blocked, updatedAt: new Date() })
        .where(eq(users.id, params.id))
        .returning({
          id: users.id, name: users.name, email: users.email, role: users.role,
          isBlocked: sql<boolean>`NOT ${users.isActive}`,
        });

      logAdminAction(
        { actorId: user.id, request },
        body.blocked ? "user_ban" : "user_unban",
        { type: "user", id: params.id },
        { reason: "legacy block toggle" }
      );
      return { user: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({ blocked: t.Boolean() }),
      detail: { summary: "Block or unblock a user", tags: ["Admin"] },
    }
  )

  // ─── Inquiries ───────────────────────────────────────
  .get(
    "/inquiries",
    async ({ query }) => {
      const { status, search, page = "1", limit = "20" } = query;
      const { pageNum, limitNum, offset } = paginate(page, limit);

      const conditions = [] as any[];
      if (status) conditions.push(eq(inquiries.status, status as any));
      if (search) {
        conditions.push(
          or(
            ilike(inquiries.partName, `%${search}%`),
            ilike(inquiries.make, `%${search}%`),
            ilike(inquiries.model, `%${search}%`)
          )
        );
      }

      const items = await db
        .select({
          id: inquiries.id,
          partName: inquiries.partName,
          make: inquiries.make,
          model: inquiries.model,
          year: inquiries.year,
          status: inquiries.status,
          isActive: inquiries.isActive,
          createdAt: inquiries.createdAt,
          buyerId: inquiries.buyerId,
          buyerName: users.name,
          buyerEmail: users.email,
          bidCount: sql<number>`(SELECT count(*)::int FROM bids WHERE bids.inquiry_id = ${inquiries.id})`,
        })
        .from(inquiries)
        .leftJoin(users, eq(inquiries.buyerId, users.id))
        .where(conditions.length ? and(...conditions) : undefined)
        .orderBy(desc(inquiries.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(inquiries)
        .where(conditions.length ? and(...conditions) : undefined);

      return {
        inquiries: items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        status: t.Optional(t.String()),
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List all inquiries", tags: ["Admin"] },
    }
  )

  // ─── Products ────────────────────────────────────────
  .get(
    "/products",
    async ({ query }) => {
      const { search, page = "1", limit = "20" } = query;
      const { pageNum, limitNum, offset } = paginate(page, limit);

      const conditions = [ne(products.status, "deleted")] as any[];
      if (search) {
        conditions.push(
          or(ilike(products.name, `%${search}%`), ilike(products.partNumber, `%${search}%`))
        );
      }

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
        .orderBy(desc(products.createdAt))
        .limit(limitNum)
        .offset(offset);

      const [{ count }] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(products)
        .where(and(...conditions));

      return {
        products: items,
        pagination: { page: pageNum, limit: limitNum, total: count, totalPages: Math.ceil(count / limitNum) },
      };
    },
    {
      query: t.Object({
        search: t.Optional(t.String()),
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List all products", tags: ["Admin"] },
    }
  )

  // ─── Banners ─────────────────────────────────────────
  .get(
    "/banners",
    async () => {
      const items = await db
        .select()
        .from(banners)
        .orderBy(banners.sortOrder, desc(banners.createdAt));
      return { banners: items };
    },
    { detail: { summary: "List all banners", tags: ["Admin"] } }
  )

  .get(
    "/banners/:id",
    async ({ params, set }) => {
      const [banner] = await db
        .select()
        .from(banners)
        .where(eq(banners.id, params.id))
        .limit(1);

      if (!banner) {
        set.status = 404;
        return { error: "Banner not found" };
      }
      return { banner };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Get banner by ID", tags: ["Admin"] },
    }
  )

  .post(
    "/banners",
    async ({ body, set }) => {
      const [banner] = await db
        .insert(banners)
        .values({
          title: body.title,
          subtitle: body.subtitle ?? null,
          imageUrl: body.imageUrl ?? null,
          ctaLabel: body.ctaLabel ?? null,
          ctaHref: body.ctaHref ?? null,
          status: (body.status as any) ?? "draft",
          sortOrder: body.sortOrder ?? 0,
        })
        .returning();

      set.status = 201;
      return { banner };
    },
    {
      body: t.Object({
        title: t.String({ minLength: 2 }),
        subtitle: t.Optional(t.String()),
        imageUrl: t.Optional(t.String()),
        ctaLabel: t.Optional(t.String()),
        ctaHref: t.Optional(t.String()),
        status: t.Optional(t.Union([t.Literal("active"), t.Literal("draft")])),
        sortOrder: t.Optional(t.Number()),
      }),
      detail: { summary: "Create a banner", tags: ["Admin"] },
    }
  )

  .patch(
    "/banners/:id",
    async ({ params, body, set }) => {
      const [existing] = await db
        .select({ id: banners.id })
        .from(banners)
        .where(eq(banners.id, params.id))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Banner not found" };
      }

      const [banner] = await db
        .update(banners)
        .set({ ...body, updatedAt: new Date() })
        .where(eq(banners.id, params.id))
        .returning();

      return { banner };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(
        t.Object({
          title: t.String({ minLength: 2 }),
          subtitle: t.String(),
          imageUrl: t.String(),
          ctaLabel: t.String(),
          ctaHref: t.String(),
          status: t.Union([t.Literal("active"), t.Literal("draft")]),
          sortOrder: t.Number(),
        })
      ),
      detail: { summary: "Update a banner", tags: ["Admin"] },
    }
  )

  .delete(
    "/banners/:id",
    async ({ params, set }) => {
      const [existing] = await db
        .select({ id: banners.id })
        .from(banners)
        .where(eq(banners.id, params.id))
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Banner not found" };
      }

      await db.delete(banners).where(eq(banners.id, params.id));
      return { message: "Banner deleted" };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Delete a banner", tags: ["Admin"] },
    }
  );
