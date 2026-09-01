# strip-server Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut KnightCode loose from the hosted SaaS — repoint every remaining `apiClient` reader to the local `bun:sqlite` store, port WebFetch local, stub WebSearch, then delete `packages/server`, `packages/database`, OAuth/billing, and their dependencies — leaving a pure-local BYOK CLI that still compiles and runs.

**Architecture:** The main chat path is already server-independent (Phase 2). This phase removes the now-unused server by repointing the last consumers (sessions/stats/doctor/rename dialogs, the `/reasoning` + `/branch` commands, and `skillify`) to the local store, and the two web tools off the deleted `web` route. Sessions are scoped by working directory (`process.cwd()`), the local analog of the removed `userId`. After every consumer is local, `lib/api-client.ts` and both server-side packages are deleted wholesale.

**Tech Stack:** Bun monorepo (turborepo), `@knightcode/cli` (OpenTUI/React), Drizzle ORM over `bun:sqlite`, `html-to-text` for WebFetch, `bun:test` (TDD).

**Commit policy (user rule):** **One commit at the very end of the phase.** Stage changes as you go (`git rm` for deletions stages them); do not create intermediate commits. The commit message must NOT contain any AI name or `Co-Authored-By` trailer. The user opens the PR.

**Decision locked for this phase (user-approved):** WebFetch is ported to a full local implementation now (it needs no key); WebSearch becomes a graceful "not configured" stub. The real BYO-key WebSearch lands in the next phase (`web-tools`).

**Branch:** `strip-server`, branched from `main`. Do NOT start on `main`.

---

## File Map

**Store (new helpers):**

- Modify `packages/cli/src/lib/store/sessions.ts` — add `setSessionReasoningEffort`, `directorySessionStats`.
- Modify `packages/cli/src/lib/store/sessions.test.ts` — cover both new helpers.

**Dialogs / commands repointed to local store:**

- Modify `packages/cli/src/components/dialogs/sessions-dialog.tsx`
- Modify `packages/cli/src/components/dialogs/rename-dialog.tsx`
- Modify `packages/cli/src/components/dialogs/stats-dialog.tsx`
- Modify `packages/cli/src/components/dialogs/doctor-dialog.tsx`
- Modify `packages/cli/src/components/command-menu/commands.tsx` (reasoning persist, `/branch`, remove `/login` `/logout` `/upgrade` `/usage` + imports)
- Modify `packages/cli/src/lib/context/skills/bundled/skillify.ts`

**Web tools:**

- Rewrite `packages/cli/src/lib/tools/WebFetch/execute.ts` (local fetch + SSRF guard + html-to-text)
- Create `packages/cli/src/lib/tools/WebFetch/web-fetch.test.ts` (SSRF guard unit test)
- Rewrite `packages/cli/src/lib/tools/WebSearch/execute.ts` (graceful stub)

**Billing/credit UI cleanup:**

- Modify `packages/cli/src/hooks/use-chat.ts` (drop `credits` from `ChatMessageMetadata`)
- Modify `packages/cli/src/components/messages/compaction-message.tsx` (drop `credits` prop)
- Modify `packages/cli/src/screens/session.tsx` (drop `credits` passthrough)

**Deletions:**

- Delete `packages/cli/src/lib/api-client.ts`
- Delete `packages/cli/src/lib/auth/` (entire dir: `auth.ts`, `oauth.ts`)
- Delete `packages/cli/src/lib/upgrade.ts`
- Delete `packages/cli/src/lib/http-errors.ts` (orphaned after repoints)
- Delete `packages/server/` (entire package)
- Delete `packages/database/` (entire package)

**Dependency / config:**

- Modify `packages/cli/package.json` (drop `@knightcode/server`, `@knightcode/database`; add `html-to-text`, `@types/html-to-text`)
- Modify root `package.json` (drop `dev:server` script)
- Run `bun install` to refresh `bun.lock`

---

## Task 1: Store helpers — reasoning persist + directory stats

**Files:**

- Modify: `packages/cli/src/lib/store/sessions.ts`
- Test: `packages/cli/src/lib/store/sessions.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `packages/cli/src/lib/store/sessions.test.ts` (inside the existing `describe`, or add a new one — match the file's existing imports/setup for an in-memory store via `createStore(":memory:")`). Add `setSessionReasoningEffort` and `directorySessionStats` to the import from `./sessions`, and `appendMessage` from `./messages`:

```ts
import { setSessionReasoningEffort, directorySessionStats } from "./sessions";
import { appendMessage } from "./messages";

describe("setSessionReasoningEffort", () => {
  test("updates the session's reasoning effort", () => {
    const db = createStore(":memory:");
    const row = createSession(db, { directory: "/proj", title: "T" });
    setSessionReasoningEffort(db, row.id, "high");
    expect(getSession(db, row.id)?.reasoningEffort).toBe("high");
  });
});

describe("directorySessionStats", () => {
  test("aggregates token totals and message counts per session, scoped to directory", () => {
    const db = createStore(":memory:");
    const a = createSession(db, {
      directory: "/proj",
      title: "A",
      model: "z-ai/glm-4.5-air:free",
    });
    createSession(db, { directory: "/other", title: "B" });
    appendMessage(db, {
      id: "m1",
      sessionId: a.id,
      role: "assistant",
      parts: [],
      inputTokens: 10,
      outputTokens: 5,
    });
    appendMessage(db, {
      id: "m2",
      sessionId: a.id,
      role: "assistant",
      parts: [],
      inputTokens: 3,
      outputTokens: 2,
    });

    const rows = directorySessionStats(db, "/proj");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.model).toBe("z-ai/glm-4.5-air:free");
    expect(rows[0]?.inputTokens).toBe(13);
    expect(rows[0]?.outputTokens).toBe(7);
    expect(rows[0]?.messageCount).toBe(2);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `bun --cwd packages/cli run test`
Expected: FAIL — `setSessionReasoningEffort` / `directorySessionStats` are not exported.

- [ ] **Step 3: Implement the helpers**

In `packages/cli/src/lib/store/sessions.ts`, the existing imports already include `desc, eq` from `drizzle-orm` and `sessionTable, type SessionRow` from `./schema`. Extend the imports and append the functions:

```ts
import { desc, eq, sql } from "drizzle-orm";
import { sessionTable, messageTable, type SessionRow } from "./schema";

// ...existing functions unchanged...

export function setSessionReasoningEffort(
  db: Store,
  id: string,
  reasoningEffort: string,
): void {
  db.update(sessionTable)
    .set({ reasoningEffort, timeUpdated: Date.now() })
    .where(eq(sessionTable.id, id))
    .run();
}

export interface DirectorySessionStat {
  sessionId: string;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  messageCount: number;
}

/**
 * Per-session token/message aggregates for every session in `directory`.
 * Cost is derived by the caller from each session's `model` pricing
 * (an approximation: a session's tokens are priced at its last model).
 */
export function directorySessionStats(
  db: Store,
  directory: string,
): DirectorySessionStat[] {
  return db
    .select({
      sessionId: sessionTable.id,
      model: sessionTable.model,
      inputTokens: sql<number>`coalesce(sum(${messageTable.inputTokens}), 0)`,
      outputTokens: sql<number>`coalesce(sum(${messageTable.outputTokens}), 0)`,
      messageCount: sql<number>`count(${messageTable.id})`,
    })
    .from(sessionTable)
    .leftJoin(messageTable, eq(messageTable.sessionId, sessionTable.id))
    .where(eq(sessionTable.directory, directory))
    .groupBy(sessionTable.id)
    .all();
}
```

(Note: add `sql` to the `drizzle-orm` import and `messageTable` to the `./schema` import.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `bun --cwd packages/cli run test`
Expected: PASS (both new tests green; existing tests still green).

- [ ] **Step 5: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors.

---

## Task 2: Repoint sessions-dialog + rename-dialog to local store

**Files:**

- Modify: `packages/cli/src/components/dialogs/sessions-dialog.tsx`
- Modify: `packages/cli/src/components/dialogs/rename-dialog.tsx`

- [ ] **Step 1: Rewrite `sessions-dialog.tsx`**

Reads are synchronous (`bun:sqlite`), so drop the async fetch/loading machinery. Replace the file body with:

```tsx
import { useCallback, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { format } from "date-fns";
import { useNavigate } from "react-router";
import { useDialog } from "../../providers/dialogs";
import { getStore } from "../../lib/store/client";
import { listSessions, type SessionRow } from "../../lib/store";
import { DialogSearchList } from "../dialog-search-list";

export const SessionsDialogContent = () => {
  const [sessions] = useState<SessionRow[]>(() =>
    listSessions(getStore(), process.cwd()),
  );
  const { close } = useDialog();
  const navigate = useNavigate();

  const handleSelect = useCallback(
    (session: SessionRow) => {
      close();
      navigate(`/sessions/${session.id}`);
    },
    [close, navigate],
  );

  return (
    <DialogSearchList
      items={sessions}
      onSelect={handleSelect}
      filterFn={(s, query) =>
        s.title.toLowerCase().includes(query.toLowerCase())
      }
      renderItem={(session, isSelected) => (
        <>
          <text selectable={false} fg={isSelected ? "black" : "white"}>
            {session.title}
          </text>
          <box flexGrow={1} />
          <text
            selectable={false}
            fg={isSelected ? "black" : undefined}
            attributes={TextAttributes.DIM}
          >
            {format(new Date(session.timeUpdated), "hh:mm a")}
          </text>
        </>
      )}
      getKey={(s) => s.id}
      placeholder="Search sessions"
      emptyText="No sessions in this directory"
    />
  );
};
```

- [ ] **Step 2: Rewrite the `handleSubmit` in `rename-dialog.tsx`**

Replace the `apiClient` import with the store, and swap the network patch for `renameSession`:

```tsx
import { getStore } from "../../lib/store/client";
import { renameSession } from "../../lib/store";
```

Replace the `try { const res = await apiClient.sessions[":id"].$patch(...) ... }` block in `handleSubmit` with:

```tsx
try {
  renameSession(getStore(), sessionId, title);
  toast.show({
    variant: "success",
    message: `Session renamed to "${title}"`,
  });
  dialog.close();
} catch (err) {
  toast.show({
    variant: "error",
    message: `Failed to rename: ${(err as Error).message}`,
  });
}
```

(`handleSubmit` can stay `async` for the keyboard handler's `void handleSubmit()`; `renameSession` is sync but the wrapper signature is unchanged.)

- [ ] **Step 3: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors (neither file references `apiClient` or `getErrorMessage` anymore).

---

## Task 3: Repoint stats-dialog to directory-scoped local aggregates

**Files:**

- Modify: `packages/cli/src/components/dialogs/stats-dialog.tsx`

- [ ] **Step 1: Rewrite `stats-dialog.tsx`**

Compute totals + estimated cost locally from `directorySessionStats` and shared pricing. Replace the whole file with:

```tsx
import { useState } from "react";
import { TextAttributes } from "@opentui/core";
import { findSupportedChatModel } from "@knightcode/shared";
import { getStore } from "../../lib/store/client";
import { directorySessionStats } from "../../lib/store";

type Stats = {
  totalSessions: number;
  totalMessages: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
};

function computeStats(): Stats {
  const rows = directorySessionStats(getStore(), process.cwd());
  let totalMessages = 0;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  for (const r of rows) {
    totalMessages += r.messageCount;
    totalInputTokens += r.inputTokens;
    totalOutputTokens += r.outputTokens;
    const def = r.model ? findSupportedChatModel(r.model) : undefined;
    if (def?.pricing) {
      totalCost +=
        (r.inputTokens / 1_000_000) * def.pricing.inputUsdPerMillionTokens +
        (r.outputTokens / 1_000_000) * def.pricing.outputUsdPerMillionTokens;
    }
  }
  return {
    totalSessions: rows.length,
    totalMessages,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
  };
}

export function StatsDialogContent() {
  const [stats] = useState<Stats>(computeStats);

  const rows: [string, string][] = [
    ["Sessions", stats.totalSessions.toLocaleString()],
    ["Total messages", stats.totalMessages.toLocaleString()],
    ["Input tokens", stats.totalInputTokens.toLocaleString()],
    ["Output tokens", stats.totalOutputTokens.toLocaleString()],
    [
      "Total tokens",
      (stats.totalInputTokens + stats.totalOutputTokens).toLocaleString(),
    ],
    [
      "Est. total cost",
      stats.totalCost > 0 ? `$${stats.totalCost.toFixed(4)}` : "Free",
    ],
  ];

  return (
    <box flexDirection="column" gap={1} width="100%">
      <text attributes={TextAttributes.BOLD}>
        Usage statistics — this directory
      </text>
      {rows.map(([label, value]) => (
        <box key={label} flexDirection="row" gap={2}>
          <box width={18} flexShrink={0}>
            <text attributes={TextAttributes.DIM}>{label}</text>
          </box>
          <text>{value}</text>
        </box>
      ))}
    </box>
  );
}
```

- [ ] **Step 2: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors.

---

## Task 4: Rewrite doctor-dialog (drop auth/server checks)

**Files:**

- Modify: `packages/cli/src/components/dialogs/doctor-dialog.tsx`

- [ ] **Step 1: Replace the auth + server-connectivity checks**

Swap the two SaaS checks ("Auth token", "Server connectivity") for local ones (OpenRouter key, local store). Update the imports and the `checks` state + effect:

Replace the imports block:

```tsx
import { useEffect, useState } from "react";
import { TextAttributes } from "@opentui/core";
import { spawnSync } from "child_process";
import { getOpenRouterApiKey } from "../../lib/credentials";
import { getStore } from "../../lib/store/client";
import { listSessions } from "../../lib/store";
```

Replace the initial `checks` state:

```tsx
const [checks, setChecks] = useState<Check[]>([
  { label: "OpenRouter API key", status: "pending" },
  { label: "Local store", status: "pending" },
  { label: "Git available", status: "pending" },
  { label: "Runtime", status: "pending" },
]);
```

Replace the body of the `useEffect` (keep the `update` helper, replace checks 1 and 2; checks 3 and 4 stay):

```tsx
// 1. OpenRouter API key
if (getOpenRouterApiKey()) {
  update(0, "ok", "key present");
} else {
  update(0, "fail", "set OPENROUTER_API_KEY or add it to credentials.json");
}

// 2. Local store
try {
  listSessions(getStore(), process.cwd());
  update(1, "ok", "ready");
} catch (err) {
  update(1, "fail", err instanceof Error ? err.message : "unavailable");
}

// 3. Git available
const git = spawnSync("git", ["--version"], { encoding: "utf-8" });
if (git.status === 0) {
  update(2, "ok", git.stdout.trim());
} else {
  update(2, "warn", "git not found in PATH");
}

// 4. Runtime
const runtime =
  typeof Bun !== "undefined"
    ? `Bun ${(globalThis as any).Bun.version}`
    : `Node ${process.version}`;
update(3, "ok", runtime);
```

- [ ] **Step 2: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors (no `apiClient` / `getAuth` imports remain).

---

## Task 5: Repoint commands.tsx — reasoning persist + `/branch`; remove login/billing commands

**Files:**

- Modify: `packages/cli/src/components/command-menu/commands.tsx`

- [ ] **Step 1: Update imports**

Remove the SaaS imports and add the store ones. Delete these lines:

```tsx
import { apiClient } from "../../lib/api-client";
import { performLogin } from "../../lib/auth/oauth";
import { clearAuth } from "../../lib/auth/auth";
import { openBillingPortal, openUpgradeCheckout } from "../../lib/upgrade";
```

Add:

```tsx
import { getStore } from "../../lib/store/client";
import { createSession, setSessionReasoningEffort } from "../../lib/store";
import { replaceSessionMessages } from "../../lib/store/conversation";
```

- [ ] **Step 2: Delete the `/login`, `/logout`, `/upgrade`, `/usage` command objects**

Remove the four command entries entirely (the `name: "login"`, `name: "logout"`, `name: "upgrade"`, `name: "usage"` objects). They have no local analog in a BYOK CLI.

- [ ] **Step 3: Repoint the `/reasoning` persistence**

In the `reasoning` command's `onSelectEffort`, replace the `apiClient.sessions[":id"].$patch({ ... reasoningEffort ... })` block with a local write:

```tsx
            onSelectEffort={(level) => {
              ctx.setReasoningEffort(level);
              if (ctx.sessionId) {
                try {
                  setSessionReasoningEffort(getStore(), ctx.sessionId, level);
                } catch {
                  ctx.toast.show({
                    message: "Failed to persist reasoning effort",
                    variant: "error",
                  });
                }
              }
            }}
```

- [ ] **Step 4: Repoint `/branch` to the local store**

Replace the `apiClient.sessions.$post` + `apiClient.sessions[":id"].$patch` body of the `branch` command's `action` with a local create + transcript copy:

```tsx
    action: (ctx) => {
      if (!ctx.messages || ctx.messages.length === 0) {
        ctx.toast.show({ variant: "error", message: "Nothing to branch from" });
        return;
      }
      ctx.toast.show({ message: "Forking session…" });
      try {
        const store = getStore();
        const row = createSession(store, {
          directory: process.cwd(),
          title: "Branch",
          model: ctx.model,
          reasoningEffort: ctx.reasoningEffort,
        });
        replaceSessionMessages(
          store,
          row.id,
          ctx.messages.map((m) => ({
            id: m.id,
            role: m.role,
            parts: m.parts as unknown[],
            metadata: (m.metadata ?? null) as Record<string, unknown> | null,
          })),
        );
        ctx.toast.show({
          variant: "success",
          message: "Session forked — navigating…",
        });
        setTimeout(() => {
          ctx.navigate(`/sessions/${row.id}`);
        }, 400);
      } catch (err) {
        ctx.toast.show({
          variant: "error",
          message: `Branch failed: ${(err as Error).message}`,
        });
      }
    },
```

(The `action` is now synchronous — drop the `async` keyword on this command's `action`. Navigating without location state makes `session.tsx` load the just-persisted transcript from the store.)

- [ ] **Step 5: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors. Confirm there are no remaining `apiClient` references in this file.

---

## Task 6: Repoint skillify to the local store

**Files:**

- Modify: `packages/cli/src/lib/context/skills/bundled/skillify.ts`

- [ ] **Step 1: Replace the `apiClient` session fetch with `loadConversation`**

Swap the import:

```ts
import { getStore } from "../../../store/client";
import { loadConversation } from "../../../store/conversation";
```

Replace the `getDynamicBody` session-fetch block (the `if (sessionId) { ... apiClient.sessions[":id"].$get ... }`) with a synchronous local read:

```ts
  getDynamicBody: async (args, sessionId) => {
    let userMessagesText = "No session history available.";
    if (sessionId) {
      try {
        const messages = loadConversation(getStore(), sessionId);
        const userMessages = messages
          .filter((m) => m.role === "user")
          .map((m) =>
            Array.isArray(m.parts)
              ? m.parts
                  .filter((p: any) => p && p.type === "text")
                  .map((p: any) => p.text)
                  .join("\n")
              : "",
          )
          .filter(Boolean);
        if (userMessages.length > 0) {
          userMessagesText = userMessages.join("\n\n---\n\n");
        }
      } catch (err) {
        console.error("Failed to load session messages for skillify:", err);
      }
    }

    let prompt = SKILLIFY_PROMPT_TEMPLATE.replace(
      "{{userMessages}}",
      userMessagesText,
    );
    if (args) {
      prompt += `\n\n## Additional User Instructions\n\n${args}`;
    }
    return prompt;
  },
```

- [ ] **Step 2: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors.

---

## Task 7: Port WebFetch local; stub WebSearch

**Files:**

- Rewrite: `packages/cli/src/lib/tools/WebFetch/execute.ts`
- Create: `packages/cli/src/lib/tools/WebFetch/web-fetch.test.ts`
- Rewrite: `packages/cli/src/lib/tools/WebSearch/execute.ts`
- Modify: `packages/cli/package.json` (add `html-to-text` deps)

- [ ] **Step 1: Add the `html-to-text` dependencies**

In `packages/cli/package.json`, add to `dependencies`:

```json
    "html-to-text": "^10.0.0",
```

and to `devDependencies`:

```json
    "@types/html-to-text": "^9.0.4",
```

(Both versions already resolve in `bun.lock` from the server package; a `bun install` in Task 10 finalizes the lockfile.)

- [ ] **Step 2: Write the failing SSRF-guard test**

Create `packages/cli/src/lib/tools/WebFetch/web-fetch.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isPrivateIp } from "./execute";

describe("isPrivateIp", () => {
  test("flags private / loopback / link-local addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.0.0.1",
      "192.168.1.1",
      "172.16.0.1",
      "169.254.0.1",
      "100.64.0.1",
      "::1",
      "localhost",
      "metadata.google.internal",
    ]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });

  test("allows public addresses", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "172.15.0.1", "192.169.0.1"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `bun --cwd packages/cli run test`
Expected: FAIL — `./execute` has no `isPrivateIp` export yet.

- [ ] **Step 4: Rewrite `WebFetch/execute.ts` with the local implementation**

Port the server's `web.ts` fetch path (SSRF guard, IP pinning, streamed size cap, html-to-text), exporting `isPrivateIp` for the test:

```ts
import { convert } from "html-to-text";
import dns from "node:dns/promises";
import net from "node:net";
import { WebFetch, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = WebFetch;

class SafeTargetError extends Error {}

export function isPrivateIp(ip: string): boolean {
  const normalized = ip.toLowerCase();
  if (normalized.startsWith("::ffff:")) {
    const rest = normalized.slice(7);
    if (net.isIPv4(rest)) return isPrivateIp(rest);
    const hexParts = rest.split(":");
    if (hexParts.length === 2) {
      const high = parseInt(hexParts[0]!, 16);
      const low = parseInt(hexParts[1]!, 16);
      if (!isNaN(high) && !isNaN(low)) {
        const ipv4 = `${(high >> 8) & 0xff}.${high & 0xff}.${(low >> 8) & 0xff}.${low & 0xff}`;
        return isPrivateIp(ipv4);
      }
    }
  }

  if (net.isIPv4(normalized)) {
    const parts = normalized.split(".").map((part) => Number(part));
    const [a, b] = parts;
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254))
      return true;
    if (a === 172 && b !== undefined && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b !== undefined && b >= 64 && b <= 127) return true;
    if (a === 198 && (b === 18 || b === 19)) return true;
    return false;
  }

  if (net.isIPv6(normalized)) {
    return (
      normalized === "::1" ||
      normalized === "::" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab][0-9a-f]:/.test(normalized)
    );
  }

  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "metadata.google.internal"
  );
}

async function assertSafeTarget(
  rawUrl: string,
): Promise<{ vettedIp: string; hostname: string }> {
  const u = new URL(rawUrl);
  if (!["http:", "https:"].includes(u.protocol)) {
    throw new SafeTargetError("Only http/https URLs are allowed");
  }
  const records = await dns.lookup(u.hostname, { all: true });
  const safeRecords = records.filter((r) => !isPrivateIp(r.address));
  if (safeRecords.length === 0) {
    throw new SafeTargetError(
      "Target host resolves to no allowed public addresses",
    );
  }
  return { vettedIp: safeRecords[0]!.address, hostname: u.hostname };
}

export async function execute(input: unknown): Promise<unknown> {
  const { url, prompt, max_length } = WebFetch.input_schema.parse(input);
  const maxLength = max_length ?? 20_000;

  const { vettedIp, hostname } = await assertSafeTarget(url);
  const u = new URL(url);
  u.hostname = vettedIp.includes(":") ? `[${vettedIp}]` : vettedIp;
  const targetUrl = u.toString();

  const response = await fetch(targetUrl, {
    redirect: "error",
    headers: {
      "User-Agent":
        "Mozilla/5.0 (compatible; KnightCode/1.0; +https://knightcode.dev)",
      Accept: "text/html, application/xhtml+xml, text/plain",
      Host: hostname,
    },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const contentType = response.headers.get("content-type") ?? "";
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > maxLength * 5) {
    throw new Error("Response too large to fetch safely");
  }
  if (!response.body) throw new Error("Response body is null");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let raw = "";
  let accumulatedBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        accumulatedBytes += value.byteLength;
        if (accumulatedBytes > maxLength * 5) {
          await reader.cancel();
          throw new Error("Response too large to fetch safely");
        }
        raw += decoder.decode(value, { stream: true });
      }
    }
    raw += decoder.decode();
  } finally {
    reader.releaseLock();
  }

  let text: string;
  if (contentType.includes("text/html") || contentType.includes("xhtml")) {
    text = convert(raw, {
      wordwrap: 120,
      selectors: [
        { selector: "img", format: "skip" },
        { selector: "script", format: "skip" },
        { selector: "style", format: "skip" },
        { selector: "nav", format: "skip" },
        { selector: "footer", format: "skip" },
        { selector: "a", options: { ignoreHref: true } },
      ],
    });
  } else {
    text = raw;
  }

  const truncated = text.length > maxLength;
  return {
    content: truncated ? text.slice(0, maxLength) : text,
    truncated,
    totalLength: text.length,
    url,
    prompt,
  };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `bun --cwd packages/cli run test`
Expected: PASS (`isPrivateIp` tests green).

- [ ] **Step 6: Rewrite `WebSearch/execute.ts` as a graceful stub**

```ts
import { WebSearch, type KnightcodeTool } from "@knightcode/shared";

export const tool: KnightcodeTool = WebSearch;

export async function execute(input: unknown): Promise<unknown> {
  // Validate inputs so the tool contract is unchanged, then degrade
  // gracefully: BYO-key WebSearch lands in the web-tools phase.
  const { allowed_domains, blocked_domains } =
    WebSearch.input_schema.parse(input);
  if (allowed_domains?.length && blocked_domains?.length) {
    throw new Error(
      "Cannot specify both allowed_domains and blocked_domains in the same request",
    );
  }
  return {
    error:
      "WebSearch is not configured. Add a search provider key in a future release; proceed without web search for now.",
    results: [],
  };
}
```

- [ ] **Step 7: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors. Confirm no `apiClient` references remain anywhere in `packages/cli/src` (grep), since the web tools were the last consumers.

---

## Task 8: Clean billing/credit UI fields

**Files:**

- Modify: `packages/cli/src/hooks/use-chat.ts`
- Modify: `packages/cli/src/components/messages/compaction-message.tsx`
- Modify: `packages/cli/src/screens/session.tsx`

- [ ] **Step 1: Drop `credits` from `ChatMessageMetadata`**

In `packages/cli/src/hooks/use-chat.ts`, remove the line `credits?: number;` from the `ChatMessageMetadata` type. (Compaction is local and never set it post-Phase-2; it always rendered as "Free".)

- [ ] **Step 2: Remove the `credits` prop from `CompactionMessage`**

In `packages/cli/src/components/messages/compaction-message.tsx`:

- Remove `credits: number;` from `Props`.
- Remove `credits,` from the destructured params.
- Replace the credits `<text>` in the header row:

```tsx
<text fg={colors.success} attributes={TextAttributes.BOLD}>
  Free
</text>
```

- [ ] **Step 3: Drop the `credits` passthrough in `session.tsx`**

In `packages/cli/src/screens/session.tsx`, in the `isCompaction` branch of `ChatMessage`, remove the `credits={msg.metadata.credits ?? 0}` prop from `<CompactionMessage ... />`.

- [ ] **Step 4: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors.

---

## Task 9: Delete the dead CLI modules

**Files (delete):**

- `packages/cli/src/lib/api-client.ts`
- `packages/cli/src/lib/auth/` (dir)
- `packages/cli/src/lib/upgrade.ts`
- `packages/cli/src/lib/http-errors.ts`

- [ ] **Step 1: Confirm there are no remaining importers**

Grep each before deleting:

Run (PowerShell, from repo root): inspect for stragglers with the Grep tool for patterns `api-client`, `lib/auth`, `lib/upgrade`, `http-errors` under `packages/cli/src`.
Expected: the only matches are the files being deleted themselves.

- [ ] **Step 2: Delete (and stage) the files**

```powershell
git rm packages/cli/src/lib/api-client.ts packages/cli/src/lib/upgrade.ts packages/cli/src/lib/http-errors.ts
git rm -r packages/cli/src/lib/auth
```

- [ ] **Step 3: Type-check**

Run: `bun --cwd packages/cli run check-types`
Expected: no errors. (If anything still imports a deleted module, fix that consumer now.)

---

## Task 10: Remove server/database packages + dependencies

**Files:**

- Modify: `packages/cli/package.json`
- Modify: root `package.json`
- Delete: `packages/server/` (dir)
- Delete: `packages/database/` (dir)

- [ ] **Step 1: Drop the workspace deps from `packages/cli/package.json`**

In `devDependencies`, remove:

```json
    "@knightcode/server": "workspace:*",
```

In `dependencies`, remove:

```json
    "@knightcode/database": "workspace:*",
```

(`html-to-text` / `@types/html-to-text` added in Task 7 remain.)

- [ ] **Step 2: Drop the `dev:server` script from root `package.json`**

Remove the line:

```json
    "dev:server": "bun run --hot packages/server/src/index.ts",
```

- [ ] **Step 3: Delete (and stage) the packages**

```powershell
git rm -r packages/server packages/database
```

- [ ] **Step 4: Refresh the lockfile**

Run: `bun install`
Expected: `bun.lock` updates — `@knightcode/server`, `@knightcode/database`, and the now-unreferenced Clerk/Polar/Sentry/Prisma/pg trees drop out. No install errors.

- [ ] **Step 5: Workspace-wide type-check**

Run: `bun run check-types`
Expected: turbo runs `check-types` for `@knightcode/cli` and `@knightcode/shared` only (server/database gone); both pass.

---

## Task 11: Full verification + single commit

- [ ] **Step 1: Type-check (workspace)**

Run: `bun run check-types`
Expected: PASS for all remaining packages.

- [ ] **Step 2: CLI test suite**

Run: `bun --cwd packages/cli run test`
Expected: PASS — all prior tests plus the new `sessions.test.ts` and `web-fetch.test.ts` cases.

- [ ] **Step 3: Shared test suite (sanity — untouched but verify)**

Run (PowerShell): `bun --cwd packages/shared test`

> If that errors with "Script not found 'test'", run it from the package dir instead: open a shell in `packages/shared` and run `bun test`.
> Expected: PASS.

- [ ] **Step 4: Final grep sweep**

Confirm zero references remain to any removed surface under `packages/cli/src`:
`apiClient`, `@knightcode/server`, `@knightcode/database`, `lib/auth`, `lib/upgrade`, `http-errors`, `performLogin`, `clearAuth`, `openBillingPortal`, `openUpgradeCheckout`, `credits`.
Expected: no matches.

- [ ] **Step 5: Single commit (no AI name / no Co-Authored-By)**

Stage any remaining modified files and commit once:

```powershell
git add -A
git status   # review: deletions of server/database/auth/api-client + repointed files
git commit -m @'
feat(cli): strip SaaS server, go pure-local BYOK

Repoint sessions/stats/doctor/rename dialogs, /reasoning + /branch
commands, and skillify to the local bun:sqlite store (scoped by
working directory). Port WebFetch to a local fetch with SSRF guard
+ html-to-text; stub WebSearch pending BYO-key support. Remove
OAuth/login and billing/credit UI. Delete packages/server,
packages/database, lib/api-client, lib/auth, lib/upgrade, and their
Clerk/Polar/Sentry/Prisma dependencies.
'@
```

- [ ] **Step 6: Hand off**

Report completion. The user opens the PR (CodeRabbit + Codex review). Do NOT push or open the PR yourself unless asked. Once the PR is open, address review feedback with NEW commits — never force-push.

---

## Self-Review notes (coverage vs. spec §6.10 / roadmap Phase 3)

- ✅ Repoint dialogs off `apiClient`: sessions (T2), rename (T2), stats (T3), doctor (T4), commands rename→reasoning + branch (T5), skillify (T6).
- ✅ Delete `packages/server`, `lib/api-client.ts`, `lib/auth/*` (OAuth), billing/credit UI, Prisma `packages/database` (T8–T10).
- ✅ Remove deps: Clerk/Polar/Sentry/Prisma/pg ride out with the deleted packages; Hono client usage removed with `api-client.ts`; `@knightcode/server`/`@knightcode/database` dropped from CLI (T10).
- ✅ `metadata.credits` UI field cleaned up (T8).
- ✅ Web tools kept compiling despite the server deletion (decision: WebFetch local now, WebSearch stub) (T7).
- ⏭️ Deferred to `web-tools`: real BYO-key WebSearch (provider + key config + onboarding wiring).
- ⏭️ Not in scope: old Postgres-only sessions are not migrated (they simply won't appear — sessions are now directory-scoped local rows).
