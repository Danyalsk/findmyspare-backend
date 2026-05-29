// ─── Vercel Blob Storage ─────────────────────────────
// Server-side file uploads (GST certs, product/banner images) to Vercel Blob.
// Returns a public CDN URL. Works from any runtime (Bun/Render) as long as
// BLOB_READ_WRITE_TOKEN is set — get it from the Vercel dashboard:
//   Storage → (create/select a Blob store) → ".env.local" tab → BLOB_READ_WRITE_TOKEN
// Then set the same token in this backend's env (local .env + Render).

import { put, del } from "@vercel/blob";

const TOKEN = process.env.BLOB_READ_WRITE_TOKEN;

export interface UploadedFile {
  id: string; // blob pathname — pass to deleteFile()
  name: string;
  url: string; // public CDN URL
  mimeType: string;
  size: number;
}

export function isStorageConfigured(): boolean {
  return Boolean(TOKEN);
}

export async function uploadFile(
  file: File,
  opts?: { folder?: string }
): Promise<UploadedFile> {
  if (!TOKEN) {
    throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  }

  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const pathname = opts?.folder ? `${opts.folder}/${safeName}` : safeName;

  const blob = await put(pathname, file, {
    access: "public",
    token: TOKEN,
    // Avoid collisions — Vercel appends a random suffix to the pathname.
    addRandomSuffix: true,
    contentType: file.type || undefined,
  });

  return {
    id: blob.pathname,
    name: safeName,
    url: blob.url,
    mimeType: blob.contentType || file.type || "application/octet-stream",
    size: file.size,
  };
}

// Accepts the public URL (what we store) or the blob pathname.
export async function deleteFile(urlOrPathname: string): Promise<void> {
  if (!TOKEN) throw new Error("BLOB_READ_WRITE_TOKEN is not configured");
  await del(urlOrPathname, { token: TOKEN });
}
