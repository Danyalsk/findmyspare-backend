import { hash } from "bcryptjs";
import { randomBytes, createHash } from "crypto";
import { db } from "../db";
import {
  users,
  rejectionReasons,
  platformConfig,
  passwordResetTokens,
} from "../db/schema";
import { eq } from "drizzle-orm";
import { sendPasswordResetEmail } from "../lib/email";

const SUPER_ADMIN_EMAIL = (process.argv[2] || "contactfindmyspare@gmail.com").toLowerCase();
const SUPER_ADMIN_NAME = process.argv[3] || "FindMySpare Admin";

const REASONS = [
  { slug: "kyc_docs_missing", title: "KYC documents missing", body: "Your GST certificate or PAN details are missing or unreadable. Please re-upload clear, valid documents." },
  { slug: "gst_invalid", title: "Invalid GST number", body: "The GST number provided could not be verified. Please check and resubmit a valid GSTIN." },
  { slug: "duplicate_account", title: "Duplicate account", body: "An approved supplier account already exists for this business. Please contact support if this is an error." },
  { slug: "incomplete_profile", title: "Incomplete business profile", body: "Your business profile is missing required details. Please complete all fields and resubmit." },
  { slug: "low_quality_catalog", title: "Catalog quality", body: "Your product catalog does not yet meet our listing standards. Please review our supplier guidelines and resubmit." },
];

async function main() {
  // 1. Rejection reason templates (idempotent)
  for (let i = 0; i < REASONS.length; i++) {
    const r = REASONS[i];
    const [exists] = await db
      .select({ id: rejectionReasons.id })
      .from(rejectionReasons)
      .where(eq(rejectionReasons.slug, r.slug))
      .limit(1);
    if (!exists) {
      await db.insert(rejectionReasons).values({ ...r, sortOrder: i });
    }
  }
  console.log(`✅ Rejection templates seeded (${REASONS.length})`);

  // 2. Platform config singleton
  const cfg = await db.select().from(platformConfig).limit(1);
  if (cfg.length === 0) {
    await db.insert(platformConfig).values({ id: 1 });
    console.log("✅ platform_config row created");
  } else {
    console.log("• platform_config already exists");
  }

  // 3. Super admin user
  const [existing] = await db
    .select({ id: users.id, role: users.role })
    .from(users)
    .where(eq(users.email, SUPER_ADMIN_EMAIL))
    .limit(1);

  let userId: string;
  if (existing) {
    await db
      .update(users)
      .set({ role: "super_admin", emailVerified: true, isActive: true, updatedAt: new Date() })
      .where(eq(users.id, existing.id));
    userId = existing.id;
    console.log(`✅ Promoted existing user ${SUPER_ADMIN_EMAIL} → super_admin`);
  } else {
    const randomPassword = randomBytes(24).toString("hex");
    const passwordHash = await hash(randomPassword, 12);
    const [created] = await db
      .insert(users)
      .values({
        email: SUPER_ADMIN_EMAIL,
        name: SUPER_ADMIN_NAME,
        passwordHash,
        role: "super_admin",
        emailVerified: true,
      })
      .returning({ id: users.id });
    userId = created.id;
    console.log(`✅ Created super_admin ${SUPER_ADMIN_EMAIL}`);
  }

  // 4. Issue a password-reset token + email so the admin sets their own password
  const token = randomBytes(48).toString("hex");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  await db.insert(passwordResetTokens).values({
    userId,
    tokenHash,
    expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000), // 24h for first-time setup
  });
  await sendPasswordResetEmail(SUPER_ADMIN_EMAIL, SUPER_ADMIN_NAME, token);
  console.log(`✅ Password-setup email sent to ${SUPER_ADMIN_EMAIL} (valid 24h)`);

  process.exit(0);
}

main().catch((e) => {
  console.error("❌ seed-admin failed:", e);
  process.exit(1);
});
