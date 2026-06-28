/**
 * Environment configuration — validates and loads env vars at startup via @fastify/env.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyEnv from "@fastify/env";
import type { AppConfig } from "../types/auth.types.js";

/** JSON schema for @fastify/env validation. */
const env_schema = {
  type: "object",
  required: [
    "DATABASE_URL",
    "REDIS_URL",
    "JWT_PRIVATE_KEY_PATH",
    "JWT_PUBLIC_KEY_PATH",
  ],
  properties: {
    NODE_ENV: { type: "string", default: "development" },
    PORT: { type: "number", default: 3001 },
    DATABASE_URL: { type: "string" },
    REDIS_URL: { type: "string" },
    JWT_PRIVATE_KEY_PATH: { type: "string" },
    JWT_PUBLIC_KEY_PATH: { type: "string" },
    ACCESS_TOKEN_TTL_SECONDS: { type: "number", default: 900 },
    REFRESH_TOKEN_TTL_SECONDS: { type: "number", default: 604800 },
    CORS_ORIGINS: { type: "string", default: "http://localhost:3000" },
    REDIS_BLACKLIST_FAIL_MODE: {
      type: "string",
      default: "closed",
      enum: ["open", "closed"],
    },
  },
} as const;

/** Raw env shape returned by @fastify/env. */
interface RawEnv {
  NODE_ENV: string;
  PORT: number;
  DATABASE_URL: string;
  REDIS_URL: string;
  JWT_PRIVATE_KEY_PATH: string;
  JWT_PUBLIC_KEY_PATH: string;
  ACCESS_TOKEN_TTL_SECONDS: number;
  REFRESH_TOKEN_TTL_SECONDS: number;
  CORS_ORIGINS: string;
  REDIS_BLACKLIST_FAIL_MODE: "open" | "closed";
}

/** Loads RSA PEM key from disk; fails fast if missing. */
export function loadPemKey(key_path: string): Buffer {
  const absolute_path = resolve(key_path);
  try {
    return readFileSync(absolute_path);
  } catch {
    throw new Error(`Failed to read key file at ${absolute_path}`);
  }
}

/** Builds typed AppConfig from raw env values. */
export function buildAppConfig(raw: RawEnv): AppConfig {
  return {
    node_env: raw.NODE_ENV,
    port: raw.PORT,
    database_url: raw.DATABASE_URL,
    redis_url: raw.REDIS_URL,
    jwt_private_key_path: raw.JWT_PRIVATE_KEY_PATH,
    jwt_public_key_path: raw.JWT_PUBLIC_KEY_PATH,
    access_token_ttl_seconds: raw.ACCESS_TOKEN_TTL_SECONDS,
    refresh_token_ttl_seconds: raw.REFRESH_TOKEN_TTL_SECONDS,
    cors_origins: raw.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean),
    redis_blacklist_fail_mode: raw.REDIS_BLACKLIST_FAIL_MODE,
  };
}

/** Registers @fastify/env and decorates fastify.config with typed AppConfig. */
export async function registerEnvConfig(fastify: FastifyInstance): Promise<void> {
  await fastify.register(fastifyEnv, {
    schema: env_schema,
    dotenv: true,
    confKey: "env",
  });

  const raw = (fastify as FastifyInstance & { env: RawEnv }).env;
  fastify.decorate("config", buildAppConfig(raw));
}
