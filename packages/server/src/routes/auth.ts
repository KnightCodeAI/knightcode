import { createHmac, timingSafeEqual } from "crypto";
import { Hono } from "hono";

function verifyState(state: string): { port: number } | null {
  const secret = process.env.JWT_SECRET;
  if (!secret) return null;

  const dot = state.lastIndexOf(".");
  if (dot <= 0) return null;

  const payloadB64 = state.slice(0, dot);
  const sigB64 = state.slice(dot + 1);

  const expectedSig = createHmac("sha256", secret).update(payloadB64).digest();
  let providedSig: Buffer;
  try {
    providedSig = Buffer.from(sigB64, "base64url");
  } catch {
    return null;
  }
  if (providedSig.length !== expectedSig.length) return null;
  if (!timingSafeEqual(providedSig, expectedSig)) return null;

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    if (typeof payload?.port !== "number") return null;
    return { port: payload.port };
  } catch {
    return null;
  }
}

const app = new Hono().get("/callback", (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");

  const errorDescription = c.req.query("error_description");

  if (error) {
    return c.text(errorDescription ?? error, 400);
  }

  if (!code || !state) {
    return c.text("Missing authorization code or state", 400);
  }

  const verified = verifyState(state);
  if (!verified) {
    return c.text("Invalid authentication state", 400);
  }

  const { port } = verified;

  const blockedPorts = new Set([
    1433, // MS SQL
    1521, // Oracle
    3306, // MySQL
    5432, // PostgreSQL
    6379, // Redis
    8080, // Alternative HTTP / Jenkins
    9000, // Alternative HTTP / php-fpm
    27017, // MongoDB
  ]);

  if (
    !Number.isInteger(port) ||
    port < 1024 ||
    port > 65535 ||
    blockedPorts.has(port)
  ) {
    return c.text("Invalid authentication state", 400);
  }

  const redirectUrl = `http://localhost:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

  return c.redirect(redirectUrl);
});

export default app;
