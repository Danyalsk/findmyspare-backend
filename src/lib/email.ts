import { Resend } from "resend";

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || "FindMySpare <noreply@findmyspare.com>";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const resend = RESEND_API_KEY ? new Resend(RESEND_API_KEY) : null;

if (!resend && process.env.NODE_ENV === "production") {
  // eslint-disable-next-line no-console
  console.warn("[email] RESEND_API_KEY missing in production — outbound email disabled.");
}

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
};

async function send({ to, subject, html, text }: SendArgs): Promise<void> {
  if (!resend) {
    // eslint-disable-next-line no-console
    console.log(`[email:dev] to=${to} subject="${subject}"`);
    return;
  }
  const { error } = await resend.emails.send({
    from: RESEND_FROM,
    to,
    subject,
    html,
    text: text ?? html.replace(/<[^>]+>/g, " "),
  });
  if (error) throw new Error(`Resend send failed: ${error.message}`);
}

function shell(title: string, body: string, ctaLabel?: string, ctaUrl?: string): string {
  const cta = ctaLabel && ctaUrl
    ? `<p style="margin:24px 0"><a href="${ctaUrl}" style="background:#10b981;color:#fff;padding:12px 20px;border-radius:8px;text-decoration:none;font-weight:600;display:inline-block">${ctaLabel}</a></p><p style="color:#6b7280;font-size:13px">Or paste this link into your browser:<br><span style="word-break:break-all">${ctaUrl}</span></p>`
    : "";
  return `<!doctype html><html><body style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;background:#f9fafb;margin:0;padding:24px"><div style="max-width:560px;margin:0 auto;background:#fff;padding:32px;border-radius:12px;border:1px solid #e5e7eb"><h1 style="margin:0 0 16px;font-size:20px;color:#111827">${title}</h1><div style="color:#374151;line-height:1.6">${body}</div>${cta}<hr style="margin:32px 0 16px;border:none;border-top:1px solid #e5e7eb"><p style="color:#9ca3af;font-size:12px;margin:0">FindMySpare · India's auto parts marketplace</p></div></body></html>`;
}

export async function sendVerificationEmail(to: string, name: string, token: string): Promise<void> {
  const url = `${FRONTEND_URL}/verify-email?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Verify your FindMySpare email",
    html: shell(
      `Hi ${name}, verify your email`,
      `<p>Click the button below to confirm this is your email address. The link is valid for 24 hours.</p>`,
      "Verify email",
      url
    ),
  });
}

export async function sendOtpEmail(to: string, code: string): Promise<void> {
  await send({
    to,
    subject: `${code} is your FindMySpare login code`,
    html: shell(
      "Your login code",
      `<p>Use this code to sign in. It expires in 10 minutes.</p>
       <p style="font-size:32px;font-weight:700;letter-spacing:8px;margin:24px 0;color:#111827">${code}</p>
       <p style="color:#6b7280;font-size:13px">If you didn't request this, you can ignore this email.</p>`
    ),
  });
}

export async function sendPasswordResetEmail(to: string, name: string, token: string): Promise<void> {
  const url = `${FRONTEND_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await send({
    to,
    subject: "Reset your FindMySpare password",
    html: shell(
      `Hi ${name}, reset your password`,
      `<p>We received a request to reset your password. The link is valid for 1 hour. If you did not request this, ignore this email.</p>`,
      "Reset password",
      url
    ),
  });
}

export async function sendSupplierStatusEmail(
  to: string,
  name: string,
  status: "approved" | "rejected" | "info_requested",
  note?: string,
  loginUrl?: string
): Promise<void> {
  const subjects = {
    approved: "Your supplier account is approved",
    rejected: "Your supplier application was not approved",
    info_requested: "More information needed on your supplier application",
  } as const;
  const bodies = {
    approved: `<p>Hi ${name},</p><p>Welcome aboard. Your supplier account has been <strong>approved</strong> and your dashboard is ready. Click below to go straight in — no password needed.</p>`,
    rejected: `<p>Hi ${name},</p><p>Your supplier application was not approved.</p>${note ? `<p><strong>Reason:</strong> ${note}</p>` : ""}<p>You can update your details and resubmit from your account.</p>`,
    info_requested: `<p>Hi ${name},</p><p>We need additional information before we can complete your supplier verification.</p>${note ? `<p><strong>What we need:</strong> ${note}</p>` : ""}`,
  } as const;
  // Approved emails get a one-click magic-login button; others link to the site.
  const cta = status === "approved" ? "Open my dashboard" : "Open FindMySpare";
  const url = status === "approved" && loginUrl ? loginUrl : FRONTEND_URL;
  await send({
    to,
    subject: subjects[status],
    html: shell(subjects[status], bodies[status], cta, url),
  });
}

export async function sendAdminLoginAlert(
  to: string,
  name: string,
  ip: string,
  userAgent: string
): Promise<void> {
  await send({
    to,
    subject: "New admin login from an unfamiliar device",
    html: shell(
      "New admin login",
      `<p>Hi ${name},</p><p>Your FindMySpare admin account was just signed into from a new IP or device.</p><p><strong>IP:</strong> ${ip}<br><strong>Device:</strong> ${userAgent}</p><p>If this was you, no action needed. If not, change your password and revoke active sessions immediately.</p>`,
      "Review sessions",
      `${FRONTEND_URL}/admin`
    ),
  });
}
