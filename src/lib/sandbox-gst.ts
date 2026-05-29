// Live GSTIN verification via RapidAPI. RapidAPI hosts many GST-verification
// APIs; this is config-driven so you can point it at whichever one you
// subscribe to (free tier, no card). Returns registration status + legal/trade
// name + address so an admin can confirm a supplier is a real, active business.
//
// Env:
//   RAPIDAPI_KEY        — your RapidAPI key (X-RapidAPI-Key)
//   RAPIDAPI_GST_HOST   — the API's host, e.g. "gst-insights-api.p.rapidapi.com"
//   RAPIDAPI_GST_URL    — full endpoint, with {gstin} placeholder
//   RAPIDAPI_GST_METHOD — GET (default) or POST
//   RAPIDAPI_GST_BODY   — optional JSON body template (POST), {gstin} placeholder

import { namesMatch } from "./gstin";

const KEY = process.env.RAPIDAPI_KEY;
const HOST = process.env.RAPIDAPI_GST_HOST;
const URL_TMPL = process.env.RAPIDAPI_GST_URL;
const METHOD = (process.env.RAPIDAPI_GST_METHOD || "GET").toUpperCase();
const BODY_TMPL = process.env.RAPIDAPI_GST_BODY;

export type GstVerification = {
  checkedAt: string;
  ok: boolean;
  status?: string;
  legalName?: string;
  tradeName?: string;
  address?: string;
  nameMatch?: boolean;
  error?: string;
  raw?: unknown;
};

export function isGstApiConfigured(): boolean {
  return Boolean(KEY && HOST && URL_TMPL);
}

// Recursively pull the first matching key (case-insensitive) from a nested object.
function findKey(obj: unknown, keys: string[]): unknown {
  if (!obj || typeof obj !== "object") return undefined;
  const lower = keys.map((k) => k.toLowerCase());
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (lower.includes(k.toLowerCase()) && (typeof v === "string" || typeof v === "number")) {
      return v;
    }
  }
  for (const v of Object.values(obj as Record<string, unknown>)) {
    if (v && typeof v === "object") {
      const found = findKey(v, keys);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

function str(v: unknown): string | undefined {
  return v === undefined || v === null ? undefined : String(v);
}

// Find a nested object under any of `keys` and join its string fields into a
// readable address line.
function findAddress(obj: unknown): string | undefined {
  if (!obj || typeof obj !== "object") return undefined;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (k.toLowerCase() === "address" && v && typeof v === "object") {
      const a = v as Record<string, unknown>;
      const parts = [
        "buildingNumber", "buildingName", "floorNumber", "street",
        "location", "locality", "landMark", "district", "stateCode", "pincode",
      ]
        .map((f) => a[f])
        .filter((x) => x && typeof x === "string" && (x as string).trim());
      if (parts.length) return parts.join(", ");
    }
    if (v && typeof v === "object") {
      const found = findAddress(v);
      if (found) return found;
    }
  }
  return undefined;
}

export async function verifyGstin(
  gstin: string,
  businessName: string
): Promise<GstVerification> {
  const checkedAt = new Date().toISOString();
  if (!isGstApiConfigured()) {
    return { checkedAt, ok: false, error: "GST API not configured" };
  }
  try {
    const url = URL_TMPL!.replace(/\{gstin\}/g, encodeURIComponent(gstin));
    const init: RequestInit = {
      method: METHOD,
      headers: {
        "X-RapidAPI-Key": KEY!,
        "X-RapidAPI-Host": HOST!,
        ...(METHOD === "POST" ? { "Content-Type": "application/json" } : {}),
      },
    };
    if (METHOD === "POST") {
      init.body = (BODY_TMPL || '{"gstin":"{gstin}"}').replace(/\{gstin\}/g, gstin);
    }

    const res = await fetch(url, init);
    const json = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      return { checkedAt, ok: false, error: `Lookup failed (${res.status})`, raw: json };
    }

    // Defensive parse — different RapidAPI GST APIs nest fields differently.
    const legalName = str(findKey(json, ["lgnm", "legalName", "legal_name", "name"]));
    const tradeName = str(findKey(json, ["tradeNam", "tradeName", "trade_name", "tradeNamOfBusiness"]));
    const status = str(findKey(json, ["sts", "status", "gstinStatus", "gst_status"]));

    if (!legalName && !tradeName && !status) {
      return { checkedAt, ok: false, error: "GSTIN not found or unexpected response", raw: json };
    }

    const nameMatch =
      legalName || tradeName ? namesMatch(legalName || tradeName || "", businessName) : undefined;

    return {
      checkedAt,
      ok: true,
      status,
      legalName,
      tradeName,
      address: findAddress(json),
      nameMatch,
      raw: json,
    };
  } catch (e) {
    return { checkedAt, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
