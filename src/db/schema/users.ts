import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", [
  "buyer",
  "supplier",
  "admin",
  "super_admin",
]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "not_submitted",
  "pending",
  "approved",
  "rejected",
]);

// ─── Users Table ─────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  // Email now nullable — phone-only OTP signups may have no email yet.
  email: varchar("email", { length: 255 }).unique(),
  // Name filled during the one-time profile step after first OTP verify.
  name: varchar("name", { length: 255 }),
  // Indian numbers normalized to E.164 (+91XXXXXXXXXX). Unique when present.
  phone: varchar("phone", { length: 20 }).unique(),
  // Nullable — OTP-first accounts have no password.
  passwordHash: text("password_hash"),
  role: userRoleEnum("role").notNull().default("buyer"),
  image: text("image"),
  businessName: varchar("business_name", { length: 255 }),
  businessType: varchar("business_type", { length: 100 }),
  specialization: varchar("specialization", { length: 255 }),
  taxId: varchar("tax_id", { length: 50 }),
  // Supplier verification (KYC) fields
  verificationStatus: verificationStatusEnum("verification_status")
    .notNull()
    .default("not_submitted"),
  gstNumber: varchar("gst_number", { length: 20 }),
  panNumber: varchar("pan_number", { length: 20 }),
  gstCertificateUrl: text("gst_certificate_url"),
  // Result of live GSTIN verification (Sandbox API) — shown to admin at review.
  gstVerification: jsonb("gst_verification").$type<{
    checkedAt: string;
    ok: boolean;
    status?: string;
    legalName?: string;
    tradeName?: string;
    address?: string;
    nameMatch?: boolean;
    error?: string;
  } | null>(),
  businessAddress: jsonb("business_address").$type<{
    line1: string;
    line2?: string | null;
    city: string;
    state: string;
    pincode: string;
  } | null>(),
  rejectionReason: text("rejection_reason"),
  // Verification
  emailVerified: boolean("email_verified").default(false).notNull(),
  phoneVerified: boolean("phone_verified").default(false).notNull(),
  // OTP-first signup: account created on first verify, profile filled after.
  profileCompleted: boolean("profile_completed").default(false).notNull(),
  // Buyer location captured at one-time profile step.
  city: varchar("city", { length: 100 }),
  pincode: varchar("pincode", { length: 10 }),
  // Admin / lifecycle
  isActive: boolean("is_active").default(true).notNull(),
  banReason: text("ban_reason"),
  banExpiresAt: timestamp("ban_expires_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  lastLoginAt: timestamp("last_login_at", { withTimezone: true }),
  lastLoginIp: varchar("last_login_ip", { length: 64 }),
  // Optional admin 2FA
  totpSecret: text("totp_secret"),
  totpEnabled: boolean("totp_enabled").default(false).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Email verification tokens ───────────────────────
export const emailVerificationTokens = pgTable("email_verification_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Login OTP codes (passwordless email/phone) ──────
// Backs EMAIL OTP login (phone OTP via WhatsApp uses the same table).
export const loginOtps = pgTable(
  "login_otps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    identifier: varchar("identifier", { length: 255 }).notNull(), // email (lowercased)
    codeHash: varchar("code_hash", { length: 128 }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    attempts: integer("attempts").default(0).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    byIdentifier: index("login_otps_identifier_idx").on(t.identifier),
  })
);

// ─── Magic login tokens (one-click login from email) ─
export const magicLoginTokens = pgTable("magic_login_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Password reset tokens ───────────────────────────
export const passwordResetTokens = pgTable("password_reset_tokens", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  tokenHash: varchar("token_hash", { length: 128 }).notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  ipAddress: varchar("ip_address", { length: 64 }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────
export const usersRelations = relations(users, ({ many }) => ({
  products: many(products),
  buyerOrders: many(orders, { relationName: "buyerOrders" }),
  supplierOrders: many(orders, { relationName: "supplierOrders" }),
  addresses: many(addresses),
  notifications: many(notifications),
  disputes: many(disputes),
}));

// Forward-declare imports for relations (resolved at runtime by Drizzle)
import { products } from "./products";
import { orders } from "./orders";
import { addresses } from "./addresses";
import { notifications } from "./notifications";
import { disputes } from "./disputes";
