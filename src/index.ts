import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { swagger } from "@elysiajs/swagger";
import { createServer } from "node:http";
import type { IncomingMessage, ServerResponse } from "node:http";

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
import { supplierOnboardingRoutes } from "./routes/supplier-onboarding";
import { adminRoutes } from "./routes/admin";
import { bannerRoutes } from "./routes/banners";
import { uploadRoutes } from "./routes/upload";
import { messageRoutes } from "./routes/messages";
import { db, closeConnection } from "./db";
import { sql } from "drizzle-orm";
import { initSocketServer, closeSocketServer } from "./lib/io";

// ─── App Configuration ──────────────────────────────
const PORT = parseInt(process.env.PORT || "8000");
const NODE_ENV = process.env.NODE_ENV || "development";
const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";

const corsOrigins = NODE_ENV === "production"
  ? [FRONTEND_URL]
  : [FRONTEND_URL, "http://localhost:3000", "http://localhost:3001", "http://localhost:5001"];

// ─── Elysia App ──────────────────────────────────────
const app = new Elysia()
  .use(
    cors({
      origin: corsOrigins,
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
          description: "Auto Parts Marketplace — Elysia + Bun + Drizzle ORM + Nhost PostgreSQL",
        },
        tags: [
          { name: "Auth", description: "Authentication & registration" },
          { name: "Products", description: "Product catalog management" },
          { name: "Orders", description: "Order lifecycle management" },
          { name: "Disputes", description: "Dispute & return management" },
          { name: "Addresses", description: "Delivery address management" },
          { name: "Profile", description: "User profile management" },
          { name: "Inquiries", description: "Part inquiry / request system" },
          { name: "Bids", description: "Supplier bid management" },
          { name: "Notifications", description: "User notifications" },
          { name: "Supplier", description: "Supplier dashboard & onboarding" },
          { name: "Admin", description: "Admin panel" },
          { name: "Banners", description: "Homepage banners" },
          { name: "Upload", description: "File upload (Nhost Storage)" },
          { name: "Messages", description: "Real-time 1:1 chat" },
        ],
        components: {
          securitySchemes: {
            bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT" },
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
      return { error: "Validation Error", message: (error as Error).message };
    }

    const msg = error instanceof Error ? error.message : String(error);

    if (msg.startsWith("Unauthorized")) { set.status = 401; return { error: msg }; }
    if (msg.startsWith("Forbidden"))    { set.status = 403; return { error: msg }; }

    console.error(`[Error] ${code}:`, msg);
    set.status = 500;
    return { error: "Internal Server Error" };
  })

  // ─── Health Endpoints ────────────────────────────────
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
  .use(supplierOnboardingRoutes)
  .use(adminRoutes)
  .use(bannerRoutes)
  .use(uploadRoutes)
  .use(messageRoutes);

// ─── Shared HTTP Server (Elysia + Socket.io on same port) ───
// Bun's node:http is fully compatible. Socket.io intercepts WebSocket
// upgrade requests before they reach the Elysia fetch handler.
const httpServer = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  // Collect body for non-GET requests
  let bodyBuffer: Buffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    bodyBuffer = await new Promise<Buffer>((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks)));
      req.on("error", reject);
    });
  }

  const url = `http://localhost:${PORT}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (v) headers.set(k, Array.isArray(v) ? v.join(", ") : v);
  }

  const request = new Request(url, {
    method: req.method ?? "GET",
    headers,
    body: bodyBuffer?.length ? bodyBuffer.buffer.slice(bodyBuffer.byteOffset, bodyBuffer.byteOffset + bodyBuffer.byteLength) as ArrayBuffer : undefined,
  });

  const response = await app.fetch(request);

  const resHeaders: Record<string, string> = {};
  response.headers.forEach((v, k) => { resHeaders[k] = v; });
  res.writeHead(response.status, resHeaders);

  if (response.body) {
    const reader = response.body.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      res.write(value);
    }
  }
  res.end();
});

// Attach socket.io to the shared HTTP server
initSocketServer(httpServer);

httpServer.listen(PORT, () => {
  console.log(`
╔══════════════════════════════════════════════════╗
║          FindMySpare API Server                  ║
╠══════════════════════════════════════════════════╣
║  HTTP:    http://localhost:${PORT}                  ║
║  WS:      ws://localhost:${PORT}  (same port)       ║
║  Swagger: http://localhost:${PORT}/swagger          ║
║  Health:  http://localhost:${PORT}/health           ║
║  Env:     ${NODE_ENV.padEnd(38)}║
║  Bun:     ${Bun.version.padEnd(38)}║
╚══════════════════════════════════════════════════╝
  `);
});

// ─── Graceful Shutdown ─────────────────────────────────
async function shutdown() {
  console.log("\n⏳ Shutting down...");
  await closeSocketServer();
  await closeConnection();
  httpServer.close(() => {
    console.log("✅ Server closed.");
    process.exit(0);
  });
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

export type App = typeof app;
