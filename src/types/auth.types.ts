/**
 * Shared auth-related TypeScript types for the auth microservice.
 */

/** Token pair returned after register, login, or refresh. */
export interface TokenPairResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/** Decoded JWT payload attached to authenticated requests. */
export interface JwtPayload {
  sub: string;
  role: string;
  jti: string;
  iat: number;
  exp: number;
}

/** User context attached to request after JWT verification. */
export interface AuthenticatedUser {
  user_id: string;
  role: string;
  jti: string;
}

/** Full profile for the authenticated user (GET /auth/me). */
export interface UserProfileResponse {
  id: string;
  username: string;
  role: string;
  created_at: string;
  updated_at: string;
}

/** Public user identity safe to expose to other microservices/clients. */
export interface PublicUserResponse {
  id: string;
  username: string;
  role: string;
  created_at: string;
}

/** Cached refresh token metadata stored in Redis. */
export interface CachedRefreshToken {
  user_id: string;
  expires_at: string;
}

/** Application environment configuration. */
export interface AppConfig {
  node_env: string;
  port: number;
  database_url: string;
  redis_url: string;
  jwt_private_key_path: string;
  jwt_public_key_path: string;
  access_token_ttl_seconds: number;
  refresh_token_ttl_seconds: number;
  cors_origins: string[];
  redis_blacklist_fail_mode: "open" | "closed";
}

/** Custom application errors with HTTP status codes. */
export class AppError extends Error {
  constructor(
    public readonly status_code: number,
    message: string,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/** Type guard for AppError — reliable across ESM module boundaries. */
export function isAppError(error: unknown): error is AppError {
  return (
    error instanceof AppError ||
    (typeof error === "object" &&
      error !== null &&
      (error as AppError).name === "AppError" &&
      typeof (error as AppError).status_code === "number")
  );
}
