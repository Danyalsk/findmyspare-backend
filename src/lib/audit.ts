import { db } from "../db";
import { adminActions } from "../db/schema";

type Action =
  | "supplier_approve"
  | "supplier_reject"
  | "supplier_request_info"
  | "user_ban"
  | "user_unban"
  | "user_delete"
  | "user_impersonate"
  | "message_hide"
  | "inquiry_hide"
  | "product_hide"
  | "flag_action"
  | "config_update"
  | "banner_create"
  | "banner_update"
  | "banner_delete"
  | "rejection_reason_create"
  | "rejection_reason_update"
  | "rejection_reason_delete";

export type AuditContext = {
  actorId: string;
  request?: Request;
  ipAddress?: string;
  userAgent?: string;
};

/**
 * Write an append-only audit record. Best-effort: failure is logged but
 * doesn't break the calling request — admin actions should still succeed if
 * the audit table is briefly unreachable.
 */
export async function logAdminAction(
  ctx: AuditContext,
  action: Action,
  target: { type: string; id?: string },
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const ua =
      ctx.userAgent ??
      ctx.request?.headers.get("user-agent")?.slice(0, 512) ??
      null;
    const ip =
      ctx.ipAddress ??
      ctx.request?.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      null;

    await db.insert(adminActions).values({
      actorId: ctx.actorId,
      action,
      targetType: target.type,
      targetId: target.id ?? null,
      metadata: metadata ?? null,
      ipAddress: ip,
      userAgent: ua,
    });
  } catch (e) {
    // Don't fail the action just because the audit row didn't write.
    // eslint-disable-next-line no-console
    console.error("[audit] log failed:", e);
  }
}
