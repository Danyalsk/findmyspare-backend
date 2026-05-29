import { db } from "../db";
import { sql } from "drizzle-orm";

// Existing accounts (created before OTP signup) already have names/roles —
// mark them profile-complete so they skip the one-time profile step.
async function main() {
  const res = await db.execute(
    sql`UPDATE users SET profile_completed = true WHERE name IS NOT NULL AND name <> ''`
  );
  console.log("✅ Backfilled profile_completed for existing users:", (res as { count?: number }).count ?? "done");
  process.exit(0);
}

main().catch((e) => {
  console.error("❌ backfill failed:", e);
  process.exit(1);
});
