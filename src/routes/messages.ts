import { Elysia, t } from "elysia";
import { db } from "../db";
import { messages, users } from "../db/schema";
import { eq, and, or, desc, sql } from "drizzle-orm";
import { authGuard } from "../middleware/auth";
import { broadcastNewMessage, broadcastMessageRead } from "../lib/io";
import { rateLimit } from "../lib/rate-limit";

export const messageRoutes = new Elysia({ prefix: "/messages" })
  .use(authGuard)

  // ─── Total Unread Count ──────────────────────────────
  .get(
    "/unread-count",
    async ({ user }) => {
      if (user.role === "admin") return { unread: 0 };
      const [{ unread }] = await db
        .select({ unread: sql<number>`count(*)::int` })
        .from(messages)
        .where(and(eq(messages.receiverId, user.id), eq(messages.isRead, false)));
      return { unread };
    },
    { detail: { summary: "Total unread messages for current user", tags: ["Messages"] } }
  )

  // ─── List Conversations ──────────────────────────────
  // Returns one entry per unique conversation partner, with the latest
  // message preview, unread count, and the other user's profile.
  .get(
    "/conversations",
    async ({ user }) => {
      if (user.role === "admin") return { conversations: [] };

      // Distinct conversation partners using a CTE
      const convos = await db.execute(sql`
        WITH partners AS (
          SELECT DISTINCT
            CASE
              WHEN sender_id = ${user.id} THEN receiver_id
              ELSE sender_id
            END AS partner_id
          FROM messages
          WHERE sender_id = ${user.id} OR receiver_id = ${user.id}
        ),
        latest AS (
          SELECT
            p.partner_id,
            m.content AS last_message,
            m.attachments AS last_attachments,
            m.created_at AS last_message_at,
            (
              SELECT count(*)::int FROM messages
              WHERE sender_id = p.partner_id
                AND receiver_id = ${user.id}
                AND is_read = false
            ) AS unread_count
          FROM partners p
          JOIN LATERAL (
            SELECT content, attachments, created_at FROM messages
            WHERE (sender_id = ${user.id} AND receiver_id = p.partner_id)
               OR (sender_id = p.partner_id AND receiver_id = ${user.id})
            ORDER BY created_at DESC
            LIMIT 1
          ) m ON true
        )
        SELECT
          l.partner_id AS "userId",
          u.name,
          u.role,
          u.business_name AS "businessName",
          u.image,
          l.last_message AS "lastMessage",
          l.last_attachments AS "lastAttachments",
          l.last_message_at AS "lastMessageAt",
          l.unread_count AS "unreadCount"
        FROM latest l
        JOIN users u ON u.id = l.partner_id
        ORDER BY l.last_message_at DESC
      `);

      return { conversations: convos };
    },
    { detail: { summary: "List all conversations for the current user", tags: ["Messages"] } }
  )

  // ─── Get Thread ──────────────────────────────────────
  .get(
    "/:userId",
    async ({ params, query, user, set }) => {
      const { userId } = params;
      const page = Math.max(1, parseInt(query.page || "1"));
      const limit = Math.min(100, Math.max(1, parseInt(query.limit || "50")));
      const offset = (page - 1) * limit;

      if (userId === user.id) {
        set.status = 400;
        return { error: "Cannot message yourself" };
      }

      const [other] = await db
        .select({
          id: users.id,
          name: users.name,
          role: users.role,
          businessName: users.businessName,
          image: users.image,
        })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!other) {
        set.status = 404;
        return { error: "User not found" };
      }

      const thread = await db
        .select()
        .from(messages)
        .where(
          or(
            and(eq(messages.senderId, user.id), eq(messages.receiverId, userId)),
            and(eq(messages.senderId, userId), eq(messages.receiverId, user.id))
          )
        )
        .orderBy(desc(messages.createdAt))
        .limit(limit)
        .offset(offset);

      const [{ total }] = await db
        .select({ total: sql<number>`count(*)::int` })
        .from(messages)
        .where(
          or(
            and(eq(messages.senderId, user.id), eq(messages.receiverId, userId)),
            and(eq(messages.senderId, userId), eq(messages.receiverId, user.id))
          )
        );

      // Return oldest-first for display
      return {
        messages: thread.reverse(),
        user: other,
        pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
      };
    },
    {
      params: t.Object({ userId: t.String() }),
      query: t.Object({
        page: t.Optional(t.String()),
        limit: t.Optional(t.String()),
      }),
      detail: { summary: "Get message thread with a specific user", tags: ["Messages"] },
    }
  )

  // ─── Send Message ────────────────────────────────────
  .post(
    "/:userId",
    async ({ params, body, user, set }) => {
      const { userId } = params;

      if (userId === user.id) {
        set.status = 400;
        return { error: "Cannot message yourself" };
      }

      // Per-sender rate limit: 30 messages / 60s. Prevents spam + socket flood.
      const rl = rateLimit(`msg:${user.id}`, 30, 60_000);
      if (!rl.ok) {
        set.status = 429;
        set.headers["retry-after"] = String(Math.ceil(rl.resetMs / 1000));
        return { error: "Sending too fast. Slow down a moment." };
      }

      const [recipient] = await db
        .select({ id: users.id, role: users.role, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, userId))
        .limit(1);

      if (!recipient || !recipient.isActive) {
        set.status = 404;
        return { error: "Recipient not found" };
      }

      if (recipient.role === "admin" || recipient.role === "super_admin") {
        set.status = 403;
        return { error: "Cannot message admin" };
      }

      const content = (body.content ?? "").trim();
      const attachments = body.attachments ?? [];
      if (!content && attachments.length === 0) {
        set.status = 400;
        return { error: "Message must have text or an attachment" };
      }

      // Insert first — broadcast only on confirmed write. If the DB rejects
      // (constraint, connection, etc.), the catch returns 500 and the socket
      // event is never emitted, keeping server and client in sync.
      let msg;
      try {
        const inserted = await db
          .insert(messages)
          .values({
            senderId: user.id,
            receiverId: userId,
            content,
            attachments,
          })
          .returning();
        msg = inserted[0];
        if (!msg) throw new Error("Insert returned no row");
      } catch (e) {
        console.error("[messages/send] insert failed:", e);
        set.status = 500;
        return { error: "Could not send message" };
      }

      broadcastNewMessage(userId, {
        ...msg,
        senderName: user.name,
        senderRole: user.role,
      });

      set.status = 201;
      return { message: msg };
    },
    {
      params: t.Object({ userId: t.String() }),
      body: t.Object({
        content: t.Optional(t.String({ maxLength: 2000 })),
        attachments: t.Optional(
          t.Array(
            t.Object({
              url: t.String(),
              type: t.Union([t.Literal("image"), t.Literal("video")]),
            }),
            { maxItems: 10 }
          )
        ),
      }),
      detail: { summary: "Send a message to a user", tags: ["Messages"] },
    }
  )

  // ─── Mark Thread as Read ─────────────────────────────
  .patch(
    "/:userId/read",
    async ({ params, user }) => {
      const { userId } = params;

      await db
        .update(messages)
        .set({ isRead: true })
        .where(
          and(
            eq(messages.senderId, userId),
            eq(messages.receiverId, user.id),
            eq(messages.isRead, false)
          )
        );

      // Notify sender their messages were read
      broadcastMessageRead(userId, user.id);

      return { ok: true };
    },
    {
      params: t.Object({ userId: t.String() }),
      detail: { summary: "Mark all messages from a user as read", tags: ["Messages"] },
    }
  );
