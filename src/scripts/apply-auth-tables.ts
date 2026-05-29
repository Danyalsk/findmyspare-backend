// One-off, idempotent: create the three BetterAuth tables on the existing DB
// without touching any other table. Safe to re-run. Delete after migration.
import { db } from "../db";
import { sql } from "drizzle-orm";

async function main() {
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "auth_accounts" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
      "account_id" text NOT NULL,
      "provider_id" text NOT NULL,
      "access_token" text,
      "refresh_token" text,
      "id_token" text,
      "access_token_expires_at" timestamp with time zone,
      "refresh_token_expires_at" timestamp with time zone,
      "scope" text,
      "password" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "auth_sessions" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
      "token" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "ip_address" text,
      "user_agent" text,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
      CONSTRAINT "auth_sessions_token_unique" UNIQUE("token")
    );
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS "auth_verifications" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
      "identifier" text NOT NULL,
      "value" text NOT NULL,
      "expires_at" timestamp with time zone NOT NULL,
      "created_at" timestamp with time zone DEFAULT now() NOT NULL,
      "updated_at" timestamp with time zone DEFAULT now() NOT NULL
    );
  `);

  await db.execute(sql`CREATE INDEX IF NOT EXISTS "auth_accounts_user_id_idx" ON "auth_accounts" ("user_id");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "auth_sessions_user_id_idx" ON "auth_sessions" ("user_id");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "auth_sessions_token_idx" ON "auth_sessions" ("token");`);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS "auth_verifications_identifier_idx" ON "auth_verifications" ("identifier");`);

  console.log("✓ BetterAuth tables ready (auth_accounts, auth_sessions, auth_verifications)");
  process.exit(0);
}

main().catch((e) => {
  console.error("apply-auth-tables failed:", e);
  process.exit(1);
});
