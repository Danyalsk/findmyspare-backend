// Indian mobile number normalization → E.164 (+91XXXXXXXXXX).
// Accepts: 9876543210, 09876543210, +919876543210, 919876543210, with spaces/dashes.
// Returns: "+919876543210" on success, null on failure.

const IN_MOBILE_RE = /^[6-9]\d{9}$/;

export function normalizeIndianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d]/g, "");
  if (!digits) return null;

  // Strip leading 91 country code if present (12 or 13 digits w/ leading 0)
  let local = digits;
  if (local.length === 12 && local.startsWith("91")) local = local.slice(2);
  if (local.length === 13 && local.startsWith("091")) local = local.slice(3);
  if (local.length === 11 && local.startsWith("0")) local = local.slice(1);

  if (!IN_MOBILE_RE.test(local)) return null;
  return `+91${local}`;
}

export function isValidE164(phone: string | null | undefined): boolean {
  if (!phone) return false;
  return /^\+\d{8,15}$/.test(phone);
}
