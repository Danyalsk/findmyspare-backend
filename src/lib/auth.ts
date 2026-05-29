import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { bearer, emailOTP } from "better-auth/plugins";
import { db } from "../db";
import { users, authSessions, authAccounts, authVerifications } from "../db/schema";
import { sendOtpEmail, sendPasswordResetEmail } from "./email";

const NODE_ENV = process.env.NODE_ENV || "development";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const BACKEND_URL = process.env.BACKEND_URL || `http://localhost:${process.env.PORT || "8000"}`;

const PROD_EXTRA_ORIGINS = (process.env.PROD_EXTRA_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const trustedOrigins =
  NODE_ENV === "production"
    ? [FRONTEND_URL, ...PROD_EXTRA_ORIGINS]
    : [FRONTEND_URL, "http://localhost:3000", "http://localhost:3001", "http://localhost:5001"];

const SECRET = process.env.BETTER_AUTH_SECRET || process.env.JWT_SECRET;
if (!SECRET && NODE_ENV === "production") {
  throw new Error("BETTER_AUTH_SECRET must be set in production");
}

// 30-day sessions, matching the previous refresh-token TTL.
const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30;

// ─── Demo / QA logins ────────────────────────────────
// Fixed-OTP accounts so you can sign in without a real inbox (demos, testing).
// Their OTP is always the value below and NO email is sent. Seed the matching
// user rows with `bun run src/scripts/seed-demo.ts`.
// ⚠️ This is a backdoor — OFF by default. Enable per-environment with DEMO_LOGIN=1
// (e.g. local .env for testing). Leave it UNSET in production for public launch.
const DEMO_LOGINS: Record<string, string> = {
  "demo.supplier@findmyspare.com": "123456",
  "demo.buyer@findmyspare.com": "123456",
};
const DEMO_ENABLED = process.env.DEMO_LOGIN === "1";
function demoOtpFor(email: string): string | undefined {
  if (!DEMO_ENABLED) return undefined;
  return DEMO_LOGINS[email.toLowerCase()];
}

export const auth = betterAuth({
  secret: SECRET || "dev-only-secret-change-me",
  baseURL: BACKEND_URL,
  basePath: "/api/auth",
  trustedOrigins,

  // Map BetterAuth's models onto our Drizzle tables. `user` reuses the existing
  // `users` table so all domain FKs (uuid users.id) stay intact.
  database: drizzleAdapter(db, {
    provider: "pg",
    schema: {
      user: users,
      session: authSessions,
      account: authAccounts,
      verification: authVerifications,
    },
  }),

  // Let the DB default (uuid defaultRandom) fill ids — matches `users`.
  advanced: {
    database: { generateId: false },
  },

  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    requireEmailVerification: false,
    sendResetPassword: async ({ user, token }) => {
      await sendPasswordResetEmail(user.email, user.name ?? "there", token);
    },
  },

  session: {
    expiresIn: SESSION_TTL_SECONDS,
    updateAge: 60 * 60 * 24, // refresh expiry at most once per day
  },

  // BetterAuth enables rate limiting in production by default with tight limits,
  // which produced "Too many requests" on resend. Loosen it; the 30s resend
  // cooldown in the UI already prevents abuse.
  rateLimit: {
    enabled: true,
    window: 60,
    max: 60,
    customRules: {
      "/email-otp/send-verification-otp": { window: 300, max: 10 }, // ~one per 30s
      "/sign-in/email-otp": { window: 300, max: 20 }, // generous verify attempts
    },
  },

  // Domain columns already present on `users`. Declared here so BetterAuth
  // reads/returns them on the session user. `input: false` = server-managed
  // (set via our own routes/migrations, not via the auth API).
  user: {
    additionalFields: {
      role: { type: "string", required: false, defaultValue: "buyer", input: false },
      phone: { type: "string", required: false, input: false },
      phoneVerified: { type: "boolean", required: false, defaultValue: false, input: false },
      profileCompleted: { type: "boolean", required: false, defaultValue: false, input: false },
      businessName: { type: "string", required: false, input: false },
      verificationStatus: { type: "string", required: false, defaultValue: "not_submitted", input: false },
      isActive: { type: "boolean", required: false, defaultValue: true, input: false },
      city: { type: "string", required: false, input: false },
      pincode: { type: "string", required: false, input: false },
    },
  },

  plugins: [
    // Passwordless email login (find-or-creates the user on first verify).
    emailOTP({
      otpLength: 6,
      expiresIn: 60 * 10, // 10 minutes — code stays valid well past the UI countdown
      allowedAttempts: 5,
      // Resending re-sends the SAME code and extends its expiry (no new code),
      // so a user who clicks "Resend" isn't locked out by a changed OTP.
      resendStrategy: "reuse",
      // Demo accounts get a fixed code; everyone else a random one.
      generateOTP: ({ email }) => demoOtpFor(email),
      // Do not await — avoids timing leaks; Resend send is fire-and-forget.
      // Skip the real email for demo accounts (their code is fixed + known).
      sendVerificationOTP: async ({ email, otp }) => {
        if (demoOtpFor(email)) {
          console.log(`[auth/email-otp] demo login for ${email} (OTP ${otp}) — email skipped`);
          return;
        }
        sendOtpEmail(email, otp).catch((e) =>
          console.error("[auth/email-otp] send failed:", e)
        );
      },
    }),
    // Accept + rotate the session token via the Authorization header so the web
    // client keeps the localStorage bearer model.
    bearer(),
  ],
});

export type AuthSession = typeof auth.$Infer.Session;
