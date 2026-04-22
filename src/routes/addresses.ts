import { Elysia, t } from "elysia";
import { db } from "../db";
import { addresses } from "../db/schema";
import { eq, and } from "drizzle-orm";
import { authGuard } from "../middleware/auth";

export const addressRoutes = new Elysia({ prefix: "/addresses" })
  .use(authGuard)

  // ─── List Addresses ──────────────────────────────────
  .get(
    "/",
    async ({ user }) => {
      const items = await db
        .select()
        .from(addresses)
        .where(eq(addresses.userId, user.id))
        .orderBy(addresses.createdAt);

      return { addresses: items };
    },
    {
      detail: {
        summary: "List all addresses for current user",
        tags: ["Addresses"],
      },
    }
  )

  // ─── Add Address ─────────────────────────────────────
  .post(
    "/",
    async ({ body, user, set }) => {
      // If this is marked as default, unset other defaults
      if (body.isDefault) {
        await db
          .update(addresses)
          .set({ isDefault: false })
          .where(eq(addresses.userId, user.id));
      }

      const [address] = await db
        .insert(addresses)
        .values({
          userId: user.id,
          label: body.label,
          line1: body.line1,
          line2: body.line2,
          city: body.city,
          state: body.state,
          postalCode: body.postalCode,
          country: body.country || "India",
          phone: body.phone,
          isDefault: body.isDefault ?? false,
        })
        .returning();

      set.status = 201;
      return { address };
    },
    {
      body: t.Object({
        label: t.Optional(t.String()),
        line1: t.String({ minLength: 5 }),
        line2: t.Optional(t.String()),
        city: t.String({ minLength: 2 }),
        state: t.String({ minLength: 2 }),
        postalCode: t.String({ minLength: 4 }),
        country: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        isDefault: t.Optional(t.Boolean()),
      }),
      detail: {
        summary: "Add a new address",
        tags: ["Addresses"],
      },
    }
  )

  // ─── Update Address ──────────────────────────────────
  .patch(
    "/:id",
    async ({ params, body, user, set }) => {
      const [existing] = await db
        .select()
        .from(addresses)
        .where(
          and(eq(addresses.id, params.id), eq(addresses.userId, user.id))
        )
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Address not found" };
      }

      // If setting as default, unset others
      if (body.isDefault) {
        await db
          .update(addresses)
          .set({ isDefault: false })
          .where(eq(addresses.userId, user.id));
      }

      const [updated] = await db
        .update(addresses)
        .set(body)
        .where(eq(addresses.id, params.id))
        .returning();

      return { address: updated };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Partial(
        t.Object({
          label: t.String(),
          line1: t.String(),
          line2: t.String(),
          city: t.String(),
          state: t.String(),
          postalCode: t.String(),
          country: t.String(),
          phone: t.String(),
          isDefault: t.Boolean(),
        })
      ),
      detail: {
        summary: "Update an address",
        tags: ["Addresses"],
      },
    }
  )

  // ─── Delete Address ──────────────────────────────────
  .delete(
    "/:id",
    async ({ params, user, set }) => {
      const [existing] = await db
        .select()
        .from(addresses)
        .where(
          and(eq(addresses.id, params.id), eq(addresses.userId, user.id))
        )
        .limit(1);

      if (!existing) {
        set.status = 404;
        return { error: "Address not found" };
      }

      await db.delete(addresses).where(eq(addresses.id, params.id));

      return { message: "Address deleted successfully" };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: {
        summary: "Delete an address",
        tags: ["Addresses"],
      },
    }
  );
