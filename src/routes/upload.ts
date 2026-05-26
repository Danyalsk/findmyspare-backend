import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { uploadToNhost } from "../lib/storage";

const MAX_FILE_BYTES = 10 * 1024 * 1024; // 10 MB hard cap
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf", // GST certs may be PDFs
]);

const KIND_FOLDER: Record<string, string> = {
  gst_cert: "gst-certificates",
  product_image: "products",
  banner_image: "banners",
  inquiry_image: "inquiries",
};

export const uploadRoutes = new Elysia({ prefix: "/upload" })
  .use(authGuard)
  .post(
    "/",
    async ({ body, set, user }) => {
      const { file, kind } = body;

      if (!(file instanceof File)) {
        set.status = 400;
        return { error: "file is required (multipart)" };
      }

      if (file.size > MAX_FILE_BYTES) {
        set.status = 413;
        return { error: `File exceeds ${MAX_FILE_BYTES / 1024 / 1024}MB limit` };
      }

      if (!ALLOWED_MIME.has(file.type)) {
        set.status = 415;
        return { error: `Unsupported MIME type: ${file.type}` };
      }

      const folder = KIND_FOLDER[kind] || "misc";
      const userScoped = `${folder}/${user.id}`;

      try {
        const uploaded = await uploadToNhost(file, { folder: userScoped });
        return {
          url: uploaded.url,
          id: uploaded.id,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[upload] Nhost error:", msg);
        set.status = 502;
        return { error: "Storage upload failed" };
      }
    },
    {
      body: t.Object({
        file: t.File(),
        kind: t.Union([
          t.Literal("gst_cert"),
          t.Literal("product_image"),
          t.Literal("banner_image"),
          t.Literal("inquiry_image"),
        ]),
      }),
      detail: { summary: "Upload a file to Nhost Storage", tags: ["Upload"] },
    }
  );
