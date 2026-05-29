import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  numeric,
  timestamp,
  pgEnum,
  index,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { inquiries } from "./inquiries";

// ─── Enums ───────────────────────────────────────────
export const bidStatusEnum = pgEnum("bid_status", [
  "pending",
  "accepted",
  "rejected",
  "expired",
]);

// ─── Bids Table ──────────────────────────────────────
export const bids = pgTable("bids", {
  id: uuid("id").defaultRandom().primaryKey(),
  inquiryId: uuid("inquiry_id")
    .notNull()
    .references(() => inquiries.id, { onDelete: "cascade" }),
  supplierId: uuid("supplier_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  price: numeric("price", { precision: 12, scale: 2 }).notNull(),
  condition: varchar("condition", { length: 50 }).notNull().default("oem"),
  warrantyMonths: integer("warranty_months").notNull().default(0),
  etaDays: integer("eta_days").notNull().default(3),
  notes: text("notes"),
  status: bidStatusEnum("status").notNull().default("pending"),
  // Set when buyer accepts this bid — plain UUID, no FK to avoid circular import
  orderId: uuid("order_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byInquiry: index("bids_inquiry_idx").on(t.inquiryId),
  bySupplier: index("bids_supplier_idx").on(t.supplierId),
}));

// ─── Relations ───────────────────────────────────────
export const bidsRelations = relations(bids, ({ one }) => ({
  inquiry: one(inquiries, {
    fields: [bids.inquiryId],
    references: [inquiries.id],
  }),
  supplier: one(users, {
    fields: [bids.supplierId],
    references: [users.id],
  }),
}));
