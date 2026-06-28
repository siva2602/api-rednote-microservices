/**
 * Auth service — register, login, refresh, and logout business logic.
 */
import * as argon2 from "argon2";
import type { FastifyInstance } from "fastify";
import { AppError, type TokenPairResponse } from "../types/auth.types.js";
import { ttlFromJwtExp } from "../utils/crypto.util.js";
import { TokenService } from "./token.service.js";

const ARGON2_OPTIONS: argon2.Options = {
  type: argon2.argon2id,
  memoryCost: 65536,
  timeCost: 3,
  parallelism: 4,
};

export class AuthService {
  private readonly token_service: TokenService;

  constructor(private readonly fastify: FastifyInstance) {
    this.token_service = new TokenService(fastify);
  }

  /** Registers a new user and returns access + refresh tokens. */
  async register(
    email: string,
    username: string,
    password: string,
  ): Promise<TokenPairResponse> {
    const normalized_email = email.toLowerCase().trim();
    const normalized_username = username.trim();

    const existing = await this.fastify.prisma.user.findFirst({
      where: {
        OR: [{ email: normalized_email }, { username: normalized_username }],
      },
    });

    if (existing) {
      if (existing.email === normalized_email) {
        throw new AppError(409, "Email already registered");
      }
      throw new AppError(409, "Username already taken");
    }

    const password_hash = await argon2.hash(password, ARGON2_OPTIONS);

    const user = await this.fastify.prisma.user.create({
      data: {
        email: normalized_email,
        username: normalized_username,
        password_hash,
      },
    });

    return this.issueTokenPair(user.id, user.role);
  }

  /** Authenticates user by email or username; returns generic error on failure. */
  async login(identifier: string, password: string): Promise<TokenPairResponse> {
    const trimmed = identifier.trim();
    const is_email = trimmed.includes("@");

    const user = await this.fastify.prisma.user.findFirst({
      where: is_email
        ? { email: trimmed.toLowerCase() }
        : { username: trimmed },
    });

    if (!user) {
      throw new AppError(401, "Invalid credentials");
    }

    const valid = await argon2.verify(user.password_hash, password);
    if (!valid) {
      throw new AppError(401, "Invalid credentials");
    }

    return this.issueTokenPair(user.id, user.role);
  }

  /** Validates refresh token, rotates it, and returns a new token pair. */
  async refresh(refresh_token: string): Promise<TokenPairResponse> {
    const token_hash = this.token_service.hashToken(refresh_token);

    let user_id: string | null = null;

    const cached = await this.token_service.getCachedRefreshToken(token_hash);
    if (cached) {
      const expires_at = new Date(cached.expires_at);
      if (expires_at <= new Date()) {
        throw new AppError(401, "Invalid or expired refresh token");
      }
      user_id = cached.user_id;
    } else {
      const stored = await this.fastify.prisma.refreshToken.findFirst({
        where: {
          token_hash,
          revoked: false,
          expires_at: { gt: new Date() },
        },
        include: { user: true },
      });

      if (!stored) {
        throw new AppError(401, "Invalid or expired refresh token");
      }

      user_id = stored.user_id;

      await this.token_service.cacheRefreshToken(
        token_hash,
        stored.user_id,
        stored.expires_at,
      );
    }

    const user = await this.fastify.prisma.user.findUnique({
      where: { id: user_id },
    });

    if (!user) {
      throw new AppError(401, "Invalid or expired refresh token");
    }

    await this.revokeRefreshToken(token_hash);

    return this.issueTokenPair(user.id, user.role);
  }

  /** Revokes refresh token and blacklists the current access token jti. */
  async logout(access_token: string, refresh_token: string): Promise<void> {
    let payload: { jti: string; exp: number };
    try {
      payload = this.fastify.jwt.verify<{ jti: string; exp: number }>(access_token, {
        algorithms: ["RS256"],
      });
    } catch {
      throw new AppError(401, "Invalid access token");
    }

    const ttl_seconds = ttlFromJwtExp(payload.exp);
    await this.token_service.blacklistAccessToken(payload.jti, ttl_seconds);

    const token_hash = this.token_service.hashToken(refresh_token);
    await this.revokeRefreshToken(token_hash);
  }

  /** Verifies access token and checks jti blacklist. */
  async verifyAccessToken(access_token: string): Promise<{
    user_id: string;
    role: string;
    jti: string;
  }> {
    let payload: { sub: string; role: string; jti: string };
    try {
      payload = this.fastify.jwt.verify<{ sub: string; role: string; jti: string }>(
        access_token,
        { algorithms: ["RS256"] },
      );
    } catch {
      throw new AppError(401, "Invalid or expired token");
    }

    const blacklisted = await this.token_service.isAccessTokenBlacklisted(payload.jti);
    if (blacklisted) {
      throw new AppError(401, "Token has been revoked");
    }

    return {
      user_id: payload.sub,
      role: payload.role,
      jti: payload.jti,
    };
  }

  /** Issues access + refresh tokens and persists hashed refresh token. */
  private async issueTokenPair(user_id: string, role: string): Promise<TokenPairResponse> {
    const access_token = await this.token_service.signAccessToken(user_id, role);
    const refresh_token = this.token_service.createRefreshToken();
    const token_hash = this.token_service.hashToken(refresh_token);
    const expires_at = this.token_service.getRefreshTokenExpiry();

    await this.fastify.prisma.refreshToken.create({
      data: {
        user_id,
        token_hash,
        expires_at,
      },
    });

    await this.token_service.cacheRefreshToken(token_hash, user_id, expires_at);

    return {
      access_token,
      refresh_token,
      expires_in: this.token_service.getAccessTokenTtl(),
    };
  }

  /** Marks refresh token revoked in Postgres and removes from Redis. */
  private async revokeRefreshToken(token_hash: string): Promise<void> {
    await this.fastify.prisma.refreshToken.updateMany({
      where: { token_hash, revoked: false },
      data: { revoked: true },
    });
    await this.token_service.invalidateRefreshToken(token_hash);
  }
}
