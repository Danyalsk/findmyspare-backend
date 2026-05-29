// Offline GSTIN + PAN validation (free, no API). Catches typos and
// structurally-fake numbers before they ever reach an admin or a paid API call.

const CODEPOINTS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;

// GSTIN check digit (15th char) is derived from the first 14 via a
// weighted modulo-36 algorithm published by GSTN.
function gstinCheckDigit(first14: string): string {
  const mod = CODEPOINTS.length; // 36
  let factor = 2;
  let sum = 0;
  for (let i = first14.length - 1; i >= 0; i--) {
    const cp = CODEPOINTS.indexOf(first14[i]!);
    if (cp < 0) return "";
    let digit = factor * cp;
    factor = factor === 2 ? 1 : 2;
    digit = Math.floor(digit / mod) + (digit % mod);
    sum += digit;
  }
  return CODEPOINTS[(mod - (sum % mod)) % mod]!;
}

export function isValidGstin(gstinRaw: string): boolean {
  const gstin = gstinRaw.trim().toUpperCase();
  if (!GSTIN_RE.test(gstin)) return false;
  return gstinCheckDigit(gstin.slice(0, 14)) === gstin[14];
}

// Chars 3–12 of a GSTIN are the holder's PAN.
export function panFromGstin(gstinRaw: string): string {
  return gstinRaw.trim().toUpperCase().slice(2, 12);
}

export function isValidPan(panRaw: string): boolean {
  return PAN_RE.test(panRaw.trim().toUpperCase());
}

// Loose name comparison for matching a registered legal/trade name against the
// business name the supplier typed. Strips case, punctuation, common suffixes.
export function normalizeBusinessName(s: string): string {
  return s
    .toLowerCase()
    .replace(/\b(private|pvt|limited|ltd|llp|enterprises?|traders?|automobiles?|auto|spares?|parts?|company|co|and|&)\b/g, "")
    .replace(/[^a-z0-9]/g, "")
    .trim();
}

export function namesMatch(a: string, b: string): boolean {
  const na = normalizeBusinessName(a);
  const nb = normalizeBusinessName(b);
  if (!na || !nb) return false;
  return na === nb || na.includes(nb) || nb.includes(na);
}
