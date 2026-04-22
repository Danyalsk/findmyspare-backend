import {
  pgTable,
  uuid,
  numeric,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { orders } from "./orders";

// ─── Enums ───────────────────────────────────────────
export const escrowStatusEnum = pgEnum("escrow_status", [
  "held",
  "released",
  "refund_initiated",
  "refund_completed",
]);

// ─── Escrow Transactions Table ───────────────────────
export const escrowTransactions = pgTable("escrow_transactions", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" })
    .unique(),
  amount: numeric("amount", { precision: 12, scale: 2 }).notNull(),
  status: escrowStatusEnum("status").notNull().default("held"),
  heldAt: timestamp("held_at", { withTimezone: true }).defaultNow().notNull(),
  releasedAt: timestamp("released_at", { withTimezone: true }),
  refundedAt: timestamp("refunded_at", { withTimezone: true }),
});

// ─── Relations ───────────────────────────────────────
export const escrowTransactionsRelations = relations(
  escrowTransactions,
  ({ one }) => ({
    order: one(orders, {
      fields: [escrowTransactions.orderId],
      references: [orders.id],
    }),
  })
);
