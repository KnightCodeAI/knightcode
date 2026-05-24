import { createHmac, timingSafeEqual } from "crypto";
import { Hono } from "hono";

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

  try {
    const [encoded, signature] = state.split(".");
    if (!encoded || !signature) {
      return c.text("Invalid state format", 400);
    }

    const secret = process.env.JWT_SECRET!;
    const expectedSignature = createHmac("sha256", secret)
      .update(encoded)
      .digest("base64url");

    const a = Buffer.from(signature);
    const b = Buffer.from(expectedSignature);
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return c.text("Invalid authentication state signature", 400);
    }

    const payload = JSON.parse(Buffer.from(encoded, "base64url").toString());
    const port = payload.port;

    if (
      typeof port !== "number" ||
      !Number.isInteger(port) ||
      port < 1 ||
      port > 65535
    ) {
      throw new Error("Invalid port in state");
    }

    const redirectUrl = `http://localhost:${port}/callback?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`;

    return c.redirect(redirectUrl);
  } catch {
    return c.text("Invalid authentication state", 400);
  }
});

export default app;
