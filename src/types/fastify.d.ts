/**
 * Fastify type augmentation — adds prisma, redis, config, and user to request/server.
 */
import type { PrismaClient } from "@prisma/client";
import type { Redis } from "ioredis";
import type { AppConfig, AuthenticatedUser } from "./auth.types.js";

declare module "fastify" {
  interface FastifyInstance {
    config: AppConfig;
    prisma: PrismaClient;
    redis: Redis;
    signAccessToken: (user_id: string, role: string) => Promise<string>;
  }

  interface FastifyRequest {
    user?: AuthenticatedUser;
  }
}

declare module "@fastify/jwt" {
  interface FastifyJWT {
    payload: {
      sub: string;
      role: string;
      jti: string;
    };
    user: {
      sub: string;
      role: string;
      jti: string;
    };
  }
}

export {};
