import { zValidator } from "@hono/zod-validator";
import { Prisma } from "@knightcode/database";
import { db } from "@knightcode/database/client";
import * as Sentry from "@sentry/hono/bun";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";

const createSessionSchema = z.object({
  title: z.string(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]).optional(),
});

const updateSessionSchema = z.object({
  reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]),
});

const createSessionValidator = zValidator(
  "json",
  createSessionSchema,
  (result, c) => {
    if (!result.success) {
      Sentry.logger.warn("Session creation validation failed", {
        path: c.req.path,
        issues: result.error.issues.length,
      });
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

const updateSessionValidator = zValidator(
  "json",
  updateSessionSchema,
  (result, c) => {
    if (!result.success) {
      Sentry.logger.warn("Session update validation failed", {
        path: c.req.path,
        issues: result.error.issues.length,
      });
      return c.json({ error: "Invalid request body" }, 400);
    }
  },
);

const app = new Hono<AuthenticatedEnv>()
  .get("/", async (c) => {
    const userId = c.get("userId");
    const sessions = await db.session.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        createdAt: true,
      },
    });

    return c.json(sessions);
  })
  .get("/:id", async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )

    const id = c.req.param("id");
    const userId = c.get("userId");

    const session = await db.session.findUnique({
      where: { id, userId },
    });

    if (!session) {
      Sentry.logger.warn("Session not found", {
        sessionId: id,
        userId: "mock-user",
      });
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  })
  .patch("/:id", updateSessionValidator, async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const { reasoningEffort } = c.req.valid("json");

    try {
      const session = await db.session.update({
        where: { id, userId },
        data: { reasoningEffort },
      });
      return c.json(session);
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return c.json({ error: "Session not found" }, 404);
      }
      Sentry.logger.error("Failed to update session reasoningEffort", {
        sessionId: id,
        error: err,
      });
      return c.json({ error: "Failed to update session" }, 500);
    }
  })
  .post("/", requireCreditsBalance, createSessionValidator, async (c) => {
    // MOCK: Uncomment to simulate slow session loading
    // await new Promise((r) => setTimeout(r, 5000))

    // MOCK: Uncomment to simulate session loading error
    // throw new HTTPException(
    //   500,
    //   { message: "Mock error: session loading failed" }
    // )
    const userId = c.get("userId");
    const data = c.req.valid("json");

    const session = await db.session.create({
      data: {
        ...data,
        userId,
      },
    });

    return c.json(session, 201);
  });

export default app;
