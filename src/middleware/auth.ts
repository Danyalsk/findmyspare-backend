import { Elysia, t } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

// ─── JWT Auth Plugin ─────────────────────────────────
// Provides jwt.sign() and jwt.verify() to all routes that use this plugin
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: process.env.JWT_SECRET || "fallback-secret-change-me",
    exp: "15m",
  })
);

// ─── Auth Guard Plugin ───────────────────────────────
// Derives the authenticated user from the Authorization header.
// Routes using this plugin will have `user` available in the context.
export const authGuard = new Elysia({ name: "authGuard" })
  .use(jwtPlugin)
  .derive({ as: "global" }, async ({ jwt, headers, set }) => {
    const authorization = headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      set.status = 401;
      throw new Error("Unauthorized: Missing or invalid token");
    }

    const token = authorization.split(" ")[1];

    const payload = await jwt.verify(token);
    if (!payload) {
      set.status = 401;
      throw new Error("Unauthorized: Invalid or expired token");
    }

    // Fetch user from DB to ensure they still exist and get latest data
    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        phone: users.phone,
        image: users.image,
        businessName: users.businessName,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, payload.sub as string))
      .limit(1);

    if (!user || !user.isActive) {
      set.status = 401;
      throw new Error("Unauthorized: User not found or deactivated");
    }

    return { user };
  });

// ─── Role Guard Helper ───────────────────────────────
// Use after authGuard to restrict access to a specific role
export const requireRole = (role: "buyer" | "supplier") =>
  new Elysia({ name: `requireRole:${role}` })
    .use(authGuard)
    .onBeforeHandle({ as: "global" }, ({ user, set }) => {
      if (user.role !== role) {
        set.status = 403;
        throw new Error(
          `Forbidden: This action requires the '${role}' role`
        );
      }
    });
