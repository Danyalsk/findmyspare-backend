import { Server as IOServer, type Socket } from "socket.io";
import { createServer, type Server as HttpServer } from "node:http";
import { jwtVerify } from "jose";
import { db } from "../db";
import { users } from "../db/schema";
import { eq } from "drizzle-orm";

const FRONTEND_URL = process.env.FRONTEND_URL || "http://localhost:3000";
const SOCKET_PORT = parseInt(process.env.SOCKET_PORT || "8001");
const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "fallback-secret-change-me"
);

const httpServer: HttpServer = createServer();

export const io = new IOServer(httpServer, {
  cors: {
    origin: [FRONTEND_URL, "http://localhost:3000", "http://localhost:3001"],
    credentials: true,
  },
});

io.use(async (socket: Socket, next) => {
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
  } catch (err) {
    next(new Error("Unauthorized: token verify failed"));
  }
});

io.on("connection", (socket: Socket) => {
  const { userId, role } = socket.data as { userId: string; role: string };

  if (role === "supplier") socket.join("suppliers");
  socket.join(`user:${userId}`);

  console.log(`[socket] ${userId} connected (role=${role})`);

  socket.on("disconnect", (reason) => {
    console.log(`[socket] ${userId} disconnected (${reason})`);
  });
});

export function startSocketServer(): number {
  httpServer.listen(SOCKET_PORT);
  return SOCKET_PORT;
}

export function closeSocketServer(): Promise<void> {
  return new Promise((resolve) => {
    io.close(() => httpServer.close(() => resolve()));
  });
}

export function broadcastInquiryCreated(inquiry: unknown): void {
  io.to("suppliers").emit("inquiry:created", inquiry);
}
