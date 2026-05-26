import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
  jsonb,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["buyer", "supplier", "admin"]);

export const verificationStatusEnum = pgEnum("verification_status", [
  "not_submitted",
  "pending",
  "approved",
  "rejected",
]);

// ─── Users Table ─────────────────────────────────────
export const users = pgTable("users", {
  id: uuid("id").defaultRandom().primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  name: varchar("name", { length: 255 }).notNull(),
  phone: varchar("phone", { length: 20 }),
  passwordHash: text("password_hash").notNull(),
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
  businessAddress: jsonb("business_address").$type<{
    line1: string;
    line2?: string;
    city: string;
    state: string;
    pincode: string;
  } | null>(),
  rejectionReason: text("rejection_reason"),
  // Misc
  emailVerified: boolean("email_verified").default(false),
  isActive: boolean("is_active").default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
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
