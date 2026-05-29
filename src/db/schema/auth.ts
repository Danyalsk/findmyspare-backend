import { pgTable, uuid, text, timestamp, boolean, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";

// ─── BetterAuth tables ───────────────────────────────
// BetterAuth owns these three tables. The `user` model is mapped onto the
// existing `users` table (see src/lib/auth.ts → drizzleAdapter schema), so we
// do NOT redefine it here — that keeps every domain FK (products, orders, …)
// pointing at the same uuid `users.id`.
//
// Naming: drizzle field KEYS must match BetterAuth's field names exactly
// (id, userId, token, expiresAt, …). SQL column names stay snake_case to match
// the rest of the schema. Tables are prefixed `auth_` to avoid colliding with
// the legacy `sessions` table (still served by the deprecated /auth/* routes).
//
// uuid ids: BetterAuth is configured with `generateId: false`, so the DB
// default fills `id` — matching the uuid convention used by `users`.

export const authSessions = pgTable(
  "auth_sessions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // The bearer token. Sent by the client as `Authorization: Bearer <token>`
    // and validated against this row on every request — deleting the row on
    // sign-out invalidates the token immediately (no stateless-JWT window).
    token: text("token").notNull().unique(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("auth_sessions_user_id_idx").on(t.userId),
    tokenIdx: index("auth_sessions_token_idx").on(t.token),
  })
);

export const authAccounts = pgTable(
  "auth_accounts",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    // Credential password (BetterAuth hashes via scrypt) — for email+password.
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    userIdx: index("auth_accounts_user_id_idx").on(t.userId),
  })
);

export const authVerifications = pgTable(
  "auth_verifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    // For email-OTP this is the email; `value` holds the (hashed) code.
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    identifierIdx: index("auth_verifications_identifier_idx").on(t.identifier),
  })
);

export const authSessionsRelations = relations(authSessions, ({ one }) => ({
  user: one(users, { fields: [authSessions.userId], references: [users.id] }),
}));

export const authAccountsRelations = relations(authAccounts, ({ one }) => ({
  user: one(users, { fields: [authAccounts.userId], references: [users.id] }),
}));
