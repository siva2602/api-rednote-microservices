/**
 * Token service — refresh token lifecycle, Redis cache, and access token blacklist.
 */
import type { FastifyInstance } from "fastify";
import type { CachedRefreshToken } from "../types/auth.types.js";
import {
  generateRefreshToken,
  hashRefreshToken,
  ttlFromExpiry,
} from "../utils/crypto.util.js";

const REFRESH_KEY_PREFIX = "refresh:";
const BLACKLIST_KEY_PREFIX = "blacklist:jti:";

export class TokenService {
  constructor(private readonly fastify: FastifyInstance) {}

  /** Creates a new opaque refresh token string for the client. */
  createRefreshToken(): string {
    return generateRefreshToken();
  }

  /** SHA-256 hash of refresh token for Postgres/Redis storage. */
  hashToken(token: string): string {
    return hashRefreshToken(token);
  }

  /** Signs a new RS256 access token with sub, role, and jti claims. */
  async signAccessToken(user_id: string, role: string): Promise<string> {
    return this.fastify.signAccessToken(user_id, role);
  }

  /** Returns access token TTL in seconds from config. */
  getAccessTokenTtl(): number {
    return this.fastify.config.access_token_ttl_seconds;
  }

  /** Returns refresh token TTL in seconds from config. */
  getRefreshTokenTtl(): number {
    return this.fastify.config.refresh_token_ttl_seconds;
  }

  /** Computes refresh token expiry date from configured TTL. */
  getRefreshTokenExpiry(): Date {
    return new Date(Date.now() + this.getRefreshTokenTtl() * 1000);
  }

  /** Caches refresh token metadata in Redis for fast lookup. */
  async cacheRefreshToken(
    token_hash: string,
    user_id: string,
    expires_at: Date,
  ): Promise<void> {
    const key = `${REFRESH_KEY_PREFIX}${token_hash}`;
    const payload: CachedRefreshToken = {
      user_id,
      expires_at: expires_at.toISOString(),
    };
    const ttl_seconds = ttlFromExpiry(expires_at);
    await this.fastify.redis.set(key, JSON.stringify(payload), "EX", ttl_seconds);
  }

  /** Retrieves cached refresh token metadata from Redis. */
  async getCachedRefreshToken(token_hash: string): Promise<CachedRefreshToken | null> {
    const key = `${REFRESH_KEY_PREFIX}${token_hash}`;
    const raw = await this.fastify.redis.get(key);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as CachedRefreshToken;
  }

  /** Removes refresh token from Redis cache. */
  async invalidateRefreshToken(token_hash: string): Promise<void> {
    const key = `${REFRESH_KEY_PREFIX}${token_hash}`;
    await this.fastify.redis.del(key);
  }

  /** Adds access token jti to Redis blacklist with TTL = remaining token life. */
  async blacklistAccessToken(jti: string, ttl_seconds: number): Promise<void> {
    const key = `${BLACKLIST_KEY_PREFIX}${jti}`;
    await this.fastify.redis.set(key, "1", "EX", ttl_seconds);
  }

  /** Checks if access token jti is blacklisted; respects fail-open/closed config. */
  async isAccessTokenBlacklisted(jti: string): Promise<boolean> {
    const key = `${BLACKLIST_KEY_PREFIX}${jti}`;
    try {
      const result = await this.fastify.redis.exists(key);
      return result === 1;
    } catch {
      if (this.fastify.config.redis_blacklist_fail_mode === "open") {
        return false;
      }
      throw new Error("Redis blacklist check failed");
    }
  }
}
