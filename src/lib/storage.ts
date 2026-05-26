// ─── Nhost Storage Client ────────────────────────────
// Server-side helper to upload files to Nhost Storage and return a public URL.
// Uses NHOST_SUBDOMAIN + NHOST_REGION + NHOST_ADMIN_SECRET from env.
//
// Storage REST API reference:
//   POST  https://{subdomain}.storage.{region}.nhost.run/v1/files
//   GET   https://{subdomain}.storage.{region}.nhost.run/v1/files/{file_id}/presignedurl
//   DELETE …/files/{file_id}
//
// We upload to a known bucket (default: "default") and rely on a public
// bucket policy so the returned URL is directly viewable.

const SUBDOMAIN = process.env.NHOST_SUBDOMAIN;
const REGION = process.env.NHOST_REGION;
const ADMIN_SECRET = process.env.NHOST_ADMIN_SECRET;
const BUCKET_ID = process.env.NHOST_BUCKET_ID || "default";

function storageBaseUrl() {
  if (!SUBDOMAIN || !REGION) {
    throw new Error(
      "Nhost storage not configured: set NHOST_SUBDOMAIN and NHOST_REGION"
    );
  }
  return `https://${SUBDOMAIN}.storage.${REGION}.nhost.run/v1`;
}

export interface UploadedFile {
  id: string;
  name: string;
  url: string;
  mimeType: string;
  size: number;
}

export async function uploadToNhost(
  file: File,
  opts?: { folder?: string }
): Promise<UploadedFile> {
  if (!ADMIN_SECRET) {
    throw new Error("NHOST_ADMIN_SECRET is not configured");
  }

  // Sanitize filename and prefix with folder
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
  const stamped = `${Date.now()}_${safeName}`;
  const finalName = opts?.folder ? `${opts.folder}/${stamped}` : stamped;

  const form = new FormData();
  form.append("bucket-id", BUCKET_ID);
  form.append("file[]", file, finalName);

  const res = await fetch(`${storageBaseUrl()}/files`, {
    method: "POST",
    headers: { "x-hasura-admin-secret": ADMIN_SECRET },
    body: form,
  });

  if (!res.ok) {
    const txt = await res.text().catch(() => "");
    throw new Error(`Nhost upload failed: ${res.status} ${txt}`);
  }

  const data = (await res.json()) as {
    processedFiles: Array<{
      id: string;
      name: string;
      mimeType: string;
      size: number;
      bucketId: string;
    }>;
  };

  const f = data.processedFiles?.[0];
  if (!f) throw new Error("Nhost upload returned no file");

  // Public URL pattern: {storage}/files/{id}
  const url = `${storageBaseUrl()}/files/${f.id}`;

  return {
    id: f.id,
    name: f.name,
    url,
    mimeType: f.mimeType,
    size: f.size,
  };
}

export async function deleteFromNhost(fileId: string): Promise<void> {
  if (!ADMIN_SECRET) throw new Error("NHOST_ADMIN_SECRET is not configured");
  const res = await fetch(`${storageBaseUrl()}/files/${fileId}`, {
    method: "DELETE",
    headers: { "x-hasura-admin-secret": ADMIN_SECRET },
  });
  if (!res.ok && res.status !== 404) {
    throw new Error(`Nhost delete failed: ${res.status}`);
  }
}
