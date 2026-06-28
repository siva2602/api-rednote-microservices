/**
 * Redis plugin — decorates Fastify with an ioredis client for token cache and blacklist.
 */
import fp from "fastify-plugin";
import { Redis } from "ioredis";
import type { FastifyInstance } from "fastify";

async function redisPlugin(fastify: FastifyInstance): Promise<void> {
  const redis = new Redis(fastify.config.redis_url, {
    maxRetriesPerRequest: 3,
    lazyConnect: true,
  });

  await redis.connect();

  fastify.decorate("redis", redis);

  fastify.addHook("onClose", async () => {
    await redis.quit();
  });
}

export default fp(redisPlugin, { name: "redis-plugin" });
