import { Elysia, t } from "elysia";
import { authGuard } from "../middleware/auth";
import { uploadFile } from "../lib/storage";

const MAX_IMAGE_BYTES = 10 * 1024 * 1024; // 10 MB for images/docs
const MAX_VIDEO_BYTES = 50 * 1024 * 1024; // 50 MB for short chat clips
const ALLOWED_MIME = new Set([
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/gif",
  "application/pdf", // GST certs may be PDFs
  // Chat video clips
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);

const KIND_FOLDER: Record<string, string> = {
  gst_cert: "gst-certificates",
  product_image: "products",
  banner_image: "banners",
  inquiry_image: "inquiries",
  message_image: "messages",
  message_video: "messages",
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

      const isVideo = file.type.startsWith("video/");
      const maxBytes = isVideo ? MAX_VIDEO_BYTES : MAX_IMAGE_BYTES;
      if (file.size > maxBytes) {
        set.status = 413;
        return { error: `File exceeds ${maxBytes / 1024 / 1024}MB limit` };
      }

      if (!ALLOWED_MIME.has(file.type)) {
        set.status = 415;
        return { error: `Unsupported MIME type: ${file.type}` };
      }

      const folder = KIND_FOLDER[kind] || "misc";
      const userScoped = `${folder}/${user.id}`;

      try {
        const uploaded = await uploadFile(file, { folder: userScoped });
        return {
          url: uploaded.url,
          id: uploaded.id,
          name: uploaded.name,
          size: uploaded.size,
          mimeType: uploaded.mimeType,
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[upload] storage error:", msg);
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
          t.Literal("message_image"),
          t.Literal("message_video"),
        ]),
      }),
      detail: { summary: "Upload a file to Vercel Blob", tags: ["Upload"] },
    }
  );
