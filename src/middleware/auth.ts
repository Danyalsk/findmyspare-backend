import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = process.env.JWT_SECRET;
if (!JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error("JWT_SECRET must be set in production");
}

// ─── JWT Auth Plugin ─────────────────────────────────
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: JWT_SECRET || "dev-only-secret-change-me",
    exp: "15m",
  })
);

// ─── Auth Guard Plugin ───────────────────────────────
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

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        phone: users.phone,
        image: users.image,
        businessName: users.businessName,
        verificationStatus: users.verificationStatus,
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
export const requireRole = (role: "buyer" | "supplier" | "admin" | "super_admin") =>
  new Elysia({ name: `requireRole:${role}` })
    .use(authGuard)
    // `as: "scoped"` — guard applies only to routes registered after
    // `.use(requireRole(...))` within the same plugin/subtree. Using "global"
    // here leaks the role check into every other route in the parent app.
    .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
      if (user.role !== role) {
        set.status = 403;
        throw new Error(`Forbidden: This action requires the '${role}' role`);
      }
    });

// Admin pages and routes accept both regular admin and super_admin tiers.
// Destructive / config endpoints use `requireSuperAdmin` instead.
export const requireAdmin = new Elysia({ name: "requireAdmin" })
  .use(authGuard)
  .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
    if (user.role !== "admin" && user.role !== "super_admin") {
      set.status = 403;
      throw new Error("Forbidden: admin role required");
    }
  });

export const requireSuperAdmin = new Elysia({ name: "requireSuperAdmin" })
  .use(authGuard)
  .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
    if (user.role !== "super_admin") {
      set.status = 403;
      throw new Error("Forbidden: super_admin role required");
    }
  });

// Approved supplier guard — used by supplier-only protected actions
// (e.g., creating products, submitting bids). Pending/rejected suppliers
// can still call onboarding endpoints but not these.
export const requireApprovedSupplier = new Elysia({ name: "requireApprovedSupplier" })
  .use(authGuard)
  // See comment above: scoped, not global, to avoid leaking into siblings.
  .onBeforeHandle({ as: "scoped" }, ({ user, set }) => {
    if (user.role !== "supplier") {
      set.status = 403;
      throw new Error("Forbidden: Supplier role required");
    }
    if (user.verificationStatus !== "approved") {
      set.status = 403;
      throw new Error("Forbidden: Supplier verification not approved");
    }
  });
