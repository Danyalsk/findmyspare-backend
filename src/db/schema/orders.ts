import {
  pgTable,
  uuid,
  varchar,
  integer,
  numeric,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { products } from "./products";
import { addresses } from "./addresses";
import { escrowTransactions } from "./escrow";
import { disputes } from "./disputes";

// ─── Enums ───────────────────────────────────────────
export const orderStatusEnum = pgEnum("order_status", [
  "placed",
  "confirmed",
  "shipped",
  "in_transit",
  "delivered",
  "completed",
  "disputed",
  "cancelled",
]);

// ─── Orders Table ────────────────────────────────────
export const orders = pgTable("orders", {
  id: uuid("id").defaultRandom().primaryKey(),
  buyerId: uuid("buyer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  status: orderStatusEnum("status").notNull().default("placed"),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull(),
  shippingAddressId: uuid("shipping_address_id").references(() => addresses.id),
  trackingNumber: varchar("tracking_number", { length: 100 }),
  courierService: varchar("courier_service", { length: 100 }),
  estimatedDelivery: timestamp("estimated_delivery", { withTimezone: true }),
  deliveredAt: timestamp("delivered_at", { withTimezone: true }),
  closedAt: timestamp("closed_at", { withTimezone: true }),
  autoCloseAt: timestamp("auto_close_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byBuyer: index("orders_buyer_idx").on(t.buyerId),
  bySupplier: index("orders_supplier_idx").on(t.supplierId),
  byStatus: index("orders_status_idx").on(t.status),
}));

// ─── Order Items Table ───────────────────────────────
export const orderItems = pgTable("order_items", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id),
  quantity: integer("quantity").notNull().default(1),
  unitPrice: numeric("unit_price", { precision: 12, scale: 2 }).notNull(),
  subtotal: numeric("subtotal", { precision: 12, scale: 2 }).notNull(),
});

// ─── Relations ───────────────────────────────────────
export const ordersRelations = relations(orders, ({ one, many }) => ({
  buyer: one(users, {
    fields: [orders.buyerId],
    references: [users.id],
    relationName: "buyerOrders",
  }),
  supplier: one(users, {
    fields: [orders.supplierId],
    references: [users.id],
    relationName: "supplierOrders",
  }),
  shippingAddress: one(addresses, {
    fields: [orders.shippingAddressId],
    references: [addresses.id],
  }),
  items: many(orderItems),
  escrow: one(escrowTransactions),
  disputes: many(disputes),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
}));
