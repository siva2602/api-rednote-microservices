/**
 * JWT plugin — RS256 signing/verification with explicit algorithm whitelist.
 */
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { loadPemKey } from "../config/env.js";

async function jwtPlugin(fastify: FastifyInstance): Promise<void> {
  const private_key = loadPemKey(fastify.config.jwt_private_key_path);
  const public_key = loadPemKey(fastify.config.jwt_public_key_path);

  await fastify.register(fastifyJwt, {
    secret: {
      private: private_key,
      public: public_key,
    },
    sign: {
      algorithm: "RS256",
      expiresIn: fastify.config.access_token_ttl_seconds,
    },
    verify: {
      algorithms: ["RS256"],
    },
  });

  fastify.decorate(
    "signAccessToken",
    async (user_id: string, role: string): Promise<string> => {
      const jti = randomUUID();
      return fastify.jwt.sign({ sub: user_id, role, jti });
    },
  );
}

export default fp(jwtPlugin, { name: "jwt-plugin" });
