import { Elysia, t } from "elysia";
import { hash, compare } from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { db } from "../db";
import {
  users,
  sessions,
  emailVerificationTokens,
  passwordResetTokens,
  loginOtps,
  magicLoginTokens,
  orders,
} from "../db/schema";
import { eq, and, isNull, gt, desc, notInArray } from "drizzle-orm";
import { jwtPlugin, authGuard } from "../middleware/auth";
import { rateLimit, rateLimitKey } from "../lib/rate-limit";
import { normalizeIndianPhone, isValidE164 } from "../lib/phone";
import {
  sendVerificationEmail,
  sendPasswordResetEmail,
  sendOtpEmail,
} from "../lib/email";
import { sendWhatsAppOtp } from "../lib/whatsapp-otp";

const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
const OTP_MAX_ATTEMPTS = 5;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function generate6DigitCode(): string {
  // 6-digit, no leading-zero loss
  return String(Math.floor(100000 + (randomBytes(4).readUInt32BE(0) % 900000)));
}

const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000; // 24h
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000; // 1h

function generateOpaqueToken(): string {
  return randomBytes(48).toString("hex");
}

function sha256(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

async function createSession(
  userId: string,
  userAgent: string | undefined,
  ipAddress: string | undefined
) {
  const refreshToken = generateOpaqueToken();
  const refreshTokenHash = sha256(refreshToken);
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

// Elysia's `set` is loosely typed; the route handlers pass it through.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type ElysiaSet = any;

function fail(set: ElysiaSet, status: number, error: string) {
  set.status = status;
  return { error };
}

function publicUser(u: typeof users.$inferSelect) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    role: u.role,
    image: u.image,
    phone: u.phone,
    phoneVerified: u.phoneVerified,
    emailVerified: u.emailVerified,
    profileCompleted: u.profileCompleted,
    verificationStatus: u.verificationStatus,
    businessName: u.businessName,
  };
}

// Issue a full auth payload (access + refresh + session) for a user row.
async function issueAuth(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  jwt: any,
  user: typeof users.$inferSelect,
  userAgent: string | undefined,
  ip: string | undefined
) {
  const { refreshToken, sessionId } = await createSession(user.id, userAgent, ip);
  const accessToken = await jwt.sign({
    sub: user.id,
    email: user.email,
    role: user.role,
  });
  await db
    .update(users)
    .set({ lastLoginAt: new Date(), lastLoginIp: ip?.slice(0, 64) ?? null })
    .where(eq(users.id, user.id));
  return {
    user: publicUser(user),
    accessToken,
    refreshToken,
    sessionId,
    isNewUser: !user.profileCompleted,
  };
}

async function checkRateLimit(
  set: ElysiaSet,
  request: Request,
  bucket: string,
  max: number,
  windowMs: number,
  suffix?: string
): Promise<{ error: string } | null> {
  const key = rateLimitKey(request, bucket, suffix);
  const r = rateLimit(key, max, windowMs);
  if (!r.ok) {
    set.status = 429;
    set.headers["retry-after"] = String(Math.ceil(r.resetMs / 1000));
    return { error: "Too many requests. Try again shortly." };
  }
  return null;
}

export const authRoutes = new Elysia({ prefix: "/auth" })
  .use(jwtPlugin)

  // ─── Register ────────────────────────────────────────
  .post(
    "/register",
    async ({ body, jwt, set, headers, server, request }) => {
      const rl = await checkRateLimit(set, request, "auth:register", 5, 60_000);
      if (rl) return rl;

      const { email, password, name, phone, role } = body;
      const normalizedPhone = phone ? normalizeIndianPhone(phone) : null;
      if (phone && !normalizedPhone) {
        return fail(set, 400, "Phone number must be a valid Indian mobile number");
      }

      const [existing] = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (existing) return fail(set, 409, "An account with this email already exists");

      if (normalizedPhone) {
        const [phoneTaken] = await db
          .select({ id: users.id })
          .from(users)
          .where(eq(users.phone, normalizedPhone))
          .limit(1);
        if (phoneTaken) return fail(set, 409, "An account with this phone already exists");
      }

      const passwordHash = await hash(password, 12);

      const [newUser] = await db
        .insert(users)
        .values({
          email: email.toLowerCase(),
          name,
          phone: normalizedPhone,
          passwordHash,
          role,
          // Legacy/mobile register captures the full profile (name+role+phone),
          // so it satisfies the profile gate immediately.
          profileCompleted: true,
        })
        .returning({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          phone: users.phone,
        });

      // Fire-and-forget email verification token.
      const verifyToken = generateOpaqueToken();
      await db.insert(emailVerificationTokens).values({
        userId: newUser.id,
        tokenHash: sha256(verifyToken),
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      });
      sendVerificationEmail(newUser.email ?? "", newUser.name ?? "there", verifyToken).catch((e) =>
        console.error("[auth/register] verify email failed:", e)
      );

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

      return { user: newUser, accessToken, refreshToken, sessionId };
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
      const rl = await checkRateLimit(set, request, "auth:login", 5, 60_000, body.email.toLowerCase());
      if (rl) return rl;

      const { email, password } = body;

      const [user] = await db
        .select()
        .from(users)
        .where(eq(users.email, email.toLowerCase()))
        .limit(1);
      if (!user) return fail(set, 401, "Invalid email or password");
      // OTP-first accounts have no password — they must use OTP login.
      if (!user.passwordHash) return fail(set, 401, "Use the OTP login for this account");

      const valid = await compare(password, user.passwordHash);
      if (!valid) return fail(set, 401, "Invalid email or password");
      if (!user.isActive) {
        const reason = user.banReason ? `: ${user.banReason}` : "";
        return fail(set, 403, `Your account has been deactivated${reason}`);
      }
      if (user.deletedAt) return fail(set, 403, "This account no longer exists");

      const ip = server?.requestIP(request)?.address;
      const { refreshToken, sessionId } = await createSession(
        user.id,
        headers["user-agent"],
        ip
      );
      await db
        .update(users)
        .set({ lastLoginAt: new Date(), lastLoginIp: ip?.slice(0, 64) ?? null })
        .where(eq(users.id, user.id));

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
          phoneVerified: user.phoneVerified,
          emailVerified: user.emailVerified,
          verificationStatus: user.verificationStatus,
          businessName: user.businessName,
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
    async ({ body, jwt, set, request }) => {
      const rl = await checkRateLimit(set, request, "auth:refresh", 30, 60_000);
      if (rl) return rl;

      const { refreshToken } = body;
      const tokenHash = sha256(refreshToken);

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
      if (!session) return fail(set, 401, "Invalid or expired refresh token");

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
        return fail(set, 401, "User not found or deactivated");
      }

      const newRefreshToken = generateOpaqueToken();
      const newHash = sha256(newRefreshToken);
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

      return { accessToken, refreshToken: newRefreshToken, sessionId: session.id };
    },
    {
      body: t.Object({ refreshToken: t.String({ minLength: 32 }) }),
      detail: { summary: "Rotate a refresh token", tags: ["Auth"] },
    }
  )

  // ─── Logout ──────────────────────────────────────────
  .post(
    "/logout",
    async ({ body }) => {
      const tokenHash = sha256(body.refreshToken);
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

  // ─── Email Verification ──────────────────────────────
  .post(
    "/send-verification",
    async ({ body, set, request }) => {
      const rl = await checkRateLimit(set, request, "auth:send-verification", 3, 5 * 60_000);
      if (rl) return rl;

      const email = body.email.toLowerCase();
      const [u] = await db
        .select({ id: users.id, name: users.name, emailVerified: users.emailVerified })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      // Always return ok to avoid email enumeration.
      if (!u || u.emailVerified) return { ok: true };

      const token = generateOpaqueToken();
      await db.insert(emailVerificationTokens).values({
        userId: u.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + EMAIL_VERIFY_TTL_MS),
      });
      sendVerificationEmail(email, u.name ?? "there", token).catch((e) =>
        console.error("[auth/send-verification] failed:", e)
      );
      return { ok: true };
    },
    {
      body: t.Object({ email: t.String({ format: "email" }) }),
      detail: { summary: "Send (or resend) an email verification link", tags: ["Auth"] },
    }
  )

  .post(
    "/verify-email",
    async ({ body, set }) => {
      const tokenHash = sha256(body.token);
      const [row] = await db
        .select()
        .from(emailVerificationTokens)
        .where(
          and(
            eq(emailVerificationTokens.tokenHash, tokenHash),
            isNull(emailVerificationTokens.consumedAt),
            gt(emailVerificationTokens.expiresAt, new Date())
          )
        )
        .limit(1);
      if (!row) return fail(set, 400, "Invalid or expired verification token");

      await db.transaction(async (tx) => {
        await tx
          .update(emailVerificationTokens)
          .set({ consumedAt: new Date() })
          .where(eq(emailVerificationTokens.id, row.id));
        await tx
          .update(users)
          .set({ emailVerified: true, updatedAt: new Date() })
          .where(eq(users.id, row.userId));
      });
      return { ok: true };
    },
    {
      body: t.Object({ token: t.String({ minLength: 32 }) }),
      detail: { summary: "Confirm an email verification token", tags: ["Auth"] },
    }
  )

  // ─── Password Reset ──────────────────────────────────
  .post(
    "/forgot-password",
    async ({ body, set, request, server }) => {
      const rl = await checkRateLimit(set, request, "auth:forgot", 5, 60 * 60_000);
      if (rl) return rl;

      const email = body.email.toLowerCase();
      const [u] = await db
        .select({ id: users.id, name: users.name })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);
      // Always return ok to avoid email enumeration.
      if (!u) return { ok: true };

      const token = generateOpaqueToken();
      const ip = server?.requestIP(request)?.address;
      await db.insert(passwordResetTokens).values({
        userId: u.id,
        tokenHash: sha256(token),
        expiresAt: new Date(Date.now() + PASSWORD_RESET_TTL_MS),
        ipAddress: ip?.slice(0, 64) ?? null,
      });
      sendPasswordResetEmail(email, u.name ?? "there", token).catch((e) =>
        console.error("[auth/forgot] reset email failed:", e)
      );
      return { ok: true };
    },
    {
      body: t.Object({ email: t.String({ format: "email" }) }),
      detail: { summary: "Request a password reset link", tags: ["Auth"] },
    }
  )

  .post(
    "/reset-password",
    async ({ body, set }) => {
      const tokenHash = sha256(body.token);
      const [row] = await db
        .select()
        .from(passwordResetTokens)
        .where(
          and(
            eq(passwordResetTokens.tokenHash, tokenHash),
            isNull(passwordResetTokens.consumedAt),
            gt(passwordResetTokens.expiresAt, new Date())
          )
        )
        .limit(1);
      if (!row) return fail(set, 400, "Invalid or expired reset token");

      const passwordHash = await hash(body.password, 12);
      await db.transaction(async (tx) => {
        await tx
          .update(passwordResetTokens)
          .set({ consumedAt: new Date() })
          .where(eq(passwordResetTokens.id, row.id));
        await tx
          .update(users)
          .set({ passwordHash, updatedAt: new Date() })
          .where(eq(users.id, row.userId));
        // Force re-login on all devices.
        await tx
          .update(sessions)
          .set({ revokedAt: new Date() })
          .where(and(eq(sessions.userId, row.userId), isNull(sessions.revokedAt)));
      });
      return { ok: true };
    },
    {
      body: t.Object({
        token: t.String({ minLength: 32 }),
        password: t.String({ minLength: 8 }),
      }),
      detail: { summary: "Reset password using a token", tags: ["Auth"] },
    }
  )

  // ─── Passwordless OTP — request a code ───────────────
  // identifier is an email (→ 6-digit code via Resend) or an Indian phone
  // (→ 6-digit code via WhatsApp). Phone path is dormant in v1 (email only).
  .post(
    "/otp/request",
    async ({ body, set, request }) => {
      const rl = await checkRateLimit(set, request, "auth:otp-request", 5, 60_000, body.identifier);
      if (rl) return rl;

      const raw = body.identifier.trim();
      if (EMAIL_RE.test(raw)) {
        const email = raw.toLowerCase();
        const code = generate6DigitCode();
        await db.insert(loginOtps).values({
          identifier: email,
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        });
        sendOtpEmail(email, code).catch((e) =>
          console.error("[auth/otp] email send failed:", e)
        );
        return { method: "email", identifier: email };
      }

      const phone = normalizeIndianPhone(raw);
      if (phone && isValidE164(phone)) {
        const code = generate6DigitCode();
        await db.insert(loginOtps).values({
          identifier: phone,
          codeHash: sha256(code),
          expiresAt: new Date(Date.now() + OTP_TTL_MS),
        });
        try {
          await sendWhatsAppOtp(phone, code);
        } catch (e) {
          console.error("[auth/otp] whatsapp send failed:", e);
          return fail(set, 502, "Could not send WhatsApp code. Try email instead.");
        }
        return { method: "phone", identifier: phone };
      }

      return fail(set, 400, "Enter a valid email or Indian mobile number");
    },
    {
      body: t.Object({ identifier: t.String({ minLength: 3 }) }),
      detail: { summary: "Request a login OTP (email code via Resend)", tags: ["Auth"] },
    }
  )

  // ─── Verify OTP (email code or WhatsApp phone code) ──
  // One path for both: code lives in login_otps, delivered via Resend (email)
  // or WhatsApp Cloud API (phone). Find-or-creates the user on success.
  .post(
    "/otp/verify",
    async ({ body, jwt, set, headers, server, request }) => {
      const rl = await checkRateLimit(set, request, "auth:otp-verify", 10, 5 * 60_000, body.identifier);
      if (rl) return rl;

      const raw = body.identifier.trim();
      const isEmail = EMAIL_RE.test(raw);
      const identifier = isEmail ? raw.toLowerCase() : normalizeIndianPhone(raw);
      if (!identifier) return fail(set, 400, "Invalid email or phone");

      const [row] = await db
        .select()
        .from(loginOtps)
        .where(
          and(
            eq(loginOtps.identifier, identifier),
            isNull(loginOtps.consumedAt),
            gt(loginOtps.expiresAt, new Date())
          )
        )
        .orderBy(desc(loginOtps.createdAt))
        .limit(1);

      if (!row) return fail(set, 400, "Code expired or not found. Request a new one.");
      if (row.attempts >= OTP_MAX_ATTEMPTS) {
        return fail(set, 429, "Too many attempts. Request a new code.");
      }
      if (row.codeHash !== sha256(body.code)) {
        await db
          .update(loginOtps)
          .set({ attempts: row.attempts + 1 })
          .where(eq(loginOtps.id, row.id));
        return fail(set, 401, "Incorrect code");
      }

      await db.update(loginOtps).set({ consumedAt: new Date() }).where(eq(loginOtps.id, row.id));

      // Find-or-create by the matching identifier column.
      const lookup = isEmail ? eq(users.email, identifier) : eq(users.phone, identifier);
      let [u] = await db.select().from(users).where(lookup).limit(1);
      if (!u) {
        [u] = await db
          .insert(users)
          .values(
            isEmail
              ? { email: identifier, emailVerified: true, role: "buyer", profileCompleted: false }
              : { phone: identifier, phoneVerified: true, role: "buyer", profileCompleted: false }
          )
          .returning();
      } else if (isEmail && !u.emailVerified) {
        await db.update(users).set({ emailVerified: true }).where(eq(users.id, u.id));
        u.emailVerified = true;
      } else if (!isEmail && !u.phoneVerified) {
        await db.update(users).set({ phoneVerified: true }).where(eq(users.id, u.id));
        u.phoneVerified = true;
      }

      if (!u.isActive) return fail(set, 403, "Your account has been deactivated");

      const ip = server?.requestIP(request)?.address;
      return issueAuth(jwt, u, headers["user-agent"], ip);
    },
    {
      body: t.Object({
        identifier: t.String({ minLength: 3 }),
        code: t.String({ minLength: 6, maxLength: 6 }),
      }),
      detail: { summary: "Verify an email or WhatsApp login OTP", tags: ["Auth"] },
    }
  )

  // ─── Magic login (one-click link from email) ────────
  .post(
    "/magic-login",
    async ({ body, jwt, set, headers, server, request }) => {
      const rl = await checkRateLimit(set, request, "auth:magic", 10, 5 * 60_000);
      if (rl) return rl;

      const tokenHash = sha256(body.token);
      const [row] = await db
        .select()
        .from(magicLoginTokens)
        .where(
          and(
            eq(magicLoginTokens.tokenHash, tokenHash),
            isNull(magicLoginTokens.consumedAt),
            gt(magicLoginTokens.expiresAt, new Date())
          )
        )
        .limit(1);
      if (!row) return fail(set, 400, "This login link is invalid or has expired. Use email OTP instead.");

      await db.update(magicLoginTokens).set({ consumedAt: new Date() }).where(eq(magicLoginTokens.id, row.id));

      const [u] = await db.select().from(users).where(eq(users.id, row.userId)).limit(1);
      if (!u || !u.isActive) return fail(set, 403, "Account not found or deactivated");

      const ip = server?.requestIP(request)?.address;
      return issueAuth(jwt, u, headers["user-agent"], ip);
    },
    {
      body: t.Object({ token: t.String({ minLength: 32 }) }),
      detail: { summary: "Log in via a one-click magic link", tags: ["Auth"] },
    }
  )

  // ─── Protected routes ────────────────────────────────
  .use(authGuard)

  // ─── One-time profile completion after first OTP signup ─
  // STRICT: the user cannot reach any protected route until this succeeds
  // (enforced server-side by authGuard's PROFILE_INCOMPLETE gate). Required:
  //   • name (≥2) + role            — always
  //   • phone                       — for email signups (user has no phone yet)
  //   • city + pincode              — for buyers
  // profileCompleted flips to true ONLY when every required field validates.
  .post(
    "/complete-profile",
    async ({ user, body, set }) => {
      const [current] = await db
        .select({
          profileCompleted: users.profileCompleted,
          role: users.role,
          phone: users.phone,
        })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);
      if (!current) return fail(set, 404, "User not found");

      const fields: Record<string, string> = {};

      // Role is NOT chosen here. The normal login door always yields a buyer;
      // suppliers are tagged via POST /auth/become-supplier before completion.
      const role = current.role;

      // Name — always required.
      const name = body.name?.trim() ?? "";
      if (name.length < 2) fields.name = "Enter your full name.";

      const updates: Partial<typeof users.$inferInsert> = {
        updatedAt: new Date(),
        name: name.length >= 2 ? name : undefined,
        role,
      };

      // Phone — required for email signups (no phone on file yet).
      let normalizedPhone = current.phone;
      if (!current.phone) {
        if (!body.phone?.trim()) {
          fields.phone = "Enter your mobile number.";
        } else {
          normalizedPhone = normalizeIndianPhone(body.phone);
          if (!normalizedPhone) {
            fields.phone = "Enter a valid Indian mobile number.";
          } else {
            const [taken] = await db
              .select({ id: users.id })
              .from(users)
              .where(eq(users.phone, normalizedPhone))
              .limit(1);
            if (taken && taken.id !== user.id) {
              fields.phone = "This phone number is already in use.";
            } else {
              updates.phone = normalizedPhone;
            }
          }
        }
      }

      // City + pincode — required for buyers.
      if (role === "buyer") {
        const city = body.city?.trim() ?? "";
        const pincode = body.pincode?.trim() ?? "";
        if (city.length < 2) fields.city = "Enter your city.";
        if (!/^\d{6}$/.test(pincode)) fields.pincode = "Enter a valid 6-digit pincode.";
        if (city.length >= 2) updates.city = city;
        if (/^\d{6}$/.test(pincode)) updates.pincode = pincode;
      }

      // Optional: phone-signup users may add an email (not required).
      if (body.email && !user.email) {
        const email = body.email.toLowerCase();
        const [taken] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
        if (taken && taken.id !== user.id) {
          fields.email = "This email is already in use.";
        } else {
          updates.email = email;
        }
      }

      if (Object.keys(fields).length > 0) {
        set.status = 422;
        return { error: "Please complete all required fields.", fields };
      }

      updates.profileCompleted = true;
      const [updated] = await db.update(users).set(updates).where(eq(users.id, user.id)).returning();
      return { user: publicUser(updated) };
    },
    {
      // Loose schema on purpose — the handler does friendly field-level
      // validation and returns 422 with per-field messages.
      body: t.Object({
        name: t.Optional(t.String()),
        email: t.Optional(t.String()),
        phone: t.Optional(t.String()),
        city: t.Optional(t.String()),
        pincode: t.Optional(t.String()),
      }),
      detail: { summary: "Complete the one-time profile after OTP signup", tags: ["Auth"] },
    }
  )

  // ─── Become a supplier (new signup or buyer upgrade) ─
  // The supplier login door calls this right after first OTP verify; a logged-in
  // buyer calls it from a "Become a supplier" CTA. It only flips the role —
  // GST/business details are still collected at /supplier/onboarding.
  .post(
    "/become-supplier",
    async ({ user, set }) => {
      if (user.role === "supplier") {
        // Idempotent — already a supplier.
        const [u] = await db.select().from(users).where(eq(users.id, user.id)).limit(1);
        return { user: publicUser(u) };
      }
      if (user.role === "admin" || user.role === "super_admin") {
        return fail(set, 403, "Admins cannot become suppliers");
      }

      // Block converting a buyer who still has live orders — role is per-account.
      const TERMINAL = ["delivered", "completed", "cancelled"] as const;
      const [active] = await db
        .select({ id: orders.id })
        .from(orders)
        .where(and(eq(orders.buyerId, user.id), notInArray(orders.status, [...TERMINAL])))
        .limit(1);
      if (active) {
        return fail(
          set,
          409,
          "Finish or cancel your active orders before becoming a supplier."
        );
      }

      const [updated] = await db
        .update(users)
        .set({ role: "supplier", updatedAt: new Date() })
        .where(eq(users.id, user.id))
        .returning();
      return { user: publicUser(updated) };
    },
    { detail: { summary: "Convert the current account to a supplier", tags: ["Auth"] } }
  )

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
