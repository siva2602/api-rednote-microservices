# Rednote Auth Service

JWT-based authentication microservice for the Rednote social media platform. Built with **Fastify**, **TypeScript**, **Prisma**, **PostgreSQL**, **Redis**, and **RS256** asymmetric JWTs.

## Architecture

```mermaid
flowchart LR
  Client -->|register/login/refresh/logout| AuthService
  AuthService -->|source of truth| PostgreSQL
  AuthService -->|cache + blacklist| Redis
  OtherMS -->|verify JWT locally| PublicKey
  OtherMS -->|check jti blacklist| Redis
```

### Revocation strategy

| Token type | Storage | Revocation |
|------------|---------|------------|
| **Refresh token** | SHA-256 hash in PostgreSQL (source of truth) + Redis cache | Mark `revoked=true` in Postgres, delete Redis key on logout/rotation |
| **Access token** | Stateless JWT (15 min TTL) | Add `jti` to Redis blacklist with TTL = remaining token life on logout |

Other microservices verify access tokens **locally** using the public key — no HTTP call to this service on every request.

## Prerequisites

- Node.js 20+
- Redis (local install or Docker)
- OpenSSL (for RSA key generation)
- Docker & Docker Compose — **optional** (see [Docker setup](#optional-docker-setup))

## Quick start (no Docker)

This is the recommended path for local development.

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Default `DATABASE_URL` uses **port 5433** (embedded Postgres from `dev:local`):

```
postgresql://auth:auth@localhost:5433/auth_db
```

### 3. Generate RSA key pair

```bash
npm run keys:generate
```

Creates `keys/private.pem` (signing) and `keys/public.pem` (verification by other services).

### 4. Ensure Redis is running

```bash
redis-cli ping
# → PONG
```

### 5. Start Postgres + API (one command)

```bash
npm run dev:local
```

This script:

1. Starts **embedded Postgres** on port **5433**
2. Runs `prisma migrate deploy` automatically
3. Starts the API with hot reload on **http://localhost:3001**

### 6. Open Swagger UI

**http://localhost:3001/docs**

---

## npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev:local` | Embedded Postgres + migrations + API (recommended) |
| `npm run dev:local:reset` | Wipe Postgres data dir and restart fresh |
| `npm run dev` | API only (requires Postgres + Redis already running) |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm start` | Run compiled production build |
| `npm test` | Run integration tests (15 tests) |
| `npm run keys:generate` | Generate RS256 key pair in `keys/` |
| `npm run prisma:generate` | Generate Prisma client |
| `npm run prisma:deploy` | Apply migrations (no shadow DB — use this) |
| `npm run prisma:migrate` | Create new migrations (`migrate dev` — needs CREATEDB) |
| `npm run prisma:studio` | Open Prisma Studio at http://localhost:5555 |
| `npm run docs:generate` | Export OpenAPI spec to `docs/openapi.json` |

---

## Database

### Connection strings

| Setup | URL | When to use |
|-------|-----|-------------|
| **Embedded Postgres** | `postgresql://auth:auth@localhost:5433/auth_db` | `npm run dev:local` (default in `.env`) |
| **Docker / system Postgres** | `postgresql://auth:auth@localhost:5432/auth_db` | `docker compose up -d` |

### Connect with psql

```bash
PGPASSWORD=auth psql -h localhost -p 5433 -U auth -d auth_db
```

### Connect with GUI (DBeaver, pgAdmin, TablePlus)

| Field | Value |
|-------|-------|
| Host | `localhost` |
| Port | `5433` (dev:local) or `5432` (Docker) |
| Database | `auth_db` |
| Username | `auth` |
| Password | `auth` |

### Prisma Studio

```bash
npm run prisma:studio
```

Browse `users` and `refresh_tokens` at http://localhost:5555

### Migrations

**Apply existing migrations** (recommended — no shadow database required):

```bash
npm run prisma:deploy
```

**Create a new migration** after changing `prisma/schema.prisma`:

```bash
# dev:local must be running (Postgres on 5433)
npm run prisma:migrate
```

> **Note:** `prisma migrate dev` needs permission to create a temporary shadow database. If you see `P3014 permission denied to create database` on port 5432, either use `dev:local` (port 5433) or run `sudo -u postgres psql -c "ALTER USER auth CREATEDB;"`.

### Tables

| Table | Purpose |
|-------|---------|
| `users` | Accounts (email, username, password_hash, role) |
| `refresh_tokens` | Hashed refresh tokens with expiry and revocation |

---

## Environment variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `NODE_ENV` | No | `development` | Runtime environment |
| `PORT` | No | `3001` | HTTP port |
| `DATABASE_URL` | Yes | — | PostgreSQL connection string |
| `REDIS_URL` | Yes | — | Redis connection string |
| `JWT_PRIVATE_KEY_PATH` | Yes | — | Path to RSA private PEM |
| `JWT_PUBLIC_KEY_PATH` | Yes | — | Path to RSA public PEM |
| `ACCESS_TOKEN_TTL_SECONDS` | No | `900` | Access token lifetime (15 min) |
| `REFRESH_TOKEN_TTL_SECONDS` | No | `604800` | Refresh token lifetime (7 days) |
| `CORS_ORIGINS` | No | `http://localhost:3000` | Comma-separated allowed origins |
| `REDIS_BLACKLIST_FAIL_MODE` | No | `closed` | `open` or `closed` when Redis is down |
| `DOCS_ENABLED` | No | `true` in dev | Enable Swagger UI at `/docs` |

---

## API endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/auth/register` | No | Create account, return tokens |
| POST | `/auth/login` | No | Login with email or username |
| POST | `/auth/refresh` | No | Rotate refresh token, new token pair |
| POST | `/auth/logout` | Bearer + body | Revoke tokens |
| GET | `/auth/verify` | Bearer | Decode JWT claims (test endpoint) |
| GET | `/auth/me` | Bearer | Current user profile |
| GET | `/auth/users/:user_id` | Bearer | Public profile by UUID |
| GET | `/auth/users/by-username/:username` | Bearer | Public profile by username |

Interactive docs: **http://localhost:3001/docs**

### POST /auth/register

```bash
curl -X POST http://localhost:3001/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"user@example.com","username":"myuser","password":"password123"}'
```

Response `201`:

```json
{
  "access_token": "...",
  "refresh_token": "...",
  "expires_in": 900
}
```

### POST /auth/login

Accepts email **or** username in the `identifier` field.

```bash
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"user@example.com","password":"password123"}'
```

### POST /auth/refresh

Rotates the refresh token on every use.

```bash
curl -X POST http://localhost:3001/auth/refresh \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"..."}'
```

### POST /auth/logout

Requires `Authorization: Bearer <access_token>` and refresh token in body.

```bash
curl -X POST http://localhost:3001/auth/logout \
  -H "Authorization: Bearer <access_token>" \
  -H "Content-Type: application/json" \
  -d '{"refresh_token":"..."}'
```

### GET /auth/verify

```bash
curl http://localhost:3001/auth/verify \
  -H "Authorization: Bearer <access_token>"
```

### GET /auth/me

Returns the authenticated user's identity. **Email is never included.**

```bash
curl http://localhost:3001/auth/me \
  -H "Authorization: Bearer <access_token>"
```

Response `200`:

```json
{
  "id": "uuid",
  "username": "myuser",
  "role": "user",
  "created_at": "2026-06-28T12:00:00.000Z",
  "updated_at": "2026-06-28T12:00:00.000Z"
}
```

### GET /auth/users/:user_id

Public identity lookup for other microservices (no email).

```bash
curl http://localhost:3001/auth/users/<user_id> \
  -H "Authorization: Bearer <access_token>"
```

### GET /auth/users/by-username/:username

```bash
curl http://localhost:3001/auth/users/by-username/myuser \
  -H "Authorization: Bearer <access_token>"
```

---

## JWT claims

Access tokens are signed with **RS256** and contain:

| Claim | Description |
|-------|-------------|
| `sub` | User UUID |
| `role` | User role (`user`, etc.) |
| `jti` | Unique token ID for blacklist/revocation |
| `iat` | Issued at |
| `exp` | Expiration |

No email, username, or other PII is included in the JWT payload.

---

## Microservice architecture coverage

This auth service is the **identity & token** layer.

| Concern | Covered here? | Where it lives |
|---------|---------------|----------------|
| Register / login / logout | Yes | Auth Service |
| JWT issue & refresh (RS256) | Yes | Auth Service |
| Token blacklist (Redis jti) | Yes | Auth Service |
| Local JWT verify (no HTTP call) | Yes | `verify.middleware.ts` |
| User identity (id, username, role) | Yes | `/auth/me`, `/auth/users/*` |
| Password hashing (argon2) | Yes | Auth Service |
| Rate limiting on auth endpoints | Yes | Auth Service |
| Swagger API docs | Yes | `/docs` |
| User profile (bio, avatar, cover) | No | **Profile Service** |
| Posts, feed, likes, comments | No | **Content/Feed Service** |
| Followers / following graph | No | **Social Graph Service** |
| Notifications | No | **Notification Service** |
| API gateway / routing | No | **Gateway** |
| Email verification / password reset | No | Future / **Notification Service** |

```mermaid
flowchart TB
  subgraph gateway [API Gateway]
    GW[Gateway]
  end
  subgraph auth_svc [Auth Service]
    AuthAPI[register login refresh logout]
    UserAPI["/auth/me /auth/users"]
    JWT[JWT RS256 + Redis blacklist]
  end
  subgraph other [Other Microservices]
    Profile[Profile Service]
    Feed[Feed Service]
  end
  Client --> GW
  GW --> AuthAPI
  GW --> Profile
  GW --> Feed
  Profile -->|"JWT verify locally"| JWT
  Feed -->|"GET /auth/users/:id"| UserAPI
```

**Pattern for other services:** verify JWT locally with the public key + Redis blacklist. Call Auth Service only when you need identity data (username) not present in the token.

---

## Verifying tokens in other microservices

Copy [`src/middleware/verify.middleware.ts`](src/middleware/verify.middleware.ts). Other services need only:

1. The **public PEM key** (`keys/public.pem`)
2. **Redis URL** (for jti blacklist checks)

```typescript
import { createVerifyJwtMiddleware } from "./middleware/verify.middleware.js";
import { readFileSync } from "node:fs";

const verifyJwt = createVerifyJwtMiddleware({
  public_key: readFileSync("./keys/public.pem"),
  redis_url: process.env.REDIS_URL,
  blacklist_fail_mode: "closed",
});

fastify.get("/protected", { preHandler: verifyJwt }, async (request) => {
  return { user_id: request.user!.user_id, role: request.user!.role };
});
```

### Blacklist fail modes

| Mode | Behavior when Redis is unavailable |
|------|-------------------------------------|
| `closed` (default) | Reject requests — more secure |
| `open` | Allow requests — higher availability |

---

## API documentation (Swagger)

| URL | Description |
|-----|-------------|
| http://localhost:3001/docs | Interactive Swagger UI |
| http://localhost:3001/docs/json | Raw OpenAPI JSON |

Export spec to file:

```bash
npm run docs:generate
# → docs/openapi.json
```

**Try protected endpoints:** run Register or Login, copy `access_token`, click **Authorize** in Swagger, paste the token.

---

## Security features

- **argon2id** password hashing
- **RS256** asymmetric JWTs with explicit algorithm whitelist
- Refresh tokens stored as **SHA-256 hashes** (never plaintext)
- **Refresh token rotation** on every refresh
- **Rate limiting** on `/auth/login` and `/auth/register` (5 / 15 min / IP)
- **Helmet** security headers
- **CORS** restricted to configured origins
- Generic login errors — no user enumeration
- Email never returned in API responses
- Parameterized queries via Prisma

---

## Testing

Redis must be running (`redis-cli ping` → `PONG`):

```bash
npm test
```

- Uses embedded Postgres on port 5433 (reuses running instance if `dev:local` is active)
- Docker is **not** required
- 15 tests: auth flow, user endpoints, tampered JWTs, verify middleware

---

## Project structure

```
api/
├── docker-compose.yml          # Optional Postgres + Redis
├── scripts/
│   ├── dev-local.mjs           # Embedded Postgres + API
│   ├── generate-keys.sh        # RSA key generation
│   └── generate-openapi.mjs    # Export OpenAPI spec
├── prisma/
│   ├── schema.prisma
│   └── migrations/
├── src/
│   ├── index.ts                # Server entry + buildApp()
│   ├── config/env.ts
│   ├── plugins/                # jwt, redis, prisma, swagger
│   ├── services/               # auth, token, user
│   ├── routes/auth.routes.ts
│   ├── middleware/verify.middleware.ts
│   ├── types/
│   └── utils/
├── test/
│   ├── auth.test.ts
│   └── helpers.ts
└── docs/                       # Generated openapi.json
```

---

## Optional: Docker setup

If you prefer Docker for Postgres and Redis:

```bash
docker compose up -d
```

Update `.env`:

```
DATABASE_URL=postgresql://auth:auth@localhost:5432/auth_db
```

Then:

```bash
npm run prisma:deploy
npm run dev
```

| Service | Port | Credentials |
|---------|------|-------------|
| PostgreSQL 16 | 5432 | `auth` / `auth` / `auth_db` |
| Redis 7 | 6379 | No auth (local dev) |

---

## Troubleshooting

| Problem | Solution |
|---------|----------|
| `Route GET:/docs not found` | Restart server; ensure `DOCS_ENABLED=true` |
| `P3014 permission denied to create database` | Use `npm run prisma:deploy` instead of `prisma:migrate`, or use `dev:local` (port 5433) |
| Postgres connection failed on 5432 | Use `npm run dev:local` (port 5433) or create user with `sudo -u postgres psql` |
| `initdb: directory exists but is not empty` | Run `npm run dev:local:reset` |
| `Address already in use` on 5433 | Another `dev:local` is running — reuse it or stop the old process |
| Redis connection failed | Start Redis: `sudo systemctl start redis` or `docker compose up -d redis` |
| Port 3001 in use | `fuser -k 3001/tcp` then restart |

---

## Production

```bash
npm run build
npm run prisma:deploy
NODE_ENV=production npm start
```

Set `DOCS_ENABLED=false` in production unless you want public API docs.
