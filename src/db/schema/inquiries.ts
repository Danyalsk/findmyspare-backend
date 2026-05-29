import { pgTable, uuid, varchar, text, timestamp, boolean, pgEnum, index } from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";
import { users } from "./users";
import { products } from "./products";

// ─── Enums ───────────────────────────────────────────
export const inquiryStatusEnum = pgEnum("inquiry_status", [
  "pending",
  "responded",
  "closed",
]);

// ─── Inquiries Table ─────────────────────────────────
export const inquiries = pgTable("inquiries", {
  id: uuid("id").defaultRandom().primaryKey(),
  buyerId: uuid("buyer_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),

  // Basic info about the part they are looking for
  partName: varchar("part_name", { length: 255 }).notNull(),
  make: varchar("make", { length: 100 }).notNull(),
  model: varchar("model", { length: 100 }).notNull(),
  year: varchar("year", { length: 10 }).notNull(),
  description: text("description"),
  
  // They might provide an image of the part
  imageUrl: text("image_url"),
  
  status: inquiryStatusEnum("status").notNull().default("pending"),
  isActive: boolean("is_active").default(true),

  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byBuyer: index("inquiries_buyer_idx").on(t.buyerId),
  byActive: index("inquiries_active_idx").on(t.isActive),
}));

// ─── Relations ───────────────────────────────────────
export const inquiriesRelations = relations(inquiries, ({ one }) => ({
  buyer: one(users, {
    fields: [inquiries.buyerId],
    references: [users.id],
  }),
}));
