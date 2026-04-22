import {
  pgTable,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { orders } from "./orders";
import { users } from "./users";

// ─── Enums ───────────────────────────────────────────
export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "under_review",
  "return_approved",
  "return_rejected",
  "resolved",
  "closed",
]);

export const issueTypeEnum = pgEnum("issue_type", [
  "wrong_part",
  "damaged",
  "not_as_described",
  "missing_parts",
  "not_delivered",
  "other",
]);

// ─── Disputes Table ──────────────────────────────────
export const disputes = pgTable("disputes", {
  id: uuid("id").defaultRandom().primaryKey(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id, { onDelete: "cascade" }),
  raisedById: uuid("raised_by_id")
    .notNull()
    .references(() => users.id),
  issueType: issueTypeEnum("issue_type").notNull(),
  description: text("description").notNull(),
  status: disputeStatusEnum("status").notNull().default("open"),
  evidence: jsonb("evidence").$type<string[]>().default([]),
  supplierResponse: text("supplier_response"),
  supplierEvidence: jsonb("supplier_evidence").$type<string[]>().default([]),
  returnTrackingNumber: varchar("return_tracking_number", { length: 100 }),
  returnConfirmedAt: timestamp("return_confirmed_at", { withTimezone: true }),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Relations ───────────────────────────────────────
export const disputesRelations = relations(disputes, ({ one }) => ({
  order: one(orders, {
    fields: [disputes.orderId],
    references: [orders.id],
  }),
  raisedBy: one(users, {
    fields: [disputes.raisedById],
    references: [users.id],
  }),
}));
