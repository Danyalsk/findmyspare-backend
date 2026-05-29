import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Local Postgres has no SSL; cloud (Nhost) requires it.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

// postgres.js does not automatically reconnect after DNS recovers from
// NXDOMAIN. These settings keep the connection pool healthy under Nhost's
// occasional flaps. `max_lifetime` forces sockets to recycle so we don't end
// up holding stale connections to a redeployed DB.
const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  max_lifetime: 60 * 30, // 30 minutes
  ssl: isLocal ? false : "require",
  onnotice: () => {
    // Silence postgres NOTICE-level messages in app logs.
  },
});

export const db = drizzle(client, { schema });

// Cleanup interval for expired/revoked sessions. Runs on a single instance,
// every hour. Logs but never crashes the process.
import { sessions } from "./schema";
import { and, lt } from "drizzle-orm";
let cleanupTimer: ReturnType<typeof setInterval> | null = null;
function startSessionCleanup() {
  if (cleanupTimer) return;
  cleanupTimer = setInterval(async () => {
    try {
      await db
        .delete(sessions)
        .where(and(lt(sessions.expiresAt, new Date(Date.now() - 7 * 24 * 60 * 60 * 1000))));
    } catch (e) {
      console.warn("[db] session cleanup failed:", e);
    }
  }, 60 * 60 * 1000);
  cleanupTimer.unref?.();
}
if (process.env.NODE_ENV !== "test") startSessionCleanup();

export const closeConnection = async () => {
  if (cleanupTimer) clearInterval(cleanupTimer);
  await client.end();
};
