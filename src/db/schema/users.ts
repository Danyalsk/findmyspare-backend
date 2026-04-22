import {
  pgTable,
  uuid,
  varchar,
  text,
  timestamp,
  boolean,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

// ─── Enums ───────────────────────────────────────────
export const userRoleEnum = pgEnum("user_role", ["buyer", "supplier"]);

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
