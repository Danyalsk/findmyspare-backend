import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL environment variable is not set");
}

// Local Postgres has no SSL; cloud (Nhost) requires it.
const isLocal = /@(localhost|127\.0\.0\.1)[:/]/.test(connectionString);

const client = postgres(connectionString, {
  max: 10,
  idle_timeout: 20,
  connect_timeout: 10,
  ssl: isLocal ? false : "require",
});

export const db = drizzle(client, { schema });

// Export for use in graceful shutdown
export const closeConnection = async () => {
  await client.end();
};
