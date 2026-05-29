import { Elysia, t } from "elysia";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/auth";
import { isValidGstin, isValidPan } from "../lib/gstin";
import { verifyGstin, isGstApiConfigured } from "../lib/sandbox-gst";

// Fire-and-forget: verify GSTIN via the GST API and store the result so the
// admin review screen shows live status + legal-name match.
function runGstVerification(userId: string, gstin: string, businessName: string) {
  if (!isGstApiConfigured()) return;
  verifyGstin(gstin, businessName)
    .then((result) =>
      db.update(users).set({ gstVerification: result }).where(eq(users.id, userId))
    )
    .catch((e) => console.error("[onboarding] GST verify failed:", e));
}

const onboardingBody = t.Object({
  businessName: t.String({ minLength: 2 }),
  gstNumber: t.String({ minLength: 15, maxLength: 15 }),
  panNumber: t.String({ minLength: 10, maxLength: 10 }),
  phone: t.Optional(t.String({ minLength: 10 })),
  gstCertificateUrl: t.Optional(t.String()),
  businessAddress: t.Object({
    line1: t.String({ minLength: 5 }),
    // FE sends null when blank — accept it (stored as nullable in jsonb).
    line2: t.Optional(t.Union([t.String(), t.Null()])),
    city: t.String({ minLength: 2 }),
    state: t.String({ minLength: 2 }),
    pincode: t.String({ minLength: 6, maxLength: 6 }),
  }),
});

const supplierFields = {
  id: users.id,
  email: users.email,
  name: users.name,
  role: users.role,
  phone: users.phone,
  image: users.image,
  businessName: users.businessName,
  businessType: users.businessType,
  verificationStatus: users.verificationStatus,
  gstNumber: users.gstNumber,
  panNumber: users.panNumber,
  gstCertificateUrl: users.gstCertificateUrl,
  gstVerification: users.gstVerification,
  businessAddress: users.businessAddress,
  rejectionReason: users.rejectionReason,
  createdAt: users.createdAt,
};

function validateGstPan(gstNumber: string, panNumber: string): string | null {
  if (!isValidGstin(gstNumber)) {
    return "GSTIN failed the checksum — re-check the 15-character number.";
  }
  if (!isValidPan(panNumber)) {
    return "PAN is not in a valid format (e.g. ABCDE1234F).";
  }
  return null;
}

export const supplierOnboardingRoutes = new Elysia({ prefix: "/supplier/onboarding" })
  // All onboarding routes require supplier role but NOT approved status
  .use(requireRole("supplier"))

  // ─── Get Current Onboarding State ───────────────────
  .get(
    "/",
    async ({ user }) => {
      const [profile] = await db
        .select(supplierFields)
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      return { user: profile };
    },
    { detail: { summary: "Get supplier onboarding state", tags: ["Supplier"] } }
  )

  // ─── Submit Onboarding (first submission) ───────────
  .post(
    "/",
    async ({ body, user, set }) => {
      const current = await db
        .select({ verificationStatus: users.verificationStatus })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const status = current[0]?.verificationStatus;

      // Already pending or approved — cannot resubmit via POST
      if (status === "pending" || status === "approved") {
        set.status = 409;
        return { error: `Onboarding already ${status}` };
      }

      const gst = body.gstNumber.toUpperCase();
      const pan = body.panNumber.toUpperCase();
      const vErr = validateGstPan(gst, pan);
      if (vErr) {
        set.status = 400;
        return { error: vErr };
      }

      const [updated] = await db
        .update(users)
        .set({
          businessName: body.businessName,
          gstNumber: gst,
          panNumber: pan,
          phone: body.phone ?? undefined,
          gstCertificateUrl: body.gstCertificateUrl ?? null,
          gstVerification: null, // cleared; async verify repopulates
          businessAddress: body.businessAddress,
          verificationStatus: "pending",
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning(supplierFields);

      runGstVerification(user.id, gst, body.businessName);
      return { user: updated };
    },
    {
      body: onboardingBody,
      detail: { summary: "Submit supplier onboarding for first time", tags: ["Supplier"] },
    }
  )

  // ─── Resubmit After Rejection ────────────────────────
  .patch(
    "/",
    async ({ body, user, set }) => {
      const current = await db
        .select({ verificationStatus: users.verificationStatus })
        .from(users)
        .where(eq(users.id, user.id))
        .limit(1);

      const status = current[0]?.verificationStatus;

      if (status !== "rejected" && status !== "not_submitted") {
        set.status = 409;
        return { error: `Cannot resubmit when status is '${status}'` };
      }

      const gst = body.gstNumber.toUpperCase();
      const pan = body.panNumber.toUpperCase();
      const vErr = validateGstPan(gst, pan);
      if (vErr) {
        set.status = 400;
        return { error: vErr };
      }

      const [updated] = await db
        .update(users)
        .set({
          businessName: body.businessName,
          gstNumber: gst,
          panNumber: pan,
          phone: body.phone ?? undefined,
          gstCertificateUrl: body.gstCertificateUrl ?? null,
          gstVerification: null,
          businessAddress: body.businessAddress,
          verificationStatus: "pending",
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning(supplierFields);

      runGstVerification(user.id, gst, body.businessName);
      return { user: updated };
    },
    {
      body: onboardingBody,
      detail: { summary: "Resubmit supplier onboarding after rejection", tags: ["Supplier"] },
    }
  );
