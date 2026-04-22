import { Elysia, t } from "elysia";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { authGuard } from "../middleware/auth";

export const profileRoutes = new Elysia({ prefix: "/profile" })
  .use(authGuard)

  // ─── Get Profile ─────────────────────────────────────
  .get(
    "/",
    async ({ user }) => {
      const [profile] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          phone: users.phone,
          role: users.role,
          image: users.image,
          businessName: users.businessName,
          businessType: users.businessType,
          specialization: users.specialization,
          taxId: users.taxId,
          emailVerified: users.emailVerified,
          createdAt: users.createdAt,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      return { profile };
    },
    {
      detail: {
        summary: "Get current user profile",
        tags: ["Profile"],
      },
    }
  )

  // ─── Update Profile ──────────────────────────────────
  .patch(
    "/",
    async ({ body, user }) => {
      const [updated] = await db
        .update(users)
        .set({
          ...body,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          phone: users.phone,
          role: users.role,
          image: users.image,
          businessName: users.businessName,
          businessType: users.businessType,
          specialization: users.specialization,
          taxId: users.taxId,
        });

      return { profile: updated };
    },
    {
      body: t.Partial(
        t.Object({
          name: t.String({ minLength: 2 }),
          phone: t.String(),
          image: t.String(),
          businessName: t.String(),
          businessType: t.String(),
          specialization: t.String(),
          taxId: t.String(),
        })
      ),
      detail: {
        summary: "Update current user profile",
        tags: ["Profile"],
      },
    }
  );
