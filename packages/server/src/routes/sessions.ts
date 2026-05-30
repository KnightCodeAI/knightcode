import { zValidator } from "@hono/zod-validator";
import { Prisma } from "@knightcode/database";
import { db } from "@knightcode/database/client";
import * as Sentry from "@sentry/hono/bun";
import { Hono } from "hono";
import { z } from "zod";
import type { AuthenticatedEnv } from "../middleware/require-auth";
import { requireCreditsBalance } from "../middleware/require-credits-balance";
import { replaceSessionMessages } from "../lib/messages";
import { findSupportedChatModel } from "@knightcode/shared";

const createSessionSchema = z.object({
  title: z.string(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]).optional(),
});

const MessageSchema = z.object({
  id: z.string(),
  role: z.enum(["user", "assistant", "system", "data"]),
  parts: z.array(z.any()).optional(),
  metadata: z.record(z.string(), z.any()).optional(),
  createdAt: z.union([z.string(), z.number(), z.date()]).optional(),
});

const updateSessionSchema = z.object({
  title: z.string().min(1).optional(),
  reasoningEffort: z.enum(["none", "low", "medium", "high", "max"]).optional(),
  messages: z.array(MessageSchema).optional(),
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

// ---------------------------------------------------------------------------
// Stats cache — avoid full table scans on every /stats call
// ---------------------------------------------------------------------------

type StatsResult = {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

const statsCache = new Map<string, { data: StatsResult; expires: number }>();
const STATS_TTL_MS = 60_000; // 1 minute

setInterval(() => {
  const now = Date.now();
  for (const [key, val] of statsCache) {
    if (now >= val.expires) statsCache.delete(key);
  }
}, 5 * 60_000).unref();

// ---------------------------------------------------------------------------

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
  .get("/stats", async (c) => {
    const userId = c.get("userId");

    const cached = statsCache.get(userId);
    if (cached && Date.now() < cached.expires) {
      return c.json(cached.data);
    }

    const sessions = await db.session.findMany({
      where: { userId },
      select: { id: true },
    });

    const sessionIds = sessions.map((s) => s.id);

    const messageStats = await db.message.aggregate({
      where: { sessionId: { in: sessionIds } },
      _count: { id: true },
      _sum: { inputTokens: true, outputTokens: true },
    });

    const totalMessages = messageStats._count.id;
    const totalInputTokens = messageStats._sum.inputTokens ?? 0;
    const totalOutputTokens = messageStats._sum.outputTokens ?? 0;

    // Cost requires per-model pricing; only look at billed rows that have token counts
    const billedMessages = await db.message.findMany({
      where: {
        sessionId: { in: sessionIds },
        billed: true,
        inputTokens: { gt: 0 },
      },
      select: { metadata: true, inputTokens: true, outputTokens: true },
    });

    let totalCost = 0;
    for (const msg of billedMessages) {
      const meta = msg.metadata as Record<string, unknown> | null;
      const modelId = meta?.["model"] as string | undefined;
      if (modelId) {
        const modelDef = findSupportedChatModel(modelId);
        if (modelDef?.pricing) {
          totalCost +=
            ((msg.inputTokens ?? 0) / 1_000_000) *
              modelDef.pricing.inputUsdPerMillionTokens +
            ((msg.outputTokens ?? 0) / 1_000_000) *
              modelDef.pricing.outputUsdPerMillionTokens;
        }
      }
    }

    const data: StatsResult = {
      totalSessions: sessions.length,
      totalMessages,
      totalInputTokens,
      totalOutputTokens,
      totalCost,
    };

    statsCache.set(userId, { data, expires: Date.now() + STATS_TTL_MS });
    return c.json(data);
  })
  .get("/:id", async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");

    // Single query with relation include is naturally atomic — no torn snapshot
    // between a session findUnique and a concurrent finalizeAssistantMessage.
    const session = await db.session.findUnique({
      where: { id, userId },
      include: { messages: { orderBy: { ord: "asc" } } },
    });

    if (!session) {
      Sentry.logger.warn("Session not found", { sessionId: id, userId });
      return c.json({ error: "Session not found" }, 404);
    }

    return c.json(session);
  })
  .patch("/:id", updateSessionValidator, async (c) => {
    const id = c.req.param("id");
    const userId = c.get("userId");
    const { title, reasoningEffort, messages } = c.req.valid("json");

    // Validate the message payload before opening a transaction so a bad
    // request can't roll back a session metadata change that was committed
    // in a prior leg.
    const validated = messages?.map((msg) => {
      const parsed = MessageSchema.safeParse(msg);
      if (!parsed.success) {
        throw new Error(`Invalid message format: ${parsed.error.message}`);
      }
      return parsed.data;
    });

    try {
      const updateData: Prisma.SessionUpdateInput = {};
      if (title) updateData.title = title;
      if (reasoningEffort) updateData.reasoningEffort = reasoningEffort;

      const result = await db.$transaction(async (tx) => {
        const session = await tx.session.update({
          where: { id, userId },
          data: updateData,
        });

        if (validated !== undefined) {
          await replaceSessionMessages(
            id,
            validated.map((m) => ({
              id: m.id,
              role: m.role,
              parts: (m.parts ?? []) as any[],
              metadata: m.metadata as Record<string, unknown> | undefined,
            })),
            tx,
          );
        }

        // Read back inside the same transaction so the response always
        // matches what was committed atomically with the session update.
        const updatedMessages = await tx.message.findMany({
          where: { sessionId: id },
          orderBy: { ord: "asc" },
        });

        return { session, messages: updatedMessages };
      });

      return c.json({ ...result.session, messages: result.messages });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === "P2025"
      ) {
        return c.json({ error: "Session not found" }, 404);
      }
      Sentry.logger.error("Failed to update session properties", {
        sessionId: id,
        error: err,
      });
      return c.json({ error: "Failed to update session" }, 500);
    }
  })
  .post("/", requireCreditsBalance, createSessionValidator, async (c) => {
    const userId = c.get("userId");
    const data = c.req.valid("json");

    const session = await db.session.create({
      data: { ...data, userId },
    });

    return c.json({ ...session, messages: [] }, 201);
  });

export default app;
