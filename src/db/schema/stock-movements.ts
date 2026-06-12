import {
  pgTable,
  uuid,
  integer,
  text,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { products } from "./products";

// ─── Enums ───────────────────────────────────────────
// Append-only ledger reasons. "order"/"order_cancelled" are system-generated
// from the order lifecycle; the rest are manual supplier adjustments.
export const stockMovementReasonEnum = pgEnum("stock_movement_reason", [
  "initial",
  "received",
  "damaged",
  "correction",
  "returned",
  "order",
  "order_cancelled",
]);

// ─── Stock Movements Table ───────────────────────────
// Immutable audit trail of every stock change. Each row records the delta and
// the resulting absolute quantity so history is reconstructable even if the
// product row is later edited.
export const stockMovements = pgTable("stock_movements", {
  id: uuid("id").defaultRandom().primaryKey(),
  productId: uuid("product_id")
    .notNull()
    .references(() => products.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  delta: integer("delta").notNull(),
  previousQuantity: integer("previous_quantity").notNull(),
  newQuantity: integer("new_quantity").notNull(),
  reason: stockMovementReasonEnum("reason").notNull(),
  note: text("note"),
  createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byProduct: index("stock_movements_product_idx").on(t.productId),
  bySupplier: index("stock_movements_supplier_idx").on(t.supplierId),
}));

// ─── Relations ───────────────────────────────────────
export const stockMovementsRelations = relations(stockMovements, ({ one }) => ({
  product: one(products, {
    fields: [stockMovements.productId],
    references: [products.id],
  }),
  supplier: one(users, {
    fields: [stockMovements.supplierId],
    references: [users.id],
  }),
}));
