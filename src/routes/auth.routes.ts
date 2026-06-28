/**
 * Auth routes — register, login, refresh, logout, and verify endpoints.
 */
import type { FastifyInstance } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { AppError } from "../types/auth.types.js";
import { registerAppErrorHandler } from "../utils/error-handler.util.js";
import { AuthService } from "../services/auth.service.js";
import { UserService } from "../services/user.service.js";

const token_response_schema = {
  type: "object",
  properties: {
    access_token: { type: "string" },
    refresh_token: { type: "string" },
    expires_in: { type: "number" },
  },
  required: ["access_token", "refresh_token", "expires_in"],
} as const;

const error_response_schema = {
  type: "object",
  properties: {
    error: { type: "string" },
  },
  required: ["error"],
} as const;

const common_error_responses = {
  400: error_response_schema,
  401: error_response_schema,
  404: error_response_schema,
  429: error_response_schema,
} as const;

const user_profile_schema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    username: { type: "string" },
    role: { type: "string" },
    created_at: { type: "string", format: "date-time" },
    updated_at: { type: "string", format: "date-time" },
  },
  required: ["id", "username", "role", "created_at", "updated_at"],
} as const;

const public_user_schema = {
  type: "object",
  properties: {
    id: { type: "string", format: "uuid" },
    username: { type: "string" },
    role: { type: "string" },
    created_at: { type: "string", format: "date-time" },
  },
  required: ["id", "username", "role", "created_at"],
} as const;

/** Extracts Bearer token from Authorization header. */
function extractBearerToken(authorization?: string): string | null {
  if (!authorization?.startsWith("Bearer ")) {
    return null;
  }
  return authorization.slice(7).trim();
}

export async function authRoutes(fastify: FastifyInstance): Promise<void> {
  registerAppErrorHandler(fastify);
  const auth_service = new AuthService(fastify);
  const user_service = new UserService(fastify);

  await fastify.register(
    async (rate_limited) => {
      await rate_limited.register(rateLimit, {
        max: process.env.NODE_ENV === "test" ? 10_000 : 5,
        timeWindow: "15 minutes",
      });

      rate_limited.post(
        "/register",
        {
          schema: {
            tags: ["Auth"],
            summary: "Register a new user",
            description: "Creates a user account and returns access + refresh tokens.",
            body: {
              type: "object",
              required: ["email", "username", "password"],
              properties: {
                email: { type: "string", format: "email", maxLength: 255 },
                username: {
                  type: "string",
                  minLength: 3,
                  maxLength: 50,
                  pattern: "^[a-zA-Z0-9_]+$",
                },
                password: { type: "string", minLength: 8, maxLength: 128 },
              },
              additionalProperties: false,
            },
            response: {
              201: token_response_schema,
              409: error_response_schema,
              ...common_error_responses,
            },
          },
        },
        async (request, reply) => {
          const { email, username, password } = request.body as {
            email: string;
            username: string;
            password: string;
          };
          const tokens = await auth_service.register(email, username, password);
          return reply.status(201).send(tokens);
        },
      );

      rate_limited.post(
        "/login",
        {
          schema: {
            tags: ["Auth"],
            summary: "Login with email or username",
            description: "Authenticates user and returns access + refresh tokens.",
            body: {
              type: "object",
              required: ["identifier", "password"],
              properties: {
                identifier: { type: "string", minLength: 1, maxLength: 255 },
                password: { type: "string", minLength: 1, maxLength: 128 },
              },
              additionalProperties: false,
            },
            response: {
              200: token_response_schema,
              ...common_error_responses,
            },
          },
        },
        async (request) => {
          const { identifier, password } = request.body as {
            identifier: string;
            password: string;
          };
          return auth_service.login(identifier, password);
        },
      );
    },
    { prefix: "/auth" },
  );

  fastify.post(
    "/auth/refresh",
    {
      schema: {
        tags: ["Auth"],
        summary: "Refresh access token",
        description: "Rotates refresh token and returns a new token pair.",
        body: {
          type: "object",
          required: ["refresh_token"],
          properties: {
            refresh_token: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          200: token_response_schema,
          ...common_error_responses,
        },
      },
    },
    async (request) => {
      const { refresh_token } = request.body as { refresh_token: string };
      return auth_service.refresh(refresh_token);
    },
  );

  fastify.post(
    "/auth/logout",
    {
      schema: {
        tags: ["Auth"],
        summary: "Logout and revoke tokens",
        description: "Blacklists access token jti and revokes refresh token.",
        security: [{ BearerAuth: [] }],
        body: {
          type: "object",
          required: ["refresh_token"],
          properties: {
            refresh_token: { type: "string", minLength: 1 },
          },
          additionalProperties: false,
        },
        response: {
          204: { type: "null", description: "Logged out successfully" },
          ...common_error_responses,
        },
      },
    },
    async (request, reply) => {
      const access_token = extractBearerToken(request.headers.authorization);
      if (!access_token) {
        throw new AppError(401, "Missing or invalid Authorization header");
      }
      const { refresh_token } = request.body as { refresh_token: string };
      await auth_service.logout(access_token, refresh_token);
      return reply.status(204).send();
    },
  );

  fastify.get(
    "/auth/verify",
    {
      schema: {
        tags: ["Auth"],
        summary: "Verify access token",
        description: "Returns decoded JWT claims for the Bearer access token.",
        security: [{ BearerAuth: [] }],
        response: {
          200: {
            type: "object",
            properties: {
              user_id: { type: "string" },
              role: { type: "string" },
              jti: { type: "string" },
            },
            required: ["user_id", "role", "jti"],
          },
          ...common_error_responses,
        },
      },
    },
    async (request) => {
      const access_token = extractBearerToken(request.headers.authorization);
      if (!access_token) {
        throw new AppError(401, "Missing or invalid Authorization header");
      }
      return auth_service.verifyAccessToken(access_token);
    },
  );

  fastify.get(
    "/auth/me",
    {
      schema: {
        tags: ["Auth"],
        summary: "Get current user profile",
        description:
          "Returns identity profile for the authenticated user. Email is never included.",
        security: [{ BearerAuth: [] }],
        response: {
          200: user_profile_schema,
          ...common_error_responses,
        },
      },
    },
    async (request) => {
      const access_token = extractBearerToken(request.headers.authorization);
      if (!access_token) {
        throw new AppError(401, "Missing or invalid Authorization header");
      }
      const { user_id } = await auth_service.verifyAccessToken(access_token);
      return user_service.getMe(user_id);
    },
  );

  fastify.get(
    "/auth/users/:user_id",
    {
      schema: {
        tags: ["Auth"],
        summary: "Get public user profile by ID",
        description:
          "Returns public identity for any user. Used by other microservices. Requires valid JWT.",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["user_id"],
          properties: {
            user_id: { type: "string", format: "uuid" },
          },
        },
        response: {
          200: public_user_schema,
          ...common_error_responses,
        },
      },
    },
    async (request) => {
      const access_token = extractBearerToken(request.headers.authorization);
      if (!access_token) {
        throw new AppError(401, "Missing or invalid Authorization header");
      }
      await auth_service.verifyAccessToken(access_token);
      const { user_id } = request.params as { user_id: string };
      return user_service.getPublicProfile(user_id);
    },
  );

  fastify.get(
    "/auth/users/by-username/:username",
    {
      schema: {
        tags: ["Auth"],
        summary: "Get public user profile by username",
        description: "Lookup public identity by username for social/feed services.",
        security: [{ BearerAuth: [] }],
        params: {
          type: "object",
          required: ["username"],
          properties: {
            username: { type: "string", minLength: 3, maxLength: 50 },
          },
        },
        response: {
          200: public_user_schema,
          ...common_error_responses,
        },
      },
    },
    async (request) => {
      const access_token = extractBearerToken(request.headers.authorization);
      if (!access_token) {
        throw new AppError(401, "Missing or invalid Authorization header");
      }
      await auth_service.verifyAccessToken(access_token);
      const { username } = request.params as { username: string };
      return user_service.getPublicProfileByUsername(username);
    },
  );
}
