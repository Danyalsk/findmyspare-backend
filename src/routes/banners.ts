import { Elysia } from "elysia";
import { db } from "../db";
import { banners } from "../db/schema";
import { eq } from "drizzle-orm";

export const bannerRoutes = new Elysia({ prefix: "/banners" })
  .get(
    "/",
    async () => {
      const items = await db
        .select()
        .from(banners)
        .where(eq(banners.status, "active"))
        .orderBy(banners.sortOrder);
      return { banners: items };
    },
    { detail: { summary: "List active banners (public)", tags: ["Banners"] } }
  );
