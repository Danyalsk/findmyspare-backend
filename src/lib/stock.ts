import { db } from "../db";
import { products, stockMovements, notifications } from "../db/schema";
import { eq } from "drizzle-orm";

export type StockMovementReason =
  | "initial"
  | "received"
  | "damaged"
  | "correction"
  | "returned"
  | "order"
  | "order_cancelled";

interface ProductStockSnapshot {
  id: string;
  supplierId: string;
  name: string;
  stockQuantity: number;
  status: string;
  lowStockThreshold: number;
}

/**
 * Apply a stock delta to a product as a single audited movement.
 *
 * - Updates `products.stockQuantity` (and auto-flips status active⇄out_of_stock
 *   for PUBLISHED listings only — drafts/paused keep their status).
 * - Appends an immutable `stock_movements` ledger row.
 * - Fires ONE `low_stock` notification when a published item crosses the
 *   threshold downward (so suppliers aren't spammed on every sale below it).
 *
 * Callers must pre-validate that `stockQuantity + delta >= 0`.
 * Shared by the inventory routes (manual adjust) and the order lifecycle
 * (deduct on placement, restock on cancellation).
 */
export async function recordStockMovement(opts: {
  product: ProductStockSnapshot;
  delta: number;
  reason: StockMovementReason;
  note?: string | null;
  createdBy?: string | null;
}) {
  const { product, delta, reason, note, createdBy } = opts;
  const previousQuantity = product.stockQuantity;
  const newQuantity = previousQuantity + delta;

  // Auto status flip applies only to published listings.
  let newStatus = product.status;
  if (product.status === "active" && newQuantity <= 0) newStatus = "out_of_stock";
  else if (product.status === "out_of_stock" && newQuantity > 0) newStatus = "active";

  const [updated] = await db
    .update(products)
    .set({ stockQuantity: newQuantity, status: newStatus as any, updatedAt: new Date() })
    .where(eq(products.id, product.id))
    .returning();

  const [movement] = await db
    .insert(stockMovements)
    .values({
      productId: product.id,
      supplierId: product.supplierId,
      delta,
      previousQuantity,
      newQuantity,
      reason,
      note: note ?? null,
      createdBy: createdBy ?? null,
    })
    .returning();

  const isPublished = product.status === "active" || product.status === "out_of_stock";
  const crossedDown =
    previousQuantity > product.lowStockThreshold &&
    newQuantity <= product.lowStockThreshold;

  if (isPublished && delta < 0 && crossedDown) {
    await db.insert(notifications).values({
      userId: product.supplierId,
      type: "low_stock",
      title: newQuantity <= 0 ? "Out of stock" : "Low stock",
      message:
        newQuantity <= 0
          ? `"${product.name}" is now out of stock.`
          : `"${product.name}" is low on stock (${newQuantity} left).`,
      metadata: { productId: product.id, newQuantity },
    });
  }

  return { product: updated, movement };
}
