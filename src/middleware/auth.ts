import { Elysia } from "elysia";
import { jwt } from "@elysiajs/jwt";
import { jwtVerify } from "jose";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth";
import { db } from "../db";
import { users } from "../db/schema";

const JWT_SECRET = process.env.JWT_SECRET;
const legacyJwtKey = new TextEncoder().encode(JWT_SECRET || "dev-only-secret-change-me");

// Legacy fallback: verify an old-style stateless JWT (issued by the deprecated
// /auth/* routes the Expo app still uses) and load the user. Returns null for
// anything that isn't a valid legacy token so the BetterAuth path stays primary.
async function resolveLegacyJwtUser(request: Request) {
  const authz = request.headers.get("authorization");
  if (!authz?.startsWith("Bearer ")) return null;
  try {
    const { payload } = await jwtVerify(authz.slice(7), legacyJwtKey);
    const sub = payload.sub;
    if (typeof sub !== "string") return null;
    const [u] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        role: users.role,
        phone: users.phone,
        image: users.image,
        businessName: users.businessName,
        verificationStatus: users.verificationStatus,
        profileCompleted: users.profileCompleted,
        isActive: users.isActive,
      })
      .from(users)
      .where(eq(users.id, sub))
      .limit(1);
    return u ?? null;
  } catch {
    return null;
  }
}

// ─── Legacy JWT Plugin ───────────────────────────────
// Still used by the DEPRECATED /auth/* routes that the Expo mobile app calls
// (register/login/refresh/otp/magic). New web auth runs through BetterAuth at
// /api/auth/*. Remove this once mobile migrates.
export const jwtPlugin = new Elysia({ name: "jwt" }).use(
  jwt({
    name: "jwt",
    secret: JWT_SECRET || "dev-only-secret-change-me",
    exp: "15m",
  })
);

// ─── Auth Guard Plugin ───────────────────────────────
// Validates the BetterAuth session (bearer token) on every protected route and
// derives `{ user }`. Replaces the old stateless-JWT verify: because the token
// maps to a DB session row, signing out deletes the row and the token dies
// immediately — there is no lingering access-token window.
//
// The guard ALSO enforces the one-time profile completion. After OTP sign-up a
// user has `profileCompleted = false`; until they finish the profile form
// (POST /auth/complete-profile) every protected route returns 403
// PROFILE_INCOMPLETE. Admins are exempt (they never run the OTP profile flow),
// and the endpoints needed to complete the profile / manage the session are
// allow-listed so the user can actually get unstuck.
const PROFILE_GATE_EXEMPT = new Set([
  "/auth/complete-profile",
  "/auth/become-supplier",
  "/auth/me",
  "/auth/sessions",
  "/auth/logout-all",
]);

export const authGuard = new Elysia({ name: "authGuard" })
  // Global so the derived `user` reaches role-guard hooks + handlers. NOTE: this
  // means any route in the SAME plugin instance that uses authGuard gets the 401
  // check — so keep PUBLIC routes (e.g. product browse) in their own plugin that
  // never imports authGuard (see publicProductRoutes), exactly like /health.
  .derive({ as: "global" }, async ({ request, set }) => {
    // Primary: BetterAuth session (web bearer token → DB-backed session row).
    const session = await auth.api.getSession({ headers: request.headers });
    // Fallback: legacy stateless JWT (Expo mobile, deprecated path).
    const user = session?.user ?? (await resolveLegacyJwtUser(request));

    if (!user) {
      set.status = 401;
      throw new Error("Unauthorized: Missing or invalid token");
    }
    if (user.isActive === false) {
      set.status = 401;
      throw new Error("Unauthorized: User not found or deactivated");
    }

    return { user };
  })
  .onBeforeHandle({ as: "scoped" }, ({ user, path, set }) => {
    if (!user) return; // unreachable — derive throws first; satisfies types
    const isAdmin = user.role === "admin" || user.role === "super_admin";
    if (!isAdmin && !user.profileCompleted && !PROFILE_GATE_EXEMPT.has(path)) {
      set.status = 403;
      throw new Error("Forbidden: PROFILE_INCOMPLETE");
    }
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
