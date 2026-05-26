import {
  pgTable,
  uuid,
  varchar,
  text,
  integer,
  timestamp,
  pgEnum,
} from "drizzle-orm/pg-core";

export const bannerStatusEnum = pgEnum("banner_status", ["active", "draft"]);

export const banners = pgTable("banners", {
  id: uuid("id").defaultRandom().primaryKey(),
  title: varchar("title", { length: 255 }).notNull(),
  subtitle: varchar("subtitle", { length: 500 }),
  imageUrl: text("image_url"),
  ctaLabel: varchar("cta_label", { length: 100 }),
  ctaHref: varchar("cta_href", { length: 500 }),
  status: bannerStatusEnum("status").notNull().default("draft"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
});
