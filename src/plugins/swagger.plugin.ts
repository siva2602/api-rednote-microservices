/**
 * Swagger plugin — serves OpenAPI spec and interactive UI at /docs.
 */
import fp from "fastify-plugin";
import swagger from "@fastify/swagger";
import swaggerUi from "@fastify/swagger-ui";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { FastifyInstance } from "fastify";

const __dirname = dirname(fileURLToPath(import.meta.url));
const package_json = JSON.parse(
  readFileSync(join(__dirname, "../../package.json"), "utf8"),
) as { version: string };

async function swaggerPlugin(fastify: FastifyInstance): Promise<void> {
  const port = fastify.config?.port ?? Number(process.env.PORT ?? 3001);

  await fastify.register(swagger, {
    openapi: {
      openapi: "3.0.3",
      info: {
        title: "Rednote Auth Service",
        description: "JWT-based authentication API for the Rednote social media platform.",
        version: package_json.version,
      },
      servers: [{ url: `http://localhost:${port}`, description: "Local development" }],
      tags: [{ name: "Auth", description: "Authentication endpoints" }],
      components: {
        securitySchemes: {
          BearerAuth: {
            type: "http",
            scheme: "bearer",
            bearerFormat: "JWT",
            description: "RS256 access token from register or login",
          },
        },
      },
    },
  });

  await fastify.register(swaggerUi, {
    routePrefix: "/docs",
    uiConfig: {
      docExpansion: "list",
      deepLinking: true,
    },
  });
}

export default fp(swaggerPlugin, { name: "swagger-plugin" });
