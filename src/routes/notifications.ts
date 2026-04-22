import { Elysia, t } from "elysia";
import { db } from "../db";
import { notifications } from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { authGuard } from "../middleware/auth";

export const notificationRoutes = new Elysia({ prefix: "/notifications" })
  .use(authGuard)

  // ─── List Notifications ──────────────────────────────
  .get(
    "/",
    async ({ user, query }) => {
      const page = Math.max(1, parseInt(query.page || "1"));
      const limit = Math.min(50, parseInt(query.limit || "20"));
      const offset = (page - 1) * limit;

      const items = await db
        .select()
        .from(notifications)
        .where(eq(notifications.userId, user.id))
        .orderBy(desc(notifications.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ unreadCount }] = await db
        .select({ unreadCount: sql<number>`count(*)::int` })
        .from(notifications)
        .where(and(eq(notifications.userId, user.id), eq(notifications.isRead, false)));

      return { notifications: items, unreadCount };
    },
    {
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "List notifications for current user", tags: ["Notifications"] },
    }
  )

  // ─── Mark Single Read ────────────────────────────────
  .patch(
    "/:id/read",
    async ({ params, user, set }) => {
      const [notif] = await db
        .select({ id: notifications.id })
        .from(notifications)
        .where(and(eq(notifications.id, params.id), eq(notifications.userId, user.id)))
        .limit(1);

      if (!notif) {
        set.status = 404;
        return { error: "Notification not found" };
      }

      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.id, params.id));

      return { message: "Marked as read" };
    },
    {
      params: t.Object({ id: t.String() }),
      detail: { summary: "Mark a notification as read", tags: ["Notifications"] },
    }
  )

  // ─── Mark All Read ───────────────────────────────────
  .post(
    "/read-all",
    async ({ user }) => {
      await db
        .update(notifications)
        .set({ isRead: true })
        .where(eq(notifications.userId, user.id));

      return { message: "All notifications marked as read" };
    },
    {
      detail: { summary: "Mark all notifications as read", tags: ["Notifications"] },
    }
  );
