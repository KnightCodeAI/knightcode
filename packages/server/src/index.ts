import * as Sentry from "@sentry/hono/bun";
import { sentry } from "@sentry/hono/bun";
import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import sessions from "./routes/sessions";

const app = new Hono();

app.use(
  sentry(app, {
    dsn: "https://52694e368183ae3c69f85abca62938a1@o4510229390032896.ingest.de.sentry.io/4511438565802064",
    tracesSampleRate: 1.0,
    enableLogs: true,
    sendDefaultPii: true,
  }),
);

app.get("/debug-sentry", () => {
  // Send a log before throwing the error
  Sentry.logger.info("User triggered test error", {
    action: "test_error_endpoint",
  });
  // Send a test metric before throwing the error
  Sentry.metrics.count("test_counter", 1);
  throw new Error("My first Sentry error!");
});

app.onError((error, c) => {
  if (error instanceof HTTPException) {
    Sentry.logger.warn("Handled HTTP error", {
      status: error.status,
      message: error.message || "Request failed",
      path: c.req.path,
      method: c.req.method,
    });
    return c.json({ error: error.message || "Request Failed" }, error.status);
  }

  Sentry.logger.error("Unhandled server error", {
    path: c.req.path,
    method: c.req.method,
    message: error instanceof Error ? error.message : "Unknown failed",
  });
  return c.json({ error: "Internal server error" }, 500);
});

const routes = app.route("/sessions", sessions);

export type AppType = typeof routes;

export default {
  port: 3000,
  fetch: app.fetch,
  idleTimeout: 255,
};
