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
  index,
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
  // "draft" = private inventory item, not yet published to the marketplace.
  // Invisible to buyers; publishing flips it to "active"/"out_of_stock".
  "draft",
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
  lowStockThreshold: integer("low_stock_threshold").notNull().default(5),
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
}, (t) => ({
  bySupplier: index("products_supplier_idx").on(t.supplierId),
  byStatus: index("products_status_idx").on(t.status),
}));

// ─── Relations ───────────────────────────────────────
export const productsRelations = relations(products, ({ one, many }) => ({
  supplier: one(users, {
    fields: [products.supplierId],
    references: [users.id],
  }),
  orderItems: many(orderItems),
}));
