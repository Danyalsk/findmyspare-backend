import { Elysia, t } from "elysia";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";
import { requireRole } from "../middleware/auth";

const onboardingBody = t.Object({
  businessName: t.String({ minLength: 2 }),
  gstNumber: t.String({ minLength: 15, maxLength: 15 }),
  panNumber: t.String({ minLength: 10, maxLength: 10 }),
  phone: t.Optional(t.String({ minLength: 10 })),
  gstCertificateUrl: t.Optional(t.String()),
  businessAddress: t.Object({
    line1: t.String({ minLength: 5 }),
    line2: t.Optional(t.String()),
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
  businessAddress: users.businessAddress,
  rejectionReason: users.rejectionReason,
  createdAt: users.createdAt,
};

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

      const [updated] = await db
        .update(users)
        .set({
          businessName: body.businessName,
          gstNumber: body.gstNumber,
          panNumber: body.panNumber,
          phone: body.phone ?? undefined,
          gstCertificateUrl: body.gstCertificateUrl ?? null,
          businessAddress: body.businessAddress,
          verificationStatus: "pending",
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning(supplierFields);

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

      const [updated] = await db
        .update(users)
        .set({
          businessName: body.businessName,
          gstNumber: body.gstNumber,
          panNumber: body.panNumber,
          phone: body.phone ?? undefined,
          gstCertificateUrl: body.gstCertificateUrl ?? null,
          businessAddress: body.businessAddress,
          verificationStatus: "pending",
          rejectionReason: null,
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning(supplierFields);

      return { user: updated };
    },
    {
      body: onboardingBody,
      detail: { summary: "Resubmit supplier onboarding after rejection", tags: ["Supplier"] },
    }
  );
