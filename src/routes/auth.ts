import { Elysia, t } from "elysia";
import { hash, compare } from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { db } from "../db";
import { users, sessions } from "../db/schema";
import { eq, and, isNull, gt } from "drizzle-orm";
import { jwtPlugin, authGuard } from "../middleware/auth";

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function generateRefreshToken() {
  return randomBytes(48).toString("hex");
}

function hashRefreshToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

async function createSession(
  userId: string,
  userAgent: string | undefined,
  ipAddress: string | undefined
) {
  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

  const [session] = await db
    .insert(sessions)
    .values({
      userId,
      refreshTokenHash,
      userAgent: userAgent?.slice(0, 512),
      ipAddress: ipAddress?.slice(0, 64),
      expiresAt,
    })
    .returning({ id: sessions.id });

  return { refreshToken, sessionId: session.id };
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // ─── Register ────────────────────────────────────────
  .post(
    "/register",
    async ({ body, jwt, set, headers, server, request }) => {
      const { email, password, name, phone, role } = body;

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (existing) {
        set.status = 409;
        return { error: "An account with this email already exists" };
      }

      const passwordHash = await hash(password, 12);

      const [newUser] = await db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          name,
          phone: phone || null,
          passwordHash,
          role,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
        });

      const ip = server?.requestIP(request)?.address;
      const { refreshToken, sessionId } = await createSession(
        newUser.id,
        headers["user-agent"],
        ip
      );

      const accessToken = await jwt.sign({
        sub: newUser.id,
        email: newUser.email,
        role: newUser.role,
      });

      return {
        user: newUser,
        accessToken,
        refreshToken,
        sessionId,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String({ minLength: 8 }),
        name: t.String({ minLength: 2 }),
        phone: t.Optional(t.String()),
        role: t.Union([t.Literal("buyer"), t.Literal("supplier")]),
      }),
      detail: { summary: "Register a new user", tags: ["Auth"] },
    }
  )

  // ─── Login ───────────────────────────────────────────
  .post(
    "/login",
    async ({ body, jwt, set, headers, server, request }) => {
      const { email, password } = body;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);

      if (!user) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      const valid = await compare(password, user.passwordHash);
      if (!valid) {
        set.status = 401;
        return { error: "Invalid email or password" };
      }

      if (!user.isActive) {
        set.status = 403;
        return { error: "Your account has been deactivated" };
      }

      const ip = server?.requestIP(request)?.address;
      const { refreshToken, sessionId } = await createSession(
        user.id,
        headers["user-agent"],
        ip
      );

      const accessToken = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return {
        user: {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
          image: user.image,
          phone: user.phone,
        },
        accessToken,
        refreshToken,
        sessionId,
      };
    },
    {
      body: t.Object({
        email: t.String({ format: "email" }),
        password: t.String(),
      }),
      detail: { summary: "Login with email and password", tags: ["Auth"] },
    }
  )

  // ─── Refresh Token ───────────────────────────────────
  .post(
    "/refresh",
    async ({ body, jwt, set }) => {
      const { refreshToken } = body;
      const tokenHash = hashRefreshToken(refreshToken);

      const [session] = await db
        .select()
        .from(sessions)
        .where(
          and(
            eq(sessions.refreshTokenHash, tokenHash),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date())
          )
        )
        .limit(1);

      if (!session) {
        set.status = 401;
        return { error: "Invalid or expired refresh token" };
      }

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          isActive: users.isActive,
        })
        .from(users)
        .where(eq(users.id, session.userId))
        .limit(1);

      if (!user || !user.isActive) {
        await db
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(eq(sessions.id, session.id));
        set.status = 401;
        return { error: "User not found or deactivated" };
      }

      // Rotate refresh token
      const newRefreshToken = generateRefreshToken();
      const newHash = hashRefreshToken(newRefreshToken);
      const newExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);

      await db
        .update(sessions)
        .set({
          refreshTokenHash: newHash,
          lastUsedAt: new Date(),
          expiresAt: newExpiresAt,
        })
        .where(eq(sessions.id, session.id));

      const accessToken = await jwt.sign({
        sub: user.id,
        email: user.email,
        role: user.role,
      });

      return {
        accessToken,
        refreshToken: newRefreshToken,
        sessionId: session.id,
      };
    },
    {
      body: t.Object({ refreshToken: t.String({ minLength: 32 }) }),
      detail: { summary: "Rotate a refresh token for a new access token", tags: ["Auth"] },
    }
  )

  // ─── Logout (revoke current session) ─────────────────
  .post(
    "/logout",
    async ({ body }) => {
      const { refreshToken } = body;
      const tokenHash = hashRefreshToken(refreshToken);

      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.refreshTokenHash, tokenHash), isNull(sessions.revokedAt)));

      return { ok: true };
    },
    {
      body: t.Object({ refreshToken: t.String({ minLength: 32 }) }),
      detail: { summary: "Revoke the current session", tags: ["Auth"] },
    }
  )

  // ─── Protected routes (below) ────────────────────────
  .use(authGuard)

  .get(
    "/me",
    ({ user }) => ({ user }),
    { detail: { summary: "Get current authenticated user", tags: ["Auth"] } }
  )

  .get(
    "/sessions",
    async ({ user }) => {
      const list = await db
        .select({
          id: sessions.id,
          userAgent: sessions.userAgent,
          ipAddress: sessions.ipAddress,
          createdAt: sessions.createdAt,
          lastUsedAt: sessions.lastUsedAt,
          expiresAt: sessions.expiresAt,
        })
        .from(sessions)
        .where(
          and(
            eq(sessions.userId, user.id),
            isNull(sessions.revokedAt),
            gt(sessions.expiresAt, new Date())
          )
        );
      return { sessions: list };
    },
    { detail: { summary: "List active sessions for the current user", tags: ["Auth"] } }
  )

  .post(
    "/logout-all",
    async ({ user }) => {
      await db
        .update(sessions)
        .set({ revokedAt: new Date() })
        .where(and(eq(sessions.userId, user.id), isNull(sessions.revokedAt)));
      return { ok: true };
    },
    { detail: { summary: "Revoke all sessions for the current user", tags: ["Auth"] } }
  );
