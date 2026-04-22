import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { orderItems } from "./orders";

// ─── Enums ───────────────────────────────────────────
export const productStatusEnum = pgEnum("product_status", [
  "active",
  "paused",
  "out_of_stock",
  "deleted",
]);

// ─── Products Table ──────────────────────────────────
export const products = pgTable("products", {
  id: uuid("id").defaultRandom().primaryKey(),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: varchar("name", { length: 500 }).notNull(),
  description: text("description"),
  partNumber: varchar("part_number", { length: 100 }),
  category: varchar("category", { length: 100 }),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  stockQuantity: integer("stock_quantity").notNull().default(0),
  images: jsonb("images").$type<string[]>().default([]),
  specifications: jsonb("specifications").$type<Record<string, string>>().default({}),
  compatibleVehicles: jsonb("compatible_vehicles")
    .$type<{ make: string; model: string; year?: string }[]>()
    .default([]),
  warrantyInfo: text("warranty_info"),
  status: productStatusEnum("status").notNull().default("active"),
  viewCount: integer("view_count").default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────
export const productsRelations = relations(products, ({ one, many }) => ({
  supplier: one(users, {
    fields: [products.supplierId],
    references: [users.id],
  }),
  orderItems: many(orderItems),
}));
