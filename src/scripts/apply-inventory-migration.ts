/**
 * Idempotent, additive migration for the inventory feature.
 *
 * Applied surgically (not via `drizzle-kit push`) so it touches ONLY the
 * inventory changes and never the pre-existing schema drift on unrelated
 * tables. Safe to re-run.
 *
 * Run: bun --env-file=.env run src/scripts/apply-inventory-migration.ts
 */
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL not set");

const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);
const sql = postgres(connectionString, {
  max: 1,
  ssl: isLocal ? false : "require",
  onnotice: () => {},
});

async function main() {
  // 1. Add "draft" to the product_status enum (private inventory items).
  await sql`ALTER TYPE product_status ADD VALUE IF NOT EXISTS 'draft'`;
  console.log("✓ product_status += 'draft'");

  // 2. Add low_stock_threshold to products.
  await sql`ALTER TABLE products ADD COLUMN IF NOT EXISTS low_stock_threshold integer NOT NULL DEFAULT 5`;
  console.log("✓ products.low_stock_threshold");

  // 3. Create stock_movement_reason enum if absent.
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'stock_movement_reason') THEN
        CREATE TYPE stock_movement_reason AS ENUM
          ('initial','received','damaged','correction','returned','order','order_cancelled');
      END IF;
    END $$;
  `;
  console.log("✓ stock_movement_reason enum");

  // 4. Create stock_movements ledger table.
  await sql`
    CREATE TABLE IF NOT EXISTS stock_movements (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
      supplier_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      delta integer NOT NULL,
      previous_quantity integer NOT NULL,
      new_quantity integer NOT NULL,
      reason stock_movement_reason NOT NULL,
      note text,
      created_by uuid REFERENCES users(id) ON DELETE SET NULL,
      created_at timestamptz NOT NULL DEFAULT now()
    )
  `;
  console.log("✓ stock_movements table");

  await sql`CREATE INDEX IF NOT EXISTS stock_movements_product_idx ON stock_movements(product_id)`;
  await sql`CREATE INDEX IF NOT EXISTS stock_movements_supplier_idx ON stock_movements(supplier_id)`;
  console.log("✓ stock_movements indexes");

  console.log("\n✅ Inventory migration applied.");
}

main()
  .then(() => sql.end())
  .catch(async (e) => {
    console.error("❌ Migration failed:", e);
    await sql.end();
    process.exit(1);
  });
