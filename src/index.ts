/**
 * Auth microservice entry point — builds Fastify app with plugins, routes, and security.
 */
import "dotenv/config";
import { fileURLToPath } from "node:url";
import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import { registerEnvConfig } from "./config/env.js";
import prismaPlugin from "./plugins/prisma.plugin.js";
import redisPlugin from "./plugins/redis.plugin.js";
import jwtPlugin from "./plugins/jwt.plugin.js";
import swaggerPlugin from "./plugins/swagger.plugin.js";
import { authRoutes } from "./routes/auth.routes.js";
import { registerAppErrorHandler } from "./utils/error-handler.util.js";

/** Builds and configures the Fastify application without listening. */
export async function buildApp() {
  const fastify = Fastify({
    logger: {
      level: process.env.NODE_ENV === "production" ? "info" : "debug",
    },
  });

  await registerEnvConfig(fastify);
  registerAppErrorHandler(fastify);

  const docs_enabled =
    fastify.config.node_env !== "production" || process.env.DOCS_ENABLED === "true";

  await fastify.register(helmet, docs_enabled ? { contentSecurityPolicy: false } : {});
  await fastify.register(cors, {
    origin: fastify.config.cors_origins,
    credentials: true,
  });

  await fastify.register(prismaPlugin);
  await fastify.register(redisPlugin);
  await fastify.register(jwtPlugin);

  if (docs_enabled) {
    await fastify.register(swaggerPlugin);
  }

  await fastify.register(authRoutes);

  return fastify;
}

/** Starts the HTTP server when run directly. */
async function start(): Promise<void> {
  const app = await buildApp();

  try {
    await app.listen({ port: app.config.port, host: "0.0.0.0" });
    app.log.info(`Auth service listening on port ${app.config.port}`);
  } catch (error) {
    app.log.error(error);
    process.exit(1);
  }
}

const is_main = process.argv[1] === fileURLToPath(import.meta.url);
if (is_main) {
  start();
}
