import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";

// ─── Route Imports ───────────────────────────────────
import { authRoutes } from "./routes/auth";
import { productRoutes } from "./routes/products";
import { orderRoutes } from "./routes/orders";
import { disputeRoutes } from "./routes/disputes";
import { addressRoutes } from "./routes/addresses";
import { profileRoutes } from "./routes/profile";
import { inquiryRoutes } from "./routes/inquiries";
import { bidRoutes } from "./routes/bids";
import { notificationRoutes } from "./routes/notifications";
import { supplierRoutes } from "./routes/supplier";
import { db, closeConnection } from "./db";
import { sql } from "drizzle-orm";
import { startSocketServer, closeSocketServer } from "./lib/io";

// ─── App Configuration ──────────────────────────────
const PORT = parseInt(process.env.PORT || "8000");
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const app = new Elysia()
  // ─── Global Plugins ──────────────────────────────────
  .use(
    cors({
      origin: [FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
      methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
      credentials: true,
      allowedHeaders: ["Content-Type", "Authorization"],
    })
  )
  .use(
    swagger({
      documentation: {
        info: {
          title: "FindMySpare API",
          version: "1.0.0",
          description:
            "Auto Parts Marketplace Backend API — Built with Elysia + Bun.js + Drizzle ORM + Nhost PostgreSQL",
        },
        tags: [
          { name: "Auth", description: "Authentication & registration" },
          { name: "Products", description: "Product catalog management" },
          { name: "Orders", description: "Order lifecycle management" },
          { name: "Disputes", description: "Dispute & return management" },
          { name: "Addresses", description: "Delivery address management" },
          { name: "Profile", description: "User profile management" },
        ],
        components: {
          securitySchemes: {
            bearerAuth: {
              type: "http",
              scheme: "bearer",
              bearerFormat: "JWT",
            },
          },
        },
      },
      path: "/swagger",
    })
  )

  // ─── Global Error Handler ────────────────────────────
  .onError(({ code, error, set }) => {
    if (code === "VALIDATION") {
      set.status = 400;
      return {
        error: "Validation Error",
        message: (error as Error).message,
      };
    }

    const msg = error instanceof Error ? error.message : String(error);

    if (msg.startsWith("Unauthorized")) {
      set.status = 401;
      return { error: msg };
    }

    if (msg.startsWith("Forbidden")) {
      set.status = 403;
      return { error: msg };
    }

    console.error(`[Error] ${code}:`, msg);
    set.status = 500;
    return { error: "Internal Server Error" };
  })

  // ─── Health Check ────────────────────────────────────
  .get("/", () => ({
    name: "FindMySpare API",
    version: "1.0.0",
    status: "running",
    timestamp: new Date().toISOString(),
  }))

  .get("/health", async () => {
    let dbStatus: "connected" | "error" = "connected";
    let dbError: string | undefined;

    try {
      await db.execute(sql`SELECT 1`);
    } catch (err) {
      dbStatus = "error";
      dbError = err instanceof Error ? err.message : String(err);
    }

    return {
      status: dbStatus === "connected" ? "healthy" : "degraded",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      database: { status: dbStatus, ...(dbError && { error: dbError }) },
    };
  })

  // ─── Mount Routes ────────────────────────────────────
  .use(authRoutes)
  .use(productRoutes)
  .use(orderRoutes)
  .use(disputeRoutes)
  .use(addressRoutes)
  .use(profileRoutes)
  .use(inquiryRoutes)
  .use(bidRoutes)
  .use(notificationRoutes)
  .use(supplierRoutes)

  // ─── Start Server ────────────────────────────────────
  .listen(PORT);

const SOCKET_PORT = startSocketServer();

console.log(`
╔══════════════════════════════════════════════════╗
║          🔧 FindMySpare API Server 🔧           ║
╠══════════════════════════════════════════════════╣
║                                                  ║
║  🚀 Server:   http://localhost:${PORT}              ║
║  📖 Swagger:  http://localhost:${PORT}/swagger      ║
║  🏥 Health:   http://localhost:${PORT}/health       ║
║  📡 Socket:   ws://localhost:${SOCKET_PORT}                ║
║  🌐 Frontend: ${FRONTEND_URL.padEnd(33)}║
║                                                  ║
║  Runtime:   Bun ${Bun.version.padEnd(32)}║
║  Framework: Elysia                               ║
║  Database:  Nhost PostgreSQL (SSL)               ║
║                                                  ║
╚══════════════════════════════════════════════════╝
`);

// ─── Graceful Shutdown ─────────────────────────────────
process.on("SIGINT", async () => {
  console.log("\n⏳ Shutting down gracefully...");
  await closeSocketServer();
  await closeConnection();
  console.log("✅ Socket + database connections closed.");
  process.exit(0);
});

process.on("SIGTERM", async () => {
  await closeSocketServer();
  await closeConnection();
  process.exit(0);
});

export type App = typeof app;
