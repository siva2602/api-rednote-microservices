/**
 * Exportable JWT verification middleware for other Fastify microservices.
 * Copy this file into any service — only requires public key + optional Redis for blacklist.
 */
import { Redis } from "ioredis";
import jwt from "jsonwebtoken";
import type { FastifyReply, FastifyRequest } from "fastify";

const BLACKLIST_KEY_PREFIX = "blacklist:jti:";

/** Configuration for the reusable verify middleware factory. */
export interface VerifyJwtOptions {
  public_key: string | Buffer;
  redis_url?: string;
  blacklist_fail_mode: "open" | "closed";
}

/** Decoded JWT payload shape attached to request.user. */
export interface VerifiedJwtUser {
  user_id: string;
  role: string;
  jti: string;
}

/** Internal JWT payload from verified token. */
interface JwtClaims {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

/** Extracts Bearer token from Authorization header. */
function extractBearerToken(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice(7).trim();
}

/** Creates a Fastify preHandler that verifies RS256 JWTs and checks Redis blacklist. */
export function createVerifyJwtMiddleware(options: VerifyJwtOptions) {
  let redis: Redis | null = null;

  if (options.redis_url) {
    redis = new Redis(options.redis_url, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  return async function verifyJwt(
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<void> {
    const token = extractBearerToken(request.headers.authorization);
    if (!token) {
      return reply.status(401).send({ error: "Missing or invalid Authorization header" });
    }

    let payload: JwtClaims;
    try {
      payload = jwt.verify(token, options.public_key, {
        algorithms: ["RS256"],
      }) as JwtClaims;
    } catch {
      return reply.status(401).send({ error: "Invalid or expired token" });
    }

    if (redis) {
      const key = `${BLACKLIST_KEY_PREFIX}${payload.jti}`;
      try {
        if (!redis.status || redis.status === "wait") {
          await redis.connect();
        }
        const blacklisted = await redis.exists(key);
        if (blacklisted === 1) {
          return reply.status(401).send({ error: "Token has been revoked" });
        }
      } catch {
        if (options.blacklist_fail_mode === "closed") {
          return reply.status(503).send({ error: "Token verification unavailable" });
        }
      }
    }

    (request as unknown as { user?: VerifiedJwtUser }).user = {
      user_id: payload.sub,
      role: payload.role,
      jti: payload.jti,
    };
  };
}

/** Standalone verify function for non-Fastify contexts. */
export async function verifyJwtToken(
  token: string,
  options: VerifyJwtOptions,
): Promise<VerifiedJwtUser> {
  let payload: JwtClaims;
  try {
    payload = jwt.verify(token, options.public_key, {
      algorithms: ["RS256"],
    }) as JwtClaims;
  } catch {
    throw new Error("Invalid or expired token");
  }

  if (options.redis_url) {
    const redis = new Redis(options.redis_url, { maxRetriesPerRequest: 1 });
    try {
      await redis.connect();
      const key = `${BLACKLIST_KEY_PREFIX}${payload.jti}`;
      const blacklisted = await redis.exists(key);
      if (blacklisted === 1) {
        throw new Error("Token has been revoked");
      }
    } catch (error) {
      if (
        options.blacklist_fail_mode === "closed" &&
        error instanceof Error &&
        error.message !== "Token has been revoked"
      ) {
        throw new Error("Token verification unavailable");
      }
      if (error instanceof Error && error.message === "Token has been revoked") {
        throw error;
      }
    } finally {
      await redis.quit();
    }
  }

  return {
    user_id: payload.sub,
    role: payload.role,
    jti: payload.jti,
  };
}
