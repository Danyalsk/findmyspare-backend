// WhatsApp Cloud API OTP sender.
// We own the 6-digit code (login_otps table); this just delivers it via a
// WhatsApp authentication template. Requires a Meta WhatsApp Business number.
//
// Env:
//   WHATSAPP_TOKEN            — access token (system-user token for prod)
//   WHATSAPP_PHONE_NUMBER_ID  — the sender phone number ID (not the number)
//   WHATSAPP_OTP_TEMPLATE     — approved authentication template name (default "otp")
//   WHATSAPP_OTP_LANG         — template language code (default "en_US")
//   WHATSAPP_OTP_NO_BUTTON    — "true" if the template has no copy-code button

const TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.WHATSAPP_PHONE_NUMBER_ID;
const TEMPLATE = process.env.WHATSAPP_OTP_TEMPLATE || "otp";
const LANG = process.env.WHATSAPP_OTP_LANG || "en_US";
const NO_BUTTON = process.env.WHATSAPP_OTP_NO_BUTTON === "true";
const GRAPH_VERSION = "v21.0";

export function isWhatsAppConfigured(): boolean {
  return Boolean(TOKEN && PHONE_NUMBER_ID);
}

/**
 * Send a WhatsApp OTP code to a phone in E.164 (+91...). Throws on failure
 * so the caller can surface a clear error.
 */
export async function sendWhatsAppOtp(phoneE164: string, code: string): Promise<void> {
  if (!isWhatsAppConfigured()) {
    // Dev fallback: log instead of sending.
    // eslint-disable-next-line no-console
    console.log(`[whatsapp:dev] to=${phoneE164} code=${code}`);
    return;
  }

  // Recipient = digits only, no leading +.
  const to = phoneE164.replace(/^\+/, "");

  // Meta authentication templates take the code as the body param, and (if the
  // template has a one-tap/copy-code button) the same code as the button param.
  const components: unknown[] = [
    { type: "body", parameters: [{ type: "text", text: code }] },
  ];
  if (!NO_BUTTON) {
    components.push({
      type: "button",
      sub_type: "url",
      index: "0",
      parameters: [{ type: "text", text: code }],
    });
  }

  const res = await fetch(
    `https://graph.facebook.com/${GRAPH_VERSION}/${PHONE_NUMBER_ID}/messages`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        messaging_product: "whatsapp",
        to,
        type: "template",
        template: {
          name: TEMPLATE,
          language: { code: LANG },
          components,
        },
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`WhatsApp send failed (${res.status}): ${text.slice(0, 300)}`);
  }
}
