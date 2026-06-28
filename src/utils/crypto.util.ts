/**
 * Cryptographic utility functions for token hashing.
 */
import { createHash, randomBytes } from "node:crypto";

/** Generates a cryptographically secure refresh token (base64url). */
export function generateRefreshToken(): string {
  return randomBytes(32).toString("base64url");
}

/** Hashes a refresh token with SHA-256 for safe storage in Postgres/Redis keys. */
export function hashRefreshToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Computes remaining TTL in seconds from an expiry date. */
export function ttlFromExpiry(expires_at: Date): number {
  const remaining_ms = expires_at.getTime() - Date.now();
  return Math.max(1, Math.ceil(remaining_ms / 1000));
}

/** Computes remaining TTL in seconds from a JWT exp claim (unix seconds). */
export function ttlFromJwtExp(exp: number): number {
  const remaining_ms = exp * 1000 - Date.now();
  return Math.max(1, Math.ceil(remaining_ms / 1000));
}
