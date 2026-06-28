/**
 * Test helpers — embedded Postgres, env setup, and RSA key fixtures for inject tests.
 */
import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, unlinkSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import EmbeddedPostgres from "embedded-postgres";
import { Redis } from "ioredis";
import { PrismaClient } from "@prisma/client";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const FIXTURES_DIR = join(__dirname, "fixtures");
export const KEYS_DIR = join(FIXTURES_DIR, "keys");
const EMBEDDED_PG_DIR = join(FIXTURES_DIR, "pg-data");
const EMBEDDED_PG_PORT = 5433;

let embedded_pg: EmbeddedPostgres | null = null;

/** Ensures test RSA key pair exists under test/fixtures/keys. */
export function ensureTestKeys(): void {
  mkdirSync(KEYS_DIR, { recursive: true });
  const private_path = join(KEYS_DIR, "private.pem");
  const public_path = join(KEYS_DIR, "public.pem");

  if (!existsSync(private_path) || !existsSync(public_path)) {
    execSync(`openssl genrsa -out "${private_path}" 2048`, { stdio: "pipe" });
    execSync(`openssl rsa -in "${private_path}" -pubout -out "${public_path}"`, {
      stdio: "pipe",
    });
  }
}

/** Removes stale postmaster.pid if the owning process is no longer running. */
function clearStaleLock(): void {
  const lock_file = join(EMBEDDED_PG_DIR, "postmaster.pid");
  if (!existsSync(lock_file)) {
    return;
  }
  const pid_line = readFileSync(lock_file, "utf8").split("\n")[0]?.trim();
  const pid = Number(pid_line);
  if (!pid) {
    return;
  }
  try {
    process.kill(pid, 0);
  } catch {
    unlinkSync(lock_file);
  }
}

/** Returns true if embedded Postgres is already accepting connections. */
function isPostgresRunning(): boolean {
  try {
    execSync(
      `PGPASSWORD=auth psql -h 127.0.0.1 -p ${EMBEDDED_PG_PORT} -U auth -d postgres -c "SELECT 1"`,
      { stdio: "pipe" },
    );
    return true;
  } catch {
    return false;
  }
}

/** Starts embedded Postgres and applies Prisma migrations for isolated tests. */
export async function startEmbeddedPostgres(): Promise<string> {
  const database_url = `postgresql://auth:auth@localhost:${EMBEDDED_PG_PORT}/auth_db`;

  if (isPostgresRunning()) {
    process.env.DATABASE_URL = database_url;
    execSync("npx prisma migrate deploy", {
      cwd: join(__dirname, ".."),
      env: { ...process.env, DATABASE_URL: database_url },
      stdio: "pipe",
    });
    return database_url;
  }

  if (embedded_pg) {
    return process.env.DATABASE_URL!;
  }

  mkdirSync(EMBEDDED_PG_DIR, { recursive: true });

  embedded_pg = new EmbeddedPostgres({
    databaseDir: EMBEDDED_PG_DIR,
    user: "auth",
    password: "auth",
    port: EMBEDDED_PG_PORT,
    persistent: true,
  });

  const cluster_initialized = existsSync(join(EMBEDDED_PG_DIR, "PG_VERSION"));

  if (!cluster_initialized) {
    await embedded_pg.initialise();
  } else {
    clearStaleLock();
  }

  await embedded_pg.start();
  await embedded_pg.createDatabase("auth_db").catch(() => {});

  process.env.DATABASE_URL = database_url;

  execSync("npx prisma migrate deploy", {
    cwd: join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: database_url },
    stdio: "pipe",
  });

  return database_url;
}

/** Stops embedded Postgres after tests complete (only if we started it). */
export async function stopEmbeddedPostgres(): Promise<void> {
  if (embedded_pg) {
    await embedded_pg.stop();
    embedded_pg = null;
  }
}

/** Applies test environment variables before building the app. */
export async function applyTestEnv(): Promise<void> {
  ensureTestKeys();
  await startEmbeddedPostgres();

  process.env.NODE_ENV = "test";
  process.env.PORT = "3099";
  process.env.REDIS_URL = process.env.TEST_REDIS_URL ?? "redis://localhost:6379";
  process.env.JWT_PRIVATE_KEY_PATH = join(KEYS_DIR, "private.pem");
  process.env.JWT_PUBLIC_KEY_PATH = join(KEYS_DIR, "public.pem");
  process.env.ACCESS_TOKEN_TTL_SECONDS = "900";
  process.env.REFRESH_TOKEN_TTL_SECONDS = "604800";
  process.env.CORS_ORIGINS = "http://localhost:3000";
  process.env.REDIS_BLACKLIST_FAIL_MODE = "closed";
}

/** Returns a Prisma client for direct DB assertions in tests. */
export function createTestPrisma(): PrismaClient {
  return new PrismaClient({
    datasourceUrl: process.env.DATABASE_URL,
  });
}

/** Flushes Redis and clears auth-related tables between tests. */
export async function resetTestData(): Promise<void> {
  const prisma = createTestPrisma();
  const redis = new Redis(process.env.REDIS_URL!);

  try {
    if (redis.status === "wait" || redis.status === "end") {
      await redis.connect();
    }
    await redis.flushdb();
    await prisma.refreshToken.deleteMany();
    await prisma.user.deleteMany();
  } finally {
    await redis.quit();
    await prisma.$disconnect();
  }
}

/** Reads test public key PEM for middleware tests. */
export function readTestPublicKey(): Buffer {
  return readFileSync(join(KEYS_DIR, "public.pem"));
}

/** Tampered JWT — modifies payload so signature no longer matches. */
export function tamperJwt(token: string): string {
  const parts = token.split(".");
  if (parts.length !== 3) {
    return token;
  }
  const payload = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  payload.role = "admin";
  parts[1] = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return parts.join(".");
}
