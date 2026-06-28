/**
 * Auth endpoint integration tests using Fastify inject.
 */
import { describe, it, before, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { applyTestEnv, resetTestData, stopEmbeddedPostgres, tamperJwt, readTestPublicKey } from "./helpers.js";
import { createVerifyJwtMiddleware } from "../src/middleware/verify.middleware.js";

await applyTestEnv();

const { buildApp } = await import("../src/index.js");

describe("Auth API", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  before(async () => {
    app = await buildApp();
    await app.ready();
  });

  after(async () => {
    await app.close();
    await stopEmbeddedPostgres();
  });

  beforeEach(async () => {
    await resetTestData();
  });

  it("registers a new user and returns tokens", async () => {
    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "alice@example.com",
        username: "alice",
        password: "password123",
      },
    });

    assert.equal(response.statusCode, 201);
    const body = response.json();
    assert.ok(body.access_token);
    assert.ok(body.refresh_token);
    assert.equal(body.expires_in, 900);
  });

  it("rejects duplicate email on register", async () => {
    const payload = {
      email: "dup@example.com",
      username: "user_one",
      password: "password123",
    };

    await app.inject({ method: "POST", url: "/auth/register", payload });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: { ...payload, username: "user_two" },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "Email already registered");
  });

  it("rejects duplicate username on register", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "first@example.com",
        username: "sameuser",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "second@example.com",
        username: "sameuser",
        password: "password123",
      },
    });

    assert.equal(response.statusCode, 409);
    assert.equal(response.json().error, "Username already taken");
  });

  it("logs in with email and returns tokens", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "login@example.com",
        username: "loginuser",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: "login@example.com", password: "password123" },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.access_token);
    assert.ok(body.refresh_token);
  });

  it("logs in with username and returns tokens", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "user2@example.com",
        username: "bob",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: "bob", password: "password123" },
    });

    assert.equal(response.statusCode, 200);
    assert.ok(response.json().access_token);
  });

  it("returns generic error on wrong password", async () => {
    await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "wrong@example.com",
        username: "wrongpw",
        password: "password123",
      },
    });

    const response = await app.inject({
      method: "POST",
      url: "/auth/login",
      payload: { identifier: "wrong@example.com", password: "wrongpassword" },
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().error, "Invalid credentials");
  });

  it("refreshes tokens and rejects reused refresh token", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "refresh@example.com",
        username: "refreshuser",
        password: "password123",
      },
    });

    const { refresh_token } = register.json();

    const refresh_response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });

    assert.equal(refresh_response.statusCode, 200);
    const new_tokens = refresh_response.json();
    assert.ok(new_tokens.access_token);
    assert.ok(new_tokens.refresh_token);

    const reuse = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });

    assert.equal(reuse.statusCode, 401);
  });

  it("logout revokes refresh token and blacklists access token jti", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "logout@example.com",
        username: "logoutuser",
        password: "password123",
      },
    });

    const { access_token, refresh_token } = register.json();

    const logout = await app.inject({
      method: "POST",
      url: "/auth/logout",
      headers: { authorization: `Bearer ${access_token}` },
      payload: { refresh_token },
    });

    assert.equal(logout.statusCode, 204);

    const verify = await app.inject({
      method: "GET",
      url: "/auth/verify",
      headers: { authorization: `Bearer ${access_token}` },
    });

    assert.equal(verify.statusCode, 401);

    const refresh_after = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });

    assert.equal(refresh_after.statusCode, 401);
  });

  it("rejects tampered JWT on /auth/verify", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "tamper@example.com",
        username: "tamperuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();
    const tampered = tamperJwt(access_token);

    const response = await app.inject({
      method: "GET",
      url: "/auth/verify",
      headers: { authorization: `Bearer ${tampered}` },
    });

    assert.equal(response.statusCode, 401);
  });

  it("rejects expired refresh token", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "expired@example.com",
        username: "expireduser",
        password: "password123",
      },
    });

    const { refresh_token } = register.json();

    const { hashRefreshToken } = await import("../src/utils/crypto.util.js");
    const token_hash = hashRefreshToken(refresh_token);

    await app.prisma.refreshToken.updateMany({
      where: { token_hash },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    await app.redis.del(`refresh:${token_hash}`);

    const response = await app.inject({
      method: "POST",
      url: "/auth/refresh",
      payload: { refresh_token },
    });

    assert.equal(response.statusCode, 401);
  });

  it("verify middleware rejects tampered JWT", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "middleware@example.com",
        username: "middlewareuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();
    const tampered = tamperJwt(access_token);

    const middleware = createVerifyJwtMiddleware({
      public_key: readTestPublicKey(),
      redis_url: process.env.REDIS_URL,
      blacklist_fail_mode: "closed",
    });

    const mock_request = {
      headers: { authorization: `Bearer ${tampered}` },
    } as Parameters<typeof middleware>[0];

    const mock_reply = {
      status_code: 200,
      status(code: number) {
        this.status_code = code;
        return this;
      },
      send(body: unknown) {
        this.body = body;
        return this;
      },
      body: undefined as unknown,
    };

    await middleware(mock_request, mock_reply as unknown as Parameters<typeof middleware>[1]);
    assert.equal(mock_reply.status_code, 401);
  });

  it("verify endpoint returns decoded claims for valid token", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "verify@example.com",
        username: "verifyuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();

    const response = await app.inject({
      method: "GET",
      url: "/auth/verify",
      headers: { authorization: `Bearer ${access_token}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.ok(body.user_id);
    assert.equal(body.role, "user");
    assert.ok(body.jti);

    const decoded = jwt.decode(access_token) as { sub: string; role: string; jti: string };
    assert.equal(body.user_id, decoded.sub);
    assert.equal(body.jti, decoded.jti);
  });

  it("GET /auth/me returns current user profile without email", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "me@example.com",
        username: "meuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();

    const response = await app.inject({
      method: "GET",
      url: "/auth/me",
      headers: { authorization: `Bearer ${access_token}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.username, "meuser");
    assert.equal(body.role, "user");
    assert.ok(body.id);
    assert.ok(body.created_at);
    assert.equal(body.email, undefined);
  });

  it("GET /auth/users/:user_id returns public profile", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "public@example.com",
        username: "publicuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();
    const decoded = jwt.decode(register.json().access_token) as { sub: string };

    const response = await app.inject({
      method: "GET",
      url: `/auth/users/${decoded.sub}`,
      headers: { authorization: `Bearer ${access_token}` },
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.id, decoded.sub);
    assert.equal(body.username, "publicuser");
    assert.equal(body.email, undefined);
  });

  it("GET /auth/users/:user_id returns 404 for unknown user", async () => {
    const register = await app.inject({
      method: "POST",
      url: "/auth/register",
      payload: {
        email: "lookup@example.com",
        username: "lookupuser",
        password: "password123",
      },
    });

    const { access_token } = register.json();
    const fake_id = "00000000-0000-4000-8000-000000000000";

    const response = await app.inject({
      method: "GET",
      url: `/auth/users/${fake_id}`,
      headers: { authorization: `Bearer ${access_token}` },
    });

    assert.equal(response.statusCode, 404);
  });
});
