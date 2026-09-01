# Onboarding Wizard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run onboarding wizard (OpenRouter key → validate → pick a default model → optional search provider + key) that gates the app until a key is resolvable, plus a `/setup` command to re-run it later — replacing the removed OAuth login.

**Architecture:** All logic lives in pure, unit-tested `lib/onboarding/` functions (needs-check, key validation, persist). A thin React `OnboardingProvider` holds visibility state; an `OnboardingWizard` component overlays the app (like a dialog) and drives the steps. The wizard writes secrets to `~/.knightcode/credentials.json` and the chosen model to `settings.json`, and the model choice now actually takes effect because `PromptConfigProvider` initializes from (and persists to) settings.

**Tech Stack:** Bun, `bun:test` (TDD), TypeScript, OpenTUI/React (`@opentui/react`), AI SDK, existing `lib/credentials.ts` + `lib/settings.ts` + `lib/paths.ts`.

---

## Workflow constraints (read before starting — [[feedback-workflow]] + [[feedback-commit-no-name]])

- **Never commit this plan, the spec, or the roadmap.** Commit **code only**. The `docs/` tree is untracked and must stay that way.
- **One commit for the whole phase.** Subagent-driven execution may commit per task to give reviewers clean diffs; squash to a single commit via `git reset --soft main` before finishing. Verify the branch is not yet on `origin` before squashing.
- **The user opens the PR**, not the implementer. After the phase is committed, **stop** — do not push unless the user says so, and do not open a PR.
- **Once the branch is published / a PR is open, never force-push** — address review feedback with a **new commit**.
- **Never add an AI name or `Co-Authored-By` trailer** to commit messages.
- **Secrets** (`openRouterApiKey`, `searchApiKey`) live only in `~/.knightcode/credentials.json` (`0600`). Never log them, never write them to session storage, never echo them back in a toast.
- Validate before declaring done: from inside `packages/cli`, run `bun run check-types` and `bun test`; from inside `packages/shared`, run `bun test`. (Running `bun --cwd packages/cli run check-types` misparses in Bun 1.3.3 — `cd` into the package dir instead.)

---

## Background: how the current code works (so you don't have to rediscover it)

- **No first-run gate today.** `src/index.tsx` builds a `createMemoryRouter` whose index route is `Home`. `RootLayout` (`src/layouts/root-layout.tsx`) nests providers: `ThemeProvider → ToastProvider → KeyboardLayerProvider → DialogProvider → PromptConfigProvider → TodoProvider → ThemedRoot → <Outlet/>`.
- **Key resolution** is centralized in `src/lib/credentials.ts`: `getOpenRouterApiKey()` returns `process.env.OPENROUTER_API_KEY ?? read().openRouterApiKey`. `saveCredentials(patch)` merges-and-persists (`0600`). `SearchProvider = "brave" | "tavily"` is exported there.
- **Inference already errors without a key:** `src/lib/inference/resolve-model.ts` throws "No OpenRouter API key found…" when `getOpenRouterApiKey()` is empty. The wizard's job is to make sure that never happens on a normal run.
- **Model selection is currently NOT persisted.** `src/providers/prompt-config/index.tsx` initializes `model` from `DEFAULT_CHAT_MODEL_ID` every launch and `setModel` only updates React state — so a chosen model is forgotten on restart and the persisted `settings.json` `model` key is ignored. This plan fixes that (Task 6) so the onboarding model choice actually sticks.
- **`settings.ts` ignores `KNIGHTCODE_HOME`.** It hard-codes `join(homedir(), ".knightcode", …)`, while `paths.ts`/`credentials.ts` honor `KNIGHTCODE_HOME`. Task 1 unifies this so onboarding's settings writes are test-isolatable and land in the same dir as credentials.
- **Settings registry:** `SUPPORTED_SETTINGS` in `settings.ts` already has a `model` key (`{ path: ["model"], type: "string" }`), so `setSettingValue("model", id)` / `getSettingValue("model")` work.
- **Model shortlist:** `@knightcode/shared` exports `MODEL_SHORTLIST` (`{ id, label }[]`), `DEFAULT_CHAT_MODEL_ID`, `findSupportedChatModel(id)`, and `SupportedChatModelId`.
- **Keyboard layers:** `src/providers/keyboard-layer/index.tsx` exposes `push/pop/isTopLayer/hasLayer/setResponder` with a fixed `KeyboardLayerId = "base" | "command" | "dialog" | "mention"`. Overlays gate their key handlers on `isTopLayer(<id>)`. We add an `"onboarding"` layer.
- **Overlay precedent:** `DialogProvider`'s `Dialog` renders a full-screen absolute backdrop (`position="absolute"`, `zIndex={100}`) with a focused `<input>` over the (still-mounted) screen, and it works — the wizard mirrors this pattern. `DialogSearchList` shows the `<input ref> + onContentChange + read inputRef.current.value` + `useKeyboard` up/down/return idiom to copy.
- **Command context** is assembled in `src/components/input-bar.tsx` `handleCommand` and typed by `src/components/command-menu/types.ts` `CommandContext`. Commands live in `src/components/command-menu/commands.tsx`.

---

## File structure

**New (pure logic, fully tested):**

- `src/lib/onboarding/needs-onboarding.ts` — `isOnboardingNeeded(): boolean`.
- `src/lib/onboarding/validate-key.ts` — `validateOpenRouterKey(apiKey, fetchImpl?)` against OpenRouter.
- `src/lib/onboarding/complete.ts` — `completeOnboarding(result)`: persist key + optional search creds + model.
- `src/lib/onboarding/preferred-model.ts` — `loadPreferredModel()`: validated model from settings, else default.
- `src/lib/onboarding/index.ts` — barrel re-export.
- Tests: `needs-onboarding.test.ts`, `validate-key.test.ts`, `complete.test.ts`, `preferred-model.test.ts`.

**New (React, thin):**

- `src/providers/onboarding/index.tsx` — `OnboardingProvider` + `useOnboarding()` (`{ active, start, finish }`).
- `src/components/onboarding/onboarding-wizard.tsx` — the multi-step overlay UI.

**Modified:**

- `src/lib/settings.ts` — use `knightcodeHome()` (Task 1).
- `src/lib/settings.io.test.ts` — **new** isolated round-trip test (Task 1).
- `src/providers/keyboard-layer/index.tsx` — add `"onboarding"` to `KeyboardLayerId` (Task 7).
- `src/providers/prompt-config/index.tsx` — init from + persist to settings (Task 6).
- `src/layouts/root-layout.tsx` — mount `OnboardingProvider` + overlay the wizard (Task 8).
- `src/components/command-menu/types.ts` — add `startOnboarding?: () => void` to `CommandContext` (Task 9).
- `src/components/input-bar.tsx` — wire `startOnboarding` into the command context (Task 9).
- `src/components/command-menu/commands.tsx` — add the `/setup` command (Task 9).

---

## Task 0: Branch

- [ ] **Step 1: Create the branch from `main`**

```bash
git checkout main
git switch -c onboarding
git status   # expect only untracked docs/ etc.; no source changes yet
```

Expected: `Switched to a new branch 'onboarding'`.

---

## Task 1: Make `settings.ts` honor `KNIGHTCODE_HOME`

**Why:** Onboarding writes the chosen model via `setSettingValue("model", …)`. For that to be test-isolatable (and to land in the same config dir as credentials), `settings.ts` must resolve its path through `knightcodeHome()` like `paths.ts`/`credentials.ts` already do.

**Files:**

- Modify: `packages/cli/src/lib/settings.ts`
- Test: `packages/cli/src/lib/settings.io.test.ts` (create)

- [ ] **Step 1: Write the failing isolated round-trip test**

Create `packages/cli/src/lib/settings.io.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getSettingsPath,
  getSettingValue,
  loadSettings,
  saveSettings,
  setSettingValue,
} from "./settings";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-settings-"));
  process.env.KNIGHTCODE_HOME = dir;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("settings io honors KNIGHTCODE_HOME", () => {
  test("settings path is under KNIGHTCODE_HOME", () => {
    expect(getSettingsPath()).toBe(join(dir, "settings.json"));
  });

  test("saveSettings then loadSettings round-trips", () => {
    saveSettings({ model: "z-ai/glm-5.1" });
    expect(loadSettings().model).toBe("z-ai/glm-5.1");
  });

  test("setSettingValue/getSettingValue round-trip the model key", () => {
    setSettingValue("model", "openai/gpt-5.5");
    expect(getSettingValue("model")).toBe("openai/gpt-5.5");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && bun test src/lib/settings.io.test.ts`
Expected: FAIL — `getSettingsPath()` returns a path under the real `homedir()`, not `dir`.

- [ ] **Step 3: Repoint `settings.ts` at `knightcodeHome()`**

In `packages/cli/src/lib/settings.ts`, replace the imports and the two path sites. Final file:

```ts
import { join } from "path";
import { existsSync, readFileSync, writeFileSync, mkdirSync } from "fs";
import { knightcodeHome } from "./paths";

export type SettingsFile = { [key: string]: unknown };

export function getSettingsPath(): string {
  return join(knightcodeHome(), "settings.json");
}

export function loadSettings(): SettingsFile {
  const p = getSettingsPath();
  if (!existsSync(p)) return {};
  try {
    return JSON.parse(readFileSync(p, "utf-8")) as SettingsFile;
  } catch {
    return {};
  }
}

export function saveSettings(settings: SettingsFile): void {
  const dir = knightcodeHome();
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2), "utf-8");
}
```

(Leave `SettingMeta`, `SUPPORTED_SETTINGS`, `isSupportedSetting`, `getSettingMeta`, `getSettingValue`, `setSettingValue` exactly as they are — only the imports and the two path-producing functions change.)

- [ ] **Step 4: Run the new test + the existing settings test**

Run: `cd packages/cli && bun test src/lib/settings.io.test.ts src/lib/settings.test.ts`
Expected: PASS (all).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/settings.ts packages/cli/src/lib/settings.io.test.ts
git commit -m "refactor(cli): resolve settings.json via knightcodeHome (honor KNIGHTCODE_HOME)"
```

---

## Task 2: `isOnboardingNeeded()`

**Files:**

- Create: `packages/cli/src/lib/onboarding/needs-onboarding.ts`
- Test: `packages/cli/src/lib/onboarding/needs-onboarding.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/onboarding/needs-onboarding.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { saveCredentials } from "../credentials";
import { isOnboardingNeeded } from "./needs-onboarding";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-onb-"));
  process.env.KNIGHTCODE_HOME = dir;
  delete process.env.OPENROUTER_API_KEY;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  delete process.env.OPENROUTER_API_KEY;
  rmSync(dir, { recursive: true, force: true });
});

describe("isOnboardingNeeded", () => {
  test("true when no key is resolvable", () => {
    expect(isOnboardingNeeded()).toBe(true);
  });

  test("false when a key is in the credentials file", () => {
    saveCredentials({ openRouterApiKey: "sk-or-abc" });
    expect(isOnboardingNeeded()).toBe(false);
  });

  test("false when the key comes from the environment", () => {
    process.env.OPENROUTER_API_KEY = "sk-or-env";
    expect(isOnboardingNeeded()).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && bun test src/lib/onboarding/needs-onboarding.test.ts`
Expected: FAIL — module `./needs-onboarding` not found.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/onboarding/needs-onboarding.ts`:

```ts
import { getOpenRouterApiKey } from "../credentials";

/**
 * First-run gate: onboarding is needed when no OpenRouter key resolves from the
 * environment or the credentials file. Mirrors resolveModel's key lookup so the
 * wizard runs exactly when inference would otherwise fail for lack of a key.
 */
export function isOnboardingNeeded(): boolean {
  return !getOpenRouterApiKey();
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/cli && bun test src/lib/onboarding/needs-onboarding.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/onboarding/needs-onboarding.ts packages/cli/src/lib/onboarding/needs-onboarding.test.ts
git commit -m "feat(cli): isOnboardingNeeded — first-run key gate"
```

---

## Task 3: `validateOpenRouterKey()`

**Why:** The wizard validates the pasted key against OpenRouter's `GET /api/v1/key` endpoint (returns 200 for a good key, 401/403 for a bad one) so users get immediate feedback instead of a cryptic failure on their first message. `fetchImpl` is injected for testing.

**Files:**

- Create: `packages/cli/src/lib/onboarding/validate-key.ts`
- Test: `packages/cli/src/lib/onboarding/validate-key.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/onboarding/validate-key.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { validateOpenRouterKey } from "./validate-key";

describe("validateOpenRouterKey", () => {
  test("200 response → valid, and sends a Bearer auth header", async () => {
    let sentAuth: string | null = null;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      sentAuth = new Headers(init?.headers).get("Authorization");
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await validateOpenRouterKey("sk-or-good", fetchImpl);
    expect(result.status).toBe("valid");
    expect(sentAuth).toBe("Bearer sk-or-good");
  });

  test("401 → invalid", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 401 })) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-bad", fetchImpl);
    expect(result.status).toBe("invalid");
  });

  test("500 → error mentioning the status", async () => {
    const fetchImpl = (async () =>
      new Response("", { status: 500 })) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-x", fetchImpl);
    expect(result.status).toBe("error");
    expect(result.message).toContain("500");
  });

  test("network throw → error", async () => {
    const fetchImpl = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("sk-or-x", fetchImpl);
    expect(result.status).toBe("error");
    expect(result.message).toContain("ECONNREFUSED");
  });

  test("empty/whitespace key → invalid without calling fetch", async () => {
    let called = false;
    const fetchImpl = (async () => {
      called = true;
      return new Response("", { status: 200 });
    }) as unknown as typeof fetch;
    const result = await validateOpenRouterKey("   ", fetchImpl);
    expect(result.status).toBe("invalid");
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && bun test src/lib/onboarding/validate-key.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/onboarding/validate-key.ts`:

```ts
const KEY_ENDPOINT = "https://openrouter.ai/api/v1/key";
const TIMEOUT_MS = 10_000;

export type KeyValidationStatus = "valid" | "invalid" | "error";

export interface KeyValidationResult {
  status: KeyValidationStatus;
  /** Human-readable reason for "invalid"/"error"; absent for "valid". */
  message?: string;
}

/**
 * Check an OpenRouter key against GET /api/v1/key.
 *  - "valid":   HTTP 200 (key accepted).
 *  - "invalid": HTTP 401/403 (key rejected) or an empty key.
 *  - "error":   any other status or a network failure — the caller may let the
 *               user proceed anyway (e.g. offline), since this is advisory.
 * `fetchImpl` is injectable for tests; defaults to the global fetch.
 */
export async function validateOpenRouterKey(
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<KeyValidationResult> {
  if (!apiKey.trim()) {
    return { status: "invalid", message: "API key is empty." };
  }

  let response: Response;
  try {
    response = await fetchImpl(KEY_ENDPOINT, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    return {
      status: "error",
      message: err instanceof Error ? err.message : String(err),
    };
  }

  if (response.ok) return { status: "valid" };
  if (response.status === 401 || response.status === 403) {
    return { status: "invalid", message: "OpenRouter rejected this key." };
  }
  return {
    status: "error",
    message: `OpenRouter returned HTTP ${response.status}.`,
  };
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/cli && bun test src/lib/onboarding/validate-key.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/onboarding/validate-key.ts packages/cli/src/lib/onboarding/validate-key.test.ts
git commit -m "feat(cli): validateOpenRouterKey against /api/v1/key"
```

---

## Task 4: `completeOnboarding()` + barrel

**Why:** Single persistence seam so the wizard never touches `saveCredentials`/`setSettingValue` directly. Writes the key (+ optional search creds) to `credentials.json` and the chosen model to `settings.json`.

**Files:**

- Create: `packages/cli/src/lib/onboarding/complete.ts`
- Create: `packages/cli/src/lib/onboarding/index.ts`
- Test: `packages/cli/src/lib/onboarding/complete.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/onboarding/complete.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  getOpenRouterApiKey,
  getSearchApiKey,
  getSearchProvider,
} from "../credentials";
import { getSettingValue } from "../settings";
import { completeOnboarding } from "./complete";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-onb-complete-"));
  process.env.KNIGHTCODE_HOME = dir;
  delete process.env.OPENROUTER_API_KEY;
  delete process.env.KNIGHTCODE_SEARCH_PROVIDER;
  delete process.env.KNIGHTCODE_SEARCH_API_KEY;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("completeOnboarding", () => {
  test("persists the key and model, no search by default", () => {
    completeOnboarding({
      openRouterApiKey: "sk-or-abc",
      model: "z-ai/glm-5.1",
    });
    expect(getOpenRouterApiKey()).toBe("sk-or-abc");
    expect(getSettingValue("model")).toBe("z-ai/glm-5.1");
    expect(getSearchProvider()).toBeUndefined();
    expect(getSearchApiKey()).toBeUndefined();
  });

  test("persists the optional search provider + key", () => {
    completeOnboarding({
      openRouterApiKey: "sk-or-abc",
      model: "openai/gpt-5.5",
      search: { provider: "brave", apiKey: "brave-key" },
    });
    expect(getSearchProvider()).toBe("brave");
    expect(getSearchApiKey()).toBe("brave-key");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && bun test src/lib/onboarding/complete.test.ts`
Expected: FAIL — module `./complete` not found.

- [ ] **Step 3: Implement `complete.ts`**

Create `packages/cli/src/lib/onboarding/complete.ts`:

```ts
import type { SupportedChatModelId } from "@knightcode/shared";
import { saveCredentials, type SearchProvider } from "../credentials";
import { setSettingValue } from "../settings";

export interface OnboardingSearchConfig {
  provider: SearchProvider;
  apiKey: string;
}

export interface OnboardingResult {
  openRouterApiKey: string;
  model: SupportedChatModelId;
  /** Optional BYO-key web search; omitted = WebSearch stays "not configured". */
  search?: OnboardingSearchConfig;
}

/**
 * Persist the wizard's result: secrets (OpenRouter key + optional search creds)
 * to credentials.json (0600), and the chosen default model to settings.json.
 */
export function completeOnboarding(result: OnboardingResult): void {
  saveCredentials({
    openRouterApiKey: result.openRouterApiKey,
    ...(result.search
      ? {
          searchProvider: result.search.provider,
          searchApiKey: result.search.apiKey,
        }
      : {}),
  });
  setSettingValue("model", result.model);
}
```

- [ ] **Step 4: Create the barrel `index.ts`**

Create `packages/cli/src/lib/onboarding/index.ts`:

```ts
export { isOnboardingNeeded } from "./needs-onboarding";
export {
  validateOpenRouterKey,
  type KeyValidationResult,
  type KeyValidationStatus,
} from "./validate-key";
export {
  completeOnboarding,
  type OnboardingResult,
  type OnboardingSearchConfig,
} from "./complete";
export { loadPreferredModel } from "./preferred-model";
```

> Note: `./preferred-model` is created in Task 5. If you run the barrel through `check-types` before Task 5, that import will fail — that's expected; the two tasks land together in the squashed phase commit. (If executing strictly task-by-task, you may temporarily omit the `loadPreferredModel` line and add it in Task 5.)

- [ ] **Step 5: Run it and watch it pass**

Run: `cd packages/cli && bun test src/lib/onboarding/complete.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 6: Commit**

```bash
git add packages/cli/src/lib/onboarding/complete.ts packages/cli/src/lib/onboarding/complete.test.ts packages/cli/src/lib/onboarding/index.ts
git commit -m "feat(cli): completeOnboarding persists key, search creds, model"
```

---

## Task 5: `loadPreferredModel()`

**Why:** Onboarding writes `settings.model`, but nothing reads it yet. This pure helper resolves the persisted model (validated against the shortlist) or falls back to the default; Task 6 wires it into `PromptConfigProvider`.

**Files:**

- Create: `packages/cli/src/lib/onboarding/preferred-model.ts`
- Test: `packages/cli/src/lib/onboarding/preferred-model.test.ts`

- [ ] **Step 1: Write the failing test**

Create `packages/cli/src/lib/onboarding/preferred-model.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_CHAT_MODEL_ID } from "@knightcode/shared";
import { setSettingValue } from "../settings";
import { loadPreferredModel } from "./preferred-model";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "kc-pref-model-"));
  process.env.KNIGHTCODE_HOME = dir;
});

afterEach(() => {
  delete process.env.KNIGHTCODE_HOME;
  rmSync(dir, { recursive: true, force: true });
});

describe("loadPreferredModel", () => {
  test("defaults when nothing is stored", () => {
    expect(loadPreferredModel()).toBe(DEFAULT_CHAT_MODEL_ID);
  });

  test("returns a stored, supported model id", () => {
    setSettingValue("model", "openai/gpt-5.5");
    expect(loadPreferredModel()).toBe("openai/gpt-5.5");
  });

  test("ignores an unsupported stored value and falls back to default", () => {
    setSettingValue("model", "totally/made-up");
    expect(loadPreferredModel()).toBe(DEFAULT_CHAT_MODEL_ID);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/cli && bun test src/lib/onboarding/preferred-model.test.ts`
Expected: FAIL — module `./preferred-model` not found.

- [ ] **Step 3: Implement**

Create `packages/cli/src/lib/onboarding/preferred-model.ts`:

```ts
import {
  DEFAULT_CHAT_MODEL_ID,
  findSupportedChatModel,
  type SupportedChatModelId,
} from "@knightcode/shared";
import { getSettingValue } from "../settings";

/**
 * The model the prompt config should start on: the persisted settings.json
 * `model`, but only if it's a known supported id (guards against a stale or
 * hand-edited value); otherwise the curated default.
 */
export function loadPreferredModel(): SupportedChatModelId {
  const stored = getSettingValue("model");
  if (typeof stored === "string" && findSupportedChatModel(stored)) {
    return stored as SupportedChatModelId;
  }
  return DEFAULT_CHAT_MODEL_ID;
}
```

- [ ] **Step 4: Run it and watch it pass**

Run: `cd packages/cli && bun test src/lib/onboarding/preferred-model.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/lib/onboarding/preferred-model.ts packages/cli/src/lib/onboarding/preferred-model.test.ts
git commit -m "feat(cli): loadPreferredModel resolves persisted model"
```

---

## Task 6: Make `PromptConfigProvider` initialize from + persist the model

**Why:** Without this, the model the user picks during onboarding (and via `/models`) is forgotten on restart. Initialize state from `loadPreferredModel()` and persist on every `setModel`.

**Files:**

- Modify: `packages/cli/src/providers/prompt-config/index.tsx`

- [ ] **Step 1: Update the imports**

In `packages/cli/src/providers/prompt-config/index.tsx`, replace the `@knightcode/shared` import block (it currently imports `DEFAULT_CHAT_MODEL_ID`) and add the lib imports:

```ts
import {
  Mode,
  type ModeType,
  type ReasoningEffortLevel,
  type SupportedChatModelId,
} from "@knightcode/shared";
import { loadPreferredModel } from "../../lib/onboarding";
import { setSettingValue } from "../../lib/settings";
import type { ReactNode } from "react";
import { createContext, useCallback, useContext, useState } from "react";
```

- [ ] **Step 2: Initialize `model` from settings and persist on change**

Replace the `model` state declaration and add a persisting setter. Change:

```ts
const [model, setModel] = useState<SupportedChatModelId>(DEFAULT_CHAT_MODEL_ID);
```

to:

```ts
const [model, setModelState] = useState<SupportedChatModelId>(() =>
  loadPreferredModel(),
);
const setModel = useCallback((next: SupportedChatModelId) => {
  setModelState(next);
  try {
    setSettingValue("model", next);
  } catch {
    // Persisting the preference is best-effort; a read-only home dir must not
    // break in-session model switching.
  }
}, []);
```

(The provider value already passes `model` and `setModel` — no change needed there. `setModel` keeps the same `(model: SupportedChatModelId) => void` signature, so `usePromptConfig` consumers and `CommandContext.setModel` are unaffected.)

- [ ] **Step 3: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: `$ tsc --noEmit` with exit 0 (no errors).

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/providers/prompt-config/index.tsx
git commit -m "feat(cli): persist + restore selected model via settings"
```

---

## Task 7: `OnboardingProvider` + `useOnboarding()` + `"onboarding"` keyboard layer

**Why:** A small context holds whether the wizard is showing. `active` starts as `isOnboardingNeeded()` (first run). `start()` re-opens it for `/setup`; `finish()` closes it. We also register an `"onboarding"` keyboard layer id so the wizard can sit on top of the layer stack and suppress the underlying input.

**Files:**

- Modify: `packages/cli/src/providers/keyboard-layer/index.tsx`
- Create: `packages/cli/src/providers/onboarding/index.tsx`

- [ ] **Step 1: Add the `"onboarding"` layer id**

In `packages/cli/src/providers/keyboard-layer/index.tsx`, change:

```ts
export type KeyboardLayerId = "base" | "command" | "dialog" | "mention";
```

to:

```ts
export type KeyboardLayerId =
  | "base"
  | "command"
  | "dialog"
  | "mention"
  | "onboarding";
```

- [ ] **Step 2: Create the provider**

Create `packages/cli/src/providers/onboarding/index.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { isOnboardingNeeded } from "../../lib/onboarding";

type OnboardingContextValue = {
  /** Whether the wizard overlay should be shown. */
  active: boolean;
  /** Open the wizard (re-run via /setup). */
  start: () => void;
  /** Close the wizard (called after a successful run or on cancel). */
  finish: () => void;
};

const OnboardingContext = createContext<OnboardingContextValue | null>(null);

export function useOnboarding(): OnboardingContextValue {
  const value = useContext(OnboardingContext);
  if (!value) {
    throw new Error("useOnboarding must be used within an OnboardingProvider");
  }
  return value;
}

export function OnboardingProvider({ children }: { children: ReactNode }) {
  // Evaluated once at mount: first run (no resolvable key) shows the wizard.
  const [active, setActive] = useState<boolean>(() => isOnboardingNeeded());

  const start = useCallback(() => setActive(true), []);
  const finish = useCallback(() => setActive(false), []);

  const value = useMemo(
    () => ({ active, start, finish }),
    [active, start, finish],
  );

  return (
    <OnboardingContext.Provider value={value}>
      {children}
    </OnboardingContext.Provider>
  );
}
```

- [ ] **Step 3: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: exit 0. (The provider isn't mounted yet — that's Task 8 — but it must compile.)

- [ ] **Step 4: Commit**

```bash
git add packages/cli/src/providers/keyboard-layer/index.tsx packages/cli/src/providers/onboarding/index.tsx
git commit -m "feat(cli): OnboardingProvider + onboarding keyboard layer"
```

---

## Task 8: `OnboardingWizard` component + mount the overlay

**Why:** The actual UI. A self-contained, absolutely-positioned overlay (dialog pattern) that walks: key entry → validate → model pick → optional search provider → optional search key → persist. On success it calls `completeOnboarding`, syncs the live `setModel`, and `finish()`es.

This component is UI orchestration over the already-tested lib functions; verify it by `check-types` + the manual smoke checklist in Task 10 (TUI components are not unit-tested elsewhere in this codebase). Keep all branching logic delegating to the tested helpers — do not put new persistence or validation logic here.

**Files:**

- Create: `packages/cli/src/components/onboarding/onboarding-wizard.tsx`
- Modify: `packages/cli/src/layouts/root-layout.tsx`

- [ ] **Step 1: Create the wizard**

Create `packages/cli/src/components/onboarding/onboarding-wizard.tsx`:

```tsx
import { MODEL_SHORTLIST, type SupportedChatModelId } from "@knightcode/shared";
import { RGBA, TextAttributes, type InputRenderable } from "@opentui/core";
import { useKeyboard, useTerminalDimensions } from "@opentui/react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  completeOnboarding,
  validateOpenRouterKey,
  type OnboardingSearchConfig,
} from "../../lib/onboarding";
import type { SearchProvider } from "../../lib/credentials";
import { useKeyboardLayer } from "../../providers/keyboard-layer";
import { usePromptConfig } from "../../providers/prompt-config";
import { useTheme } from "../../providers/theme";
import { useToast } from "../../providers/toast";

type Step = "key" | "validating" | "model" | "search-provider" | "search-key";

type ProviderChoice = { label: string; value: SearchProvider | "skip" };

const PROVIDER_CHOICES: ProviderChoice[] = [
  { label: "Skip — I'll add web search later", value: "skip" },
  { label: "Brave Search", value: "brave" },
  { label: "Tavily", value: "tavily" },
];

export function OnboardingWizard({ onDone }: { onDone: () => void }) {
  const dimensions = useTerminalDimensions();
  const { colors } = useTheme();
  const toast = useToast();
  const { setModel } = usePromptConfig();
  const { push, pop, isTopLayer } = useKeyboardLayer();

  const [step, setStep] = useState<Step>("key");
  const [apiKey, setApiKey] = useState("");
  const [model, setModelChoice] = useState<SupportedChatModelId | null>(null);
  const [provider, setProvider] = useState<SearchProvider | null>(null);
  const [modelIndex, setModelIndex] = useState(0);
  const [providerIndex, setProviderIndex] = useState(0);

  const keyInputRef = useRef<InputRenderable>(null);
  const searchKeyInputRef = useRef<InputRenderable>(null);

  // Own the top keyboard layer for the wizard's whole lifetime.
  useEffect(() => {
    push("onboarding");
    return () => pop("onboarding");
  }, [push, pop]);

  const persistAndFinish = useCallback(
    (search?: OnboardingSearchConfig) => {
      if (!model) return; // unreachable: model is set before this point
      completeOnboarding({ openRouterApiKey: apiKey, model, search });
      setModel(model);
      toast.show({ variant: "success", message: "KnightCode is configured." });
      onDone();
    },
    [apiKey, model, (search) => search, setModel, toast, onDone],
  );

  const submitKey = useCallback(async () => {
    const value = keyInputRef.current?.value ?? "";
    setApiKey(value);
    setStep("validating");
    const result = await validateOpenRouterKey(value);
    if (result.status === "valid") {
      setStep("model");
      return;
    }
    if (result.status === "invalid") {
      toast.show({
        variant: "error",
        message: result.message ?? "That key was rejected. Try again.",
      });
      setStep("key");
      return;
    }
    // "error" (network / non-auth status): advisory only — let the user proceed.
    toast.show({
      variant: "info",
      message: `Couldn't reach OpenRouter (${result.message ?? "network error"}). Using the key anyway.`,
    });
    setStep("model");
  }, [toast]);

  useKeyboard((key) => {
    if (!isTopLayer("onboarding")) return;
    const isEnter = key.name === "return" || key.name === "enter";

    if (step === "key") {
      if (isEnter) void submitKey();
      return;
    }
    if (step === "validating") return;

    if (step === "model") {
      if (key.name === "up") setModelIndex((i) => Math.max(0, i - 1));
      else if (key.name === "down")
        setModelIndex((i) => Math.min(MODEL_SHORTLIST.length - 1, i + 1));
      else if (isEnter) {
        const chosen = MODEL_SHORTLIST[modelIndex]!;
        setModelChoice(chosen.id);
        setStep("search-provider");
      }
      return;
    }

    if (step === "search-provider") {
      if (key.name === "up") setProviderIndex((i) => Math.max(0, i - 1));
      else if (key.name === "down")
        setProviderIndex((i) => Math.min(PROVIDER_CHOICES.length - 1, i + 1));
      else if (isEnter) {
        const choice = PROVIDER_CHOICES[providerIndex]!;
        if (choice.value === "skip") {
          persistAndFinish();
        } else {
          setProvider(choice.value);
          setStep("search-key");
        }
      }
      return;
    }

    if (step === "search-key") {
      if (isEnter) {
        const value = searchKeyInputRef.current?.value?.trim() ?? "";
        if (value && provider) {
          persistAndFinish({ provider, apiKey: value });
        } else {
          // Empty key → treat as skip rather than persisting a blank search key.
          persistAndFinish();
        }
      }
    }
  });

  return (
    <box
      position="absolute"
      left={0}
      top={0}
      width={dimensions.width}
      height={dimensions.height}
      justifyContent="center"
      alignItems="center"
      backgroundColor={RGBA.fromInts(0, 0, 0, 180)}
      zIndex={200}
    >
      <box
        width={Math.min(72, dimensions.width - 4)}
        height="auto"
        backgroundColor={colors.dialogSurface}
        paddingX={4}
        paddingY={2}
        flexDirection="column"
        gap={1}
      >
        <text attributes={TextAttributes.BOLD}>Welcome to KnightCode</text>

        {step === "key" && (
          <box flexDirection="column" gap={1}>
            <text>
              Paste your OpenRouter API key (from openrouter.ai/keys). Press
              Enter to continue.
            </text>
            <input ref={keyInputRef} placeholder="sk-or-..." focused />
          </box>
        )}

        {step === "validating" && <text>Validating key…</text>}

        {step === "model" && (
          <box flexDirection="column" gap={1}>
            <text>Pick a default model (↑/↓, Enter):</text>
            {MODEL_SHORTLIST.map((entry, i) => (
              <text
                key={entry.id}
                backgroundColor={
                  i === modelIndex ? colors.selection : undefined
                }
              >
                {i === modelIndex ? "› " : "  "}
                {entry.label}
              </text>
            ))}
          </box>
        )}

        {step === "search-provider" && (
          <box flexDirection="column" gap={1}>
            <text>Add web search? (optional — ↑/↓, Enter):</text>
            {PROVIDER_CHOICES.map((choice, i) => (
              <text
                key={choice.value}
                backgroundColor={
                  i === providerIndex ? colors.selection : undefined
                }
              >
                {i === providerIndex ? "› " : "  "}
                {choice.label}
              </text>
            ))}
          </box>
        )}

        {step === "search-key" && (
          <box flexDirection="column" gap={1}>
            <text>
              Paste your {provider} API key (Enter to finish, empty to skip):
            </text>
            <input ref={searchKeyInputRef} placeholder="search key" focused />
          </box>
        )}
      </box>
    </box>
  );
}
```

> Implementer notes:
>
> - `useCallback` is imported from `react` (the snippet's `import { useCallback, ... } from "react"` — correct the casing to `useCallback`, `useEffect`, `useRef`, `useState`; React hooks are camelCase). **Fix the import line to:** `import { useCallback, useEffect, useRef, useState } from "react";`
> - In `persistAndFinish`'s dependency array, drop the bogus `search => search` entry — the correct deps are `[apiKey, model, setModel, toast, onDone]`. (`search` is a parameter, not a dependency.)
> - If TypeScript complains that `InputRenderable.value` may be `undefined`, the `?? ""` guards already cover it.
> - Do not render or toast the key value anywhere.

- [ ] **Step 2: Verify the wizard compiles in isolation**

Run: `cd packages/cli && bun run check-types`
Expected: exit 0. Fix any casing/dependency-array issues flagged above until clean.

- [ ] **Step 3: Mount the overlay in `root-layout.tsx`**

In `packages/cli/src/layouts/root-layout.tsx`, wrap the routed content with the onboarding provider and overlay the wizard when active. Replace the whole file with:

```tsx
import { Outlet } from "react-router";
import { DialogProvider } from "../providers/dialogs";
import { KeyboardLayerProvider } from "../providers/keyboard-layer";
import { OnboardingProvider, useOnboarding } from "../providers/onboarding";
import { PromptConfigProvider } from "../providers/prompt-config";
import { ThemeProvider } from "../providers/theme";
import { ToastProvider } from "../providers/toast";
import { TodoProvider } from "../providers/todo";
import { OnboardingWizard } from "../components/onboarding/onboarding-wizard";
import { ThemedRoot } from "./themed-root";

function RoutedContent() {
  const { active, finish } = useOnboarding();
  return (
    <>
      <Outlet />
      {active && <OnboardingWizard onDone={finish} />}
    </>
  );
}

export function RootLayout() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <KeyboardLayerProvider>
          <DialogProvider>
            <PromptConfigProvider>
              <TodoProvider>
                <OnboardingProvider>
                  <ThemedRoot>
                    <RoutedContent />
                  </ThemedRoot>
                </OnboardingProvider>
              </TodoProvider>
            </PromptConfigProvider>
          </DialogProvider>
        </KeyboardLayerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
```

(`OnboardingProvider` sits inside `PromptConfigProvider` so the wizard's `usePromptConfig().setModel` works, and inside `ToastProvider`/`KeyboardLayerProvider` so toasts and the layer stack are available.)

- [ ] **Step 4: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/components/onboarding/onboarding-wizard.tsx packages/cli/src/layouts/root-layout.tsx
git commit -m "feat(cli): onboarding wizard overlay + first-run gate"
```

---

## Task 9: `/setup` command (re-run path)

**Why:** Spec §6.8 requires a later-change path. `/setup` re-opens the wizard so users can change their key/model/search after first run.

**Files:**

- Modify: `packages/cli/src/components/command-menu/types.ts`
- Modify: `packages/cli/src/components/input-bar.tsx`
- Modify: `packages/cli/src/components/command-menu/commands.tsx`

- [ ] **Step 1: Add `startOnboarding` to `CommandContext`**

In `packages/cli/src/components/command-menu/types.ts`, add one field to the `CommandContext` type (place it near `setModel`):

```ts
  /** Re-open the onboarding wizard (/setup). */
  startOnboarding?: () => void;
```

- [ ] **Step 2: Provide it from `input-bar.tsx`**

In `packages/cli/src/components/input-bar.tsx`:

a) Add the import near the other provider hook imports (e.g. just after the `usePromptConfig` import line):

```ts
import { useOnboarding } from "../providers/onboarding";
```

b) Inside the component body, near the other hook calls (e.g. just after `const dialog = useDialog();`), add:

```ts
const { start: startOnboarding } = useOnboarding();
```

c) In `handleCommand`, add `startOnboarding` to the object passed to `command.action({ … })` (alongside `setModel`), and add `startOnboarding` to that `useCallback`'s dependency array.

- [ ] **Step 3: Register the `/setup` command**

In `packages/cli/src/components/command-menu/commands.tsx`, add this entry to the `COMMANDS` array (place it after the `models` command for discoverability):

```tsx
  {
    name: "setup",
    description: "Re-run first-run setup (API key, model, web search)",
    value: "/setup",
    action: (ctx) => {
      if (!ctx.startOnboarding) {
        ctx.toast.show({ variant: "error", message: "Not available here" });
        return;
      }
      ctx.startOnboarding();
    },
  },
```

- [ ] **Step 4: Type-check**

Run: `cd packages/cli && bun run check-types`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add packages/cli/src/components/command-menu/types.ts packages/cli/src/components/input-bar.tsx packages/cli/src/components/command-menu/commands.tsx
git commit -m "feat(cli): /setup command re-runs onboarding"
```

---

## Task 10: Full validation, manual smoke, and squash

- [ ] **Step 1: Type-check + full test run**

```bash
cd packages/cli && bun run check-types && bun test
cd ../shared && bun test
```

Expected: `tsc --noEmit` exit 0; CLI suite all pass (existing + the new onboarding tests, ~13 added across 5 files); shared suite all pass.

- [ ] **Step 2: Manual smoke test (first run)**

```bash
# Use a throwaway home so your real config is untouched.
# PowerShell:  $env:KNIGHTCODE_HOME = "$env:TEMP\kc-smoke"; $env:OPENROUTER_API_KEY=""
# bash:        export KNIGHTCODE_HOME=/tmp/kc-smoke OPENROUTER_API_KEY=
cd packages/cli && bun run dev   # or the package's start script
```

Verify, in order:

- The wizard appears immediately (no chat reachable behind it).
- Typing a key + Enter shows "Validating key…", then advances to the model list (valid key) or toasts an error and stays (bad key).
- ↑/↓ moves the model highlight; Enter advances to the search step.
- "Skip" finishes; "Brave"/"Tavily" advances to a key field; an empty search key + Enter finishes without configuring search.
- After finishing: a success toast, the wizard closes, the input bar is usable, and the status bar shows the chosen model.
- `cat $KNIGHTCODE_HOME/credentials.json` shows the key (and search creds if added) and is `0600` on POSIX; `cat $KNIGHTCODE_HOME/settings.json` shows the chosen `model`.

- [ ] **Step 3: Manual smoke test (subsequent run + /setup)**

- Relaunch with the same `KNIGHTCODE_HOME` (key now present): the wizard does **not** appear; you land in the normal UI on the persisted model.
- Run `/setup`: the wizard re-opens over the current screen; completing it updates the model live.

- [ ] **Step 4: Squash to a single phase commit**

First confirm the branch is not yet published (no force-push risk):

```bash
git ls-remote --heads origin onboarding   # expect empty output
git rev-parse --abbrev-ref --symbolic-full-name @{u} 2>/dev/null || echo "no upstream"
```

If both confirm the branch is local-only, squash:

```bash
git reset --soft main
git status   # verify ONLY source files under packages/ are staged — NO docs/, .claude/, codex/, opencode/, KNIGHTCODE.md
git commit -m "feat(cli): first-run onboarding wizard (key, model, optional search) + /setup"
```

- [ ] **Step 5: Stop — hand off to the user**

Do **not** push and do **not** open a PR. Report the single commit hash and the validation results. The user pushes and opens the PR. Any review feedback after that is a **new commit** (no force-push).

---

## Self-review (run by the plan author, against the spec)

**Spec coverage (§6.7, §6.8, §6.2, §6.5):**

- "First run (no key resolvable) launches a wizard" → Task 2 (`isOnboardingNeeded`) + Task 7 (`active` init) + Task 8 (overlay). ✅
- "prompt for OpenRouter key → validate against OpenRouter" → Task 3 + Task 8 key step. ✅
- "pick a default model from the shortlist" → Task 8 model step over `MODEL_SHORTLIST`; persisted via Task 4 + actually applied via Tasks 5–6. ✅
- "optionally add a search provider + key" → Task 8 search steps + Task 4 persistence (`searchProvider`/`searchApiKey`). ✅
- "write … config" → `completeOnboarding` writes credentials.json (0600) + settings.json. ✅
- "Subsequent runs skip straight to the session UI" → `active` starts false when a key resolves. ✅
- "re-run path … lets users change these later" → Task 9 `/setup`. ✅
- "Secrets are 0600 and never written to session storage or logs" → reuses `saveCredentials` (0600); wizard never toasts/logs the key. ✅
- "Precedence: env vars win" → `getOpenRouterApiKey()` checks env first, so `OPENROUTER_API_KEY` skips onboarding. ✅

**Placeholder scan:** No TBD/TODO; every code step shows full code; the wizard's two known authoring pitfalls (hook import casing, stray dep-array entry) are called out with the exact fix.

**Type consistency:** `isOnboardingNeeded(): boolean`, `validateOpenRouterKey(apiKey, fetchImpl?) → KeyValidationResult{status,message?}`, `completeOnboarding(OnboardingResult{openRouterApiKey, model, search?})`, `OnboardingSearchConfig{provider: SearchProvider, apiKey}`, `loadPreferredModel(): SupportedChatModelId`, `useOnboarding() → {active, start, finish}`, `CommandContext.startOnboarding?: () => void` — names/shapes are used identically across Tasks 2–9. `setModel` keeps its existing `(model: SupportedChatModelId) => void` signature (Task 6), so no consumer breaks.

**Known scope note:** `loadPreferredModel` validates against the shortlist, so a free-form (non-shortlist) model hand-written into settings.json falls back to the default rather than being honored at startup. Free-form override at the settings/startup layer is out of v1 onboarding scope (the in-app `/models` switcher and config remain the override path); flagged here so a reviewer doesn't treat it as a regression.
