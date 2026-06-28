/**
 * Central Fastify error handler — maps AppError to HTTP status codes.
 */
import type { FastifyError, FastifyInstance } from "fastify";
import { isAppError } from "../types/auth.types.js";

/** Registers the application-wide error handler on a Fastify instance. */
export function registerAppErrorHandler(fastify: FastifyInstance): void {
  fastify.setErrorHandler((error: FastifyError, _request, reply) => {
    if (isAppError(error)) {
      return reply.status(error.status_code).send({ error: error.message });
    }

    if (error.validation) {
      return reply.status(400).send({ error: "Validation failed", details: error.validation });
    }

    fastify.log.error(error);
    const message =
      fastify.config?.node_env === "production"
        ? "Internal server error"
        : error.message;
    return reply.status(error.statusCode ?? 500).send({ error: message });
  });
}
