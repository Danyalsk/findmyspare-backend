import {
  pgTable,
  pgEnum,
  uuid,
  varchar,
  text,
  jsonb,
  timestamp,
  boolean,
  integer,
  index,
} from "drizzle-orm/pg-core";
import { users } from "./users";

// ─── Audit log ───────────────────────────────────────
// Append-only record of every admin / super_admin mutation.
export const adminActionEnum = pgEnum("admin_action", [
  "supplier_approve",
  "supplier_reject",
  "supplier_request_info",
  "user_ban",
  "user_unban",
  "user_delete",
  "user_impersonate",
  "message_hide",
  "inquiry_hide",
  "product_hide",
  "flag_action",
  "config_update",
  "banner_create",
  "banner_update",
  "banner_delete",
  "rejection_reason_create",
  "rejection_reason_update",
  "rejection_reason_delete",
]);

export const adminActions = pgTable(
  "admin_actions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorId: uuid("actor_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    action: adminActionEnum("action").notNull(),
    targetType: varchar("target_type", { length: 64 }).notNull(),
    targetId: varchar("target_id", { length: 64 }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
    ipAddress: varchar("ip_address", { length: 64 }),
    userAgent: varchar("user_agent", { length: 512 }),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byActor: index("admin_actions_actor_idx").on(t.actorId),
    byTarget: index("admin_actions_target_idx").on(t.targetType, t.targetId),
    byTime: index("admin_actions_created_idx").on(t.createdAt),
  })
);

// ─── Rejection reason templates ──────────────────────
export const rejectionReasons = pgTable("rejection_reasons", {
  id: uuid("id").defaultRandom().primaryKey(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  title: varchar("title", { length: 200 }).notNull(),
  body: text("body").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  sortOrder: integer("sort_order").default(0).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});

// ─── Platform config (single row) ────────────────────
export const platformConfig = pgTable("platform_config", {
  id: integer("id").primaryKey().default(1),
  maintenanceMode: boolean("maintenance_mode").default(false).notNull(),
  waitlistOnly: boolean("waitlist_only").default(false).notNull(),
  signupsOpen: boolean("signups_open").default(true).notNull(),
  bannerText: text("banner_text"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  updatedBy: uuid("updated_by").references(() => users.id, { onDelete: "set null" }),
});

// ─── Flagged content moderation queue ────────────────
export const flagStatusEnum = pgEnum("flag_status", [
  "open",
  "reviewed",
  "actioned",
  "dismissed",
]);

export const flagContentTypeEnum = pgEnum("flag_content_type", [
  "message",
  "inquiry",
  "bid",
  "product",
  "user",
]);

export const flaggedContent = pgTable(
  "flagged_content",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    reporterId: uuid("reporter_id").references(() => users.id, {
      onDelete: "set null",
    }),
    contentType: flagContentTypeEnum("content_type").notNull(),
    contentId: varchar("content_id", { length: 64 }).notNull(),
    reason: text("reason").notNull(),
    status: flagStatusEnum("status").default("open").notNull(),
    reviewerId: uuid("reviewer_id").references(() => users.id, {
      onDelete: "set null",
    }),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),
    actionNotes: text("action_notes"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .defaultNow()
      .notNull(),
  },
  (t) => ({
    byStatus: index("flagged_content_status_idx").on(t.status),
    byContent: index("flagged_content_content_idx").on(t.contentType, t.contentId),
  })
);
