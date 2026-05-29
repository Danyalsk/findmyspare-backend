// Seed the fixed-OTP demo accounts (see DEMO_LOGINS in src/lib/auth.ts).
// Idempotent: upserts by email. Run: bun run src/scripts/seed-demo.ts
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

type Demo = Partial<typeof users.$inferInsert> & { email: string };

const DEMOS: Demo[] = [
  {
    email: "demo.supplier@findmyspare.com",
    name: "Demo Supplier",
    role: "supplier",
    phone: "+919000000001",
    phoneVerified: true,
    emailVerified: true,
    profileCompleted: true,
    isActive: true,
    verificationStatus: "approved",
    businessName: "Demo Auto Parts",
    gstNumber: "27AAACR5055K1Z7",
    panNumber: "AAACR5055K",
    businessAddress: {
      line1: "Maker Chambers IV, Nariman Point",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400021",
    },
  },
  {
    email: "demo.buyer@findmyspare.com",
    name: "Demo Buyer",
    role: "buyer",
    phone: "+919000000002",
    phoneVerified: true,
    emailVerified: true,
    profileCompleted: true,
    isActive: true,
    city: "Mumbai",
    pincode: "400001",
  },
];

async function main() {
  for (const d of DEMOS) {
    const [existing] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, d.email))
      .limit(1);
    if (existing) {
      await db.update(users).set({ ...d, updatedAt: new Date() }).where(eq(users.id, existing.id));
      console.log(`↻ updated ${d.email} (${d.role})`);
    } else {
      await db.insert(users).values(d as typeof users.$inferInsert);
      console.log(`+ created ${d.email} (${d.role})`);
    }
  }
  console.log("✓ demo accounts ready — OTP for both: 123456");
  process.exit(0);
}

main().catch((e) => {
  console.error("seed-demo failed:", e);
  process.exit(1);
});
