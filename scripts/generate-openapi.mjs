/**
 * Exports OpenAPI spec to docs/openapi.json without starting the HTTP server.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root_dir = join(dirname(fileURLToPath(import.meta.url)), "..");

process.env.NODE_ENV = "test";
process.env.DOCS_ENABLED = "true";
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? "postgresql://auth:auth@localhost:5433/auth_db";
process.env.REDIS_URL = process.env.REDIS_URL ?? "redis://localhost:6379";
process.env.JWT_PRIVATE_KEY_PATH =
  process.env.JWT_PRIVATE_KEY_PATH ?? join(root_dir, "keys/private.pem");
process.env.JWT_PUBLIC_KEY_PATH =
  process.env.JWT_PUBLIC_KEY_PATH ?? join(root_dir, "keys/public.pem");

const { buildApp } = await import("../src/index.ts");
const app = await buildApp();

try {
  await app.ready();
  const spec = app.swagger();
  const output_dir = join(root_dir, "docs");
  mkdirSync(output_dir, { recursive: true });
  writeFileSync(join(output_dir, "openapi.json"), JSON.stringify(spec, null, 2));
  console.log("OpenAPI spec written to docs/openapi.json");
} finally {
  await app.close();
}
