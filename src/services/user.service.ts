/**
 * User service — fetch user identity data owned by the auth microservice.
 */
import type { FastifyInstance } from "fastify";
import { AppError, type PublicUserResponse, type UserProfileResponse } from "../types/auth.types.js";

/** Maps a Prisma user row to the authenticated user's profile (no password_hash). */
function toUserProfile(user: {
  id: string;
  username: string;
  role: string;
  created_at: Date;
  updated_at: Date;
}): UserProfileResponse {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at.toISOString(),
    updated_at: user.updated_at.toISOString(),
  };
}

/** Maps a Prisma user row to a public profile safe for other services/clients. */
function toPublicUser(user: {
  id: string;
  username: string;
  role: string;
  created_at: Date;
}): PublicUserResponse {
  return {
    id: user.id,
    username: user.username,
    role: user.role,
    created_at: user.created_at.toISOString(),
  };
}

export class UserService {
  constructor(private readonly fastify: FastifyInstance) {}

  /** Returns the authenticated user's full identity profile. */
  async getMe(user_id: string): Promise<UserProfileResponse> {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: user_id },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
        updated_at: true,
      },
    });

    if (!user) {
      throw new AppError(404, "User not found");
    }

    return toUserProfile(user);
  }

  /** Returns a public user profile by id — no email or sensitive fields. */
  async getPublicProfile(user_id: string): Promise<PublicUserResponse> {
    const user = await this.fastify.prisma.user.findUnique({
      where: { id: user_id },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new AppError(404, "User not found");
    }

    return toPublicUser(user);
  }

  /** Returns a public profile by username — for lookup from feed/social services. */
  async getPublicProfileByUsername(username: string): Promise<PublicUserResponse> {
    const user = await this.fastify.prisma.user.findUnique({
      where: { username: username.trim() },
      select: {
        id: true,
        username: true,
        role: true,
        created_at: true,
      },
    });

    if (!user) {
      throw new AppError(404, "User not found");
    }

    return toPublicUser(user);
  }
}
