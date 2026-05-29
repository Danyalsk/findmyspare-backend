# FindMySpare — Backend

## Overview

REST API backend for the FindMySpare auto-parts marketplace. Serves both the Next.js web frontend and the Expo React Native mobile app.

**Indian market** — currency is INR (₹), vehicle data covers Indian makes (Maruti Suzuki, Hyundai, Tata, Mahindra, etc.).

## Tech Stack

| Layer         | Technology                                      |
| ------------- | ----------------------------------------------- |
| Runtime       | **Bun** (latest)                                |
| Framework     | **Elysia** v1.2 (Bun-native HTTP framework)     |
| ORM           | **Drizzle ORM** with `postgres` driver           |
| Database      | **Nhost PostgreSQL** (cloud, SSL required)       |
| Auth          | **BetterAuth** (email-OTP + bearer tokens, DB sessions, 30d). Legacy JWT (`@elysiajs/jwt`) kept only for the mobile app |
| Password hash | **bcryptjs**                                     |
| Docs          | **Swagger** at `/swagger`                        |

## Project Structure

```
src/
├── index.ts              # App entry — plugins, error handler, route mounting, server start
├── db/
│   ├── index.ts           # Drizzle client + connection pool (max 10, SSL required)
│   └── schema/            # Drizzle table definitions — one file per domain
│       ├── index.ts       # Central re-export barrel
│       ├── users.ts
│       ├── products.ts
│       ├── orders.ts
│       ├── addresses.ts
│       ├── escrow.ts
│       ├── disputes.ts
│       ├── notifications.ts
│       └── inquiries.ts
├── middleware/
│   └── auth.ts            # jwtPlugin, authGuard (derive user), requireRole("buyer"|"supplier")
├── routes/                # Elysia route modules — each exports a plugin
│   ├── auth.ts            # POST /auth/register, /auth/login
│   ├── products.ts        # CRUD — supplier creates, buyer browses
│   ├── orders.ts          # Order lifecycle (place → confirm → ship → deliver)
│   ├── disputes.ts        # Dispute & return management
│   ├── addresses.ts       # Delivery address CRUD
│   ├── profile.ts         # User profile read/update
│   └── inquiries.ts       # Part inquiry / request system
├── lib/
│   └── pagination.ts      # Pagination helper
├── drizzle.config.ts      # Drizzle Kit config (schema → ./drizzle migrations)
└── .env                   # DATABASE_URL, JWT_SECRET, PORT, FRONTEND_URL
```

## Key Commands

```bash
# Development (hot-reload)
bun run dev              # bun run --watch src/index.ts

# Production
bun run start            # bun run src/index.ts

# Database
bun run db:generate      # Generate Drizzle migrations
bun run db:push          # Push schema to database
bun run db:studio        # Open Drizzle Studio GUI
```

## Environment Variables

| Variable       | Description                      | Default                    |
| -------------- | -------------------------------- | -------------------------- |
| `DATABASE_URL`        | Nhost Postgres connection string            | *(required)* |
| `JWT_SECRET`   | HMAC secret for JWT signing      | `fallback-secret-change-me`|
| `PORT`         | HTTP listen port                 | `8000`                     |
| `FRONTEND_URL` | Allowed CORS origin              | `http://localhost:3000`    |

## Architecture Conventions

### Authentication Flow

Web auth runs on **BetterAuth** (`src/lib/auth.ts`), mounted at `/api/auth/*` in
`src/index.ts` (handled before Elysia to avoid double body-parsing). It uses the
`emailOTP` + `bearer` plugins; the BetterAuth `user` model is mapped onto the
existing `users` table, with sessions/accounts/verifications in `auth_sessions` /
`auth_accounts` / `auth_verifications`. Bearer tokens map to DB session rows, so
**sign-out deletes the row and the token dies immediately** (no stale-JWT window).

1. `auth` (BetterAuth instance) — issues + validates bearer session tokens.
2. `authGuard` (`src/middleware/auth.ts`) — derives `{ user }` via
   `auth.api.getSession`, falling back to a **legacy JWT** verify for the mobile
   app (deprecated). It also enforces the **profile gate**: until
   `user.profileCompleted` is true (set by `POST /auth/complete-profile`), every
   protected route returns 403 `PROFILE_INCOMPLETE` (admins + a small allow-list
   of endpoints are exempt).
3. `requireRole(...)` / `requireApprovedSupplier` / `requireAdmin` — role guards
   layered on top of `authGuard`.

Legacy `/auth/*` routes (register/login/refresh/otp/magic) remain mounted for the
Expo mobile app only — remove once mobile migrates to `/api/auth/*`.

**Deploy note:** new environments need the BetterAuth tables — run
`bun run src/scripts/apply-auth-tables.ts` (idempotent) against the target DB, and
set `BETTER_AUTH_SECRET` (+ `BACKEND_URL` in prod).

### Roles

The app has exactly two user roles: **buyer** and **supplier**. Role is set at registration and determines which routes and features are available.

### Error Handling

The global `onError` handler maps known error prefixes to HTTP status codes:
- `"Unauthorized"` → 401
- `"Forbidden"` → 403
- Elysia `VALIDATION` code → 400
- Everything else → 500 (with server-side logging)

### Database Patterns

- All schema files are in `src/db/schema/` and re-exported from `schema/index.ts`.
- The Drizzle client is a singleton exported from `src/db/index.ts`.
- Connection uses SSL (`ssl: "require"`) — required for Nhost.
- Graceful shutdown closes the connection pool on `SIGINT`/`SIGTERM`.

### Adding a New Route Module

1. Create `src/routes/<domain>.ts` exporting an Elysia plugin.
2. Use `.use(authGuard)` or `.use(requireRole("buyer"))` for protected routes.
3. Import and `.use()` it in `src/index.ts`.
4. Add a Swagger tag in the `swagger()` config.

### Adding a New Schema Table

1. Create `src/db/schema/<table>.ts` defining the Drizzle table.
2. Re-export it from `src/db/schema/index.ts`.
3. Run `bun run db:generate` then `bun run db:push`.

## CORS

Origins allowed: `FRONTEND_URL`, `http://localhost:3000`, `http://localhost:3001`.
Credentials are enabled. Allowed headers: `Content-Type`, `Authorization`.

## Health Endpoints

- `GET /` — API info + timestamp
- `GET /health` — uptime + timestamp
