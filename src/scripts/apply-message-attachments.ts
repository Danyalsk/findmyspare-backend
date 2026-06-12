/**
 * Idempotent additive migration: messages.attachments (chat image/video).
 * Run: bun --env-file=.env run src/scripts/apply-message-attachments.ts
 */
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL not set");

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const sql = postgres(connectionString, { max: 1, ssl: isLocal ? false : "require", onnotice: () => {} });

async function main() {
  await sql`ALTER TABLE messages ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb`;
  console.log("✓ messages.attachments");
  console.log("\n✅ Message-attachments migration applied.");
}

main().then(() => sql.end()).catch(async (e) => {
  console.error("❌ Migration failed:", e);
  await sql.end();
  process.exit(1);
});
