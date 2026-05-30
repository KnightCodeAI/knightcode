import { db } from "@knightcode/database/client";
import type { Prisma } from "@knightcode/database";
import type { LanguageModelUsage } from "ai";

export type MessageStatus = "streaming" | "complete" | "interrupted" | "error";

export type StoredMessage = {
  id: string;
  role: string;
  parts: any[];
  metadata: Record<string, unknown> | undefined;
  status: MessageStatus;
  durationMs: number | undefined;
  inputTokens: number | undefined;
  outputTokens: number | undefined;
  createdAt: Date;
};

type TxClient = Prisma.TransactionClient;

async function nextOrd(tx: TxClient, sessionId: string): Promise<number> {
  const agg = await tx.message.aggregate({
    where: { sessionId },
    _max: { ord: true },
  });
  return (agg._max.ord ?? 0) + 1;
}

export async function loadSessionMessages(
  sessionId: string,
): Promise<StoredMessage[]> {
  const rows = await db.message.findMany({
    where: { sessionId },
    orderBy: { ord: "asc" },
  });
  return rows.map((row) => ({
    id: row.id,
    role: row.role,
    parts: Array.isArray(row.parts) ? (row.parts as any[]) : [],
    metadata: row.metadata as Record<string, unknown> | undefined,
    status: row.status as MessageStatus,
    durationMs: row.durationMs ?? undefined,
    inputTokens: row.inputTokens ?? undefined,
    outputTokens: row.outputTokens ?? undefined,
    createdAt: row.createdAt,
  }));
}

export async function replaceSessionMessages(
  sessionId: string,
  messages: Array<{
    id: string;
    role: string;
    parts: any[];
    metadata?: Record<string, unknown> | null;
  }>,
  tx?: TxClient,
): Promise<void> {
  const run = async (client: TxClient) => {
    const existing = await client.message.findMany({
      where: { sessionId },
      select: {
        id: true,
        durationMs: true,
        inputTokens: true,
        outputTokens: true,
        credits: true,
        billed: true,
        startedAt: true,
        completedAt: true,
      },
    });

    const existingMap = new Map(existing.map((row) => [row.id, row]));

    await client.message.deleteMany({ where: { sessionId } });

    if (messages.length === 0) return;

    await client.message.createMany({
      data: messages.map((msg, idx) => {
        const ext = existingMap.get(msg.id);
        return {
          id: msg.id,
          sessionId,
          role: msg.role,
          parts: msg.parts as any,
          metadata: (msg.metadata ?? null) as any,
          status: "complete",
          // Per-session ord is set explicitly so order matches the input array
          // regardless of how createMany interleaves with the table-wide
          // autoincrement sequence.
          ord: idx + 1,
          durationMs: ext?.durationMs ?? null,
          inputTokens: ext?.inputTokens ?? null,
          outputTokens: ext?.outputTokens ?? null,
          credits: ext?.credits ?? null,
          billed: ext?.billed ?? false,
          startedAt: ext?.startedAt ?? null,
          completedAt: ext?.completedAt ?? null,
        };
      }),
    });
  };

  if (tx) {
    await run(tx);
  } else {
    await db.$transaction(run);
  }
}

export async function saveMessage(
  sessionId: string,
  msg: {
    id: string;
    role: string;
    parts: any[];
    metadata?: Record<string, unknown> | null;
    status?: MessageStatus;
    durationMs?: number | null;
    inputTokens?: number | null;
    outputTokens?: number | null;
    credits?: number | null;
    billed?: boolean;
  },
): Promise<void> {
  const status = msg.status ?? "complete";

  await db.$transaction(async (tx) => {
    const existing = await tx.message.findUnique({
      where: { id: msg.id },
      select: { id: true, billed: true },
    });

    if (existing) {
      // Don't let a retried client payload overwrite content that was already
      // persisted for a billed message — that would silently destroy the
      // user's original input on duplicate POSTs.
      if (existing.billed) return;

      await tx.message.update({
        where: { id: msg.id },
        data: {
          parts: msg.parts as any,
          metadata: (msg.metadata ?? null) as any,
          status,
          durationMs: msg.durationMs ?? null,
          inputTokens: msg.inputTokens ?? null,
          outputTokens: msg.outputTokens ?? null,
          credits: msg.credits ?? null,
          billed: msg.billed ?? false,
        },
      });
      return;
    }

    const ord = await nextOrd(tx, sessionId);
    await tx.message.create({
      data: {
        id: msg.id,
        sessionId,
        role: msg.role,
        parts: msg.parts as any,
        metadata: (msg.metadata ?? null) as any,
        status,
        ord,
        startedAt: status === "streaming" ? new Date() : null,
        durationMs: msg.durationMs ?? null,
        inputTokens: msg.inputTokens ?? null,
        outputTokens: msg.outputTokens ?? null,
        credits: msg.credits ?? null,
        billed: msg.billed ?? false,
      },
    });
  });
}

export async function finalizeAssistantMessage(
  id: string,
  sessionId: string,
  opts: {
    status: MessageStatus;
    parts: any[];
    metadata: Record<string, unknown>;
    durationMs: number;
    usage?: LanguageModelUsage | null;
    credits?: number | null;
  },
): Promise<void> {
  await db.$transaction(async (tx) => {
    const existing = await tx.message.findUnique({
      where: { id },
      select: { id: true },
    });

    if (existing) {
      await tx.message.update({
        where: { id },
        data: {
          parts: opts.parts as any,
          metadata: opts.metadata as any,
          status: opts.status,
          completedAt: new Date(),
          durationMs: opts.durationMs,
          inputTokens: opts.usage?.inputTokens ?? null,
          outputTokens: opts.usage?.outputTokens ?? null,
          credits: opts.credits ?? null,
          billed: true,
        },
      });
      return;
    }

    const ord = await nextOrd(tx, sessionId);
    await tx.message.create({
      data: {
        id,
        sessionId,
        role: "assistant",
        parts: opts.parts as any,
        metadata: opts.metadata as any,
        status: opts.status,
        ord,
        completedAt: new Date(),
        durationMs: opts.durationMs,
        inputTokens: opts.usage?.inputTokens ?? null,
        outputTokens: opts.usage?.outputTokens ?? null,
        credits: opts.credits ?? null,
        billed: true,
      },
    });
  });
}
