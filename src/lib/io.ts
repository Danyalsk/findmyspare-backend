import { Server as IOServer, type Socket } from "socket.io";
import type { Server as HttpServer } from "node:http";
import { jwtVerify } from "jose";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "dev-only-secret-change-me"
);

let _io: IOServer | null = null;

// Call once from index.ts, passing the shared http.Server and the same
// CORS origin list the REST API uses. Without this, socket connections
// from the prod Vercel domain are rejected.
export function initSocketServer(
  httpServer: HttpServer,
  corsOrigins: string[]
): IOServer {
  _io = new IOServer(httpServer, {
    cors: {
      origin: corsOrigins,
      credentials: true,
    },
    // Allow both ws:// and polling transports
    transports: ["websocket", "polling"],
  });

  _io.use(async (socket: Socket, next) => {
    try {
      const token =
        (socket.handshake.auth?.token as string | undefined) ||
        (socket.handshake.query?.token as string | undefined);

      if (!token) return next(new Error("Unauthorized: missing token"));

      const { payload } = await jwtVerify(token, JWT_SECRET);
      if (!payload?.sub) return next(new Error("Unauthorized: invalid token"));

      const [u] = await db
        .select({ id: users.id, role: users.role, name: users.name, isActive: users.isActive })
        .from(users)
        .where(eq(users.id, payload.sub as string))
        .limit(1);

      if (!u || !u.isActive) return next(new Error("Unauthorized: user inactive"));

      socket.data.userId = u.id;
      socket.data.role = u.role;
      socket.data.name = u.name;
      next();
    } catch {
      next(new Error("Unauthorized: token verify failed"));
    }
  });

  _io.on("connection", (socket: Socket) => {
    const { userId, role } = socket.data as { userId: string; role: string };

    if (role === "supplier") socket.join("suppliers");
    socket.join(`user:${userId}`);

    console.log(`[socket] ${userId} connected (role=${role})`);

    // Typing indicator relay: client emits { to: userId } and we forward
    // to that user's room as { from: userId }
    socket.on("typing:start", (payload: { to?: string }) => {
      if (!payload?.to) return;
      _io!.to(`user:${payload.to}`).emit("typing:start", { from: userId });
    });
    socket.on("typing:stop", (payload: { to?: string }) => {
      if (!payload?.to) return;
      _io!.to(`user:${payload.to}`).emit("typing:stop", { from: userId });
    });

    socket.on("disconnect", (reason) => {
      console.log(`[socket] ${userId} disconnected (${reason})`);
    });
  });

  return _io;
}

export function getIO(): IOServer {
  if (!_io) throw new Error("Socket.io not initialized — call initSocketServer first");
  return _io;
}

export async function closeSocketServer(): Promise<void> {
  if (!_io) return;
  await new Promise<void>((resolve) => _io!.close(() => resolve()));
  _io = null;
}

export function broadcastInquiryCreated(inquiry: unknown): void {
  getIO().to("suppliers").emit("inquiry:created", inquiry);
}

export function broadcastNewMessage(receiverId: string, message: unknown): void {
  getIO().to(`user:${receiverId}`).emit("message:new", message);
}

export function broadcastMessageRead(senderId: string, readByUserId: string): void {
  getIO().to(`user:${senderId}`).emit("message:read", { readByUserId });
}
