# Part 1: The UI, against the fake backend

Spec sections: 5, 6 (memory views), 7 (computer pane), 9, 11, 12, 15, 16,
18 to 22. Every screen runs on `createFakeBackend` from Task 0.4. No backend
code is written in this part.

Shared pattern for every screen task below:

- Playwright specs live in `apps/bots/web/e2e/`. Project `ui` checks
  behaviour and keeps committed baselines of KnightCode's own screens.
  Project `reference` compares each screen with the reference captures:
  every element with a `data-ref` attribute must match the measured box
  within 1 px and the measured colour, font size, weight, line height,
  radius and shadow exactly. A full screenshot taken with `loadSeed` on the
  reference seed must differ in at most 0.5% of pixels, with avatars masked.
- "Run reference" means: `bunx playwright test --project reference --grep <screen>`
  in `apps/bots/web`, then fix and rerun until it passes. Avatars are
  compared by eye against `screens/*.png`, since KnightCode draws its own.

### Task 1.1: Measure the reference app

**Files:**
- Create: `apps/bots/scripts/measure-reference.ts`,
  `packages/bots-ui/src/tokens/tokens.ts`
- Outside the repo: `C:\Users\Raghav\kc-worktrees\kc-bots-reference\`
  `capture.json`, `screens/`, `measurements/`, `seed.json`

**Interfaces:**
- Produces: `measurements/<screen>.json` shaped
  `{ screen, viewport: { width, height }, elements: [{ ref, box: { x, y, width, height }, styles: { color, background, fontFamily, fontSize, fontWeight, lineHeight, borderRadius, boxShadow, padding, gap } }] }`;
  `tokens.ts` exporting `colors`, `space`, `radii`, `fontSizes`,
  `fontWeights`, `lineHeights`, `shadows`, `durations`, `easings` for light
  and dark themes (values only); the open font chosen to match.
- Screens (ids used by every later task): `shell`, `chat`, `chat-streaming`,
  `composer-mention`, `card-question`, `card-approval`, `card-takeover`,
  `bot-create`, `templates`, `bot-settings`, `memory`, `computer`,
  `computer-takeover`, `teach`, `catalog`, `connector`, `skills`,
  `routines`, `routine-edit`, `activity`, `usage`, `pages`, `page`,
  `inbox`, `catch-up`, `group`, `settings-account`, `settings-approvals`,
  `settings-vault`, `settings-payments`, `settings-channels`,
  `settings-billing`, `onboarding`.

- [x] **Step 1: Read the reference notes**

Read `C:\Users\Raghav\kc-worktrees\kc-bots-reference\reference.md`.
Expected: you know the app, how to launch it, and the measure-only rule.

- [x] **Step 2: Write `measure-reference.ts`**

`measureReference({ cdpUrl: string; capture: string; out: string }): Promise<void>`:
connect with Playwright `chromium.connectOverCDP`, run each screen's
navigation steps from `capture.json` (clicks and key presses on the running
app), then write a PNG and a measurements file per screen for each listed
viewport (1440x900 and 1280x800). It reads computed styles and boxes from
the live DOM only and never reads the app's files.

- [x] **Step 3: Capture every screen**

Quit any running instance first (the app is single-instance, so a second
launch only focuses the first and ignores the flag). Launch the reference
app with the debugging port, write `capture.json` with
navigation steps and a `ref` name per measured element for every screen id
above, then run the script.
Expected: one PNG and one JSON per screen and viewport in the reference
folder; light and dark captures where the app has both.

- [x] **Step 4: Derive tokens and the reference seed**

Write `tokens.ts` from the measured values, and `seed.json` with the same
bot names, avatars, messages and items visible in the captures.
Expected: every colour, size and duration in the measurements maps to a
token.

- [x] **Step 5: Commit**

```bash
git add apps/bots/scripts/measure-reference.ts packages/bots-ui/src/tokens/tokens.ts
git commit -m "feat(bots): add UI measurement tooling and design tokens"
```

### Task 1.2: UI foundation: theme, fonts, avatars, primitives

**Files:**
- Create: `packages/bots-ui/package.json`, `src/index.ts`,
  `src/tokens/css.ts` (generates `tokens.css`), `src/avatar/shapes.ts`,
  `src/avatar/BotAvatarView.tsx`, `src/primitives/*.tsx` (Button,
  IconButton, Menu, Dialog, Popover, Tooltip, Toggle, Tabs, Card, Badge,
  Input, Textarea, Select, Skeleton, Toast)
- Create: `apps/bots/web/package.json`, `vite.config.ts`, `index.html`,
  `src/main.tsx`, `src/client.ts`, `playwright.config.ts`,
  `e2e/reference/compare.ts`
- Test: `packages/bots-ui/test/avatar.test.ts`, `apps/bots/web/e2e/gallery.e2e.ts`

**Interfaces:**
- Consumes: `AVATAR_SHAPES`, `AvatarSchema`; `tokens.ts`.
- Produces: `BotAvatarView({ shape, color, state, size }): JSX.Element`
  (state `idle | working | sleeping`), built on `bot-avatars` with
  `SHAPE_OUTLINES: Record<AvatarShape, { type: BotAvatarType; path?: string }>`
  (stock types where one matches, KnightCode-drawn SVG outlines for the
  rest); primitives on radix-ui; `compareToReference(page, screen)` in
  `e2e/reference/compare.ts` implementing the shared pattern; the web app
  booting `BotsApp` with the fake backend when `VITE_FAKE=1`.

- [x] **Step 1: Write the failing tests**

```ts
// packages/bots-ui/test/avatar.test.ts
import { AVATAR_SHAPES } from "@knightcode/bots-protocol";
import { expect, it } from "vitest";
import { SHAPE_OUTLINES } from "../src/avatar/shapes.ts";

it("draws every avatar shape", () => {
	for (const shape of AVATAR_SHAPES) expect(SHAPE_OUTLINES[shape], shape).toBeDefined();
});
```

```ts
// apps/bots/web/e2e/gallery.e2e.ts
import { expect, test } from "@playwright/test";
test("primitives gallery renders", async ({ page }) => {
	await page.goto("/__gallery");
	await expect(page.getByRole("button", { name: "Primary" })).toBeVisible();
	await expect(page).toHaveScreenshot("gallery.png");
});
```

- [x] **Step 2: Run them to verify they fail**

Run: `bunx vitest --run` in `packages/bots-ui`; `bunx playwright test --project ui gallery` in `apps/bots/web`
Expected: FAIL.

- [x] **Step 3: Implement the foundation in the listed files**

A gallery route (`/__gallery`, dev only) shows every primitive and avatar.
`packages/bots-ui` uses JSX and DOM types, which the root `tsc` (module
NodeNext, no DOM) cannot check: give it its own `tsconfig.json` (as
`apps/remote/web` has), add `"packages/bots-ui/**"` to the root
`tsconfig.json` `exclude` in this commit, and give the package a
`typecheck` script.

- [x] **Step 4: Run them to verify they pass**

Run: the two commands above (`--update-snapshots` once for the new
baseline)
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/bots-ui apps/bots/web bun.lock
git commit -m "feat(bots): add the UI foundation, avatars and primitives"
```

### Task 1.3: App shell and navigation

**Files:**
- Create: `packages/bots-ui/src/app.tsx`, `src/state/store.ts`,
  `src/state/socket.ts`, `src/shell/Sidebar.tsx`, `src/shell/CommandK.tsx`,
  `src/shell/Search.tsx`, `src/shell/routes.ts`
- Test: `apps/bots/web/e2e/shell.e2e.ts`

**Interfaces:**
- Consumes: `createApiClient`, frames, `@knightcode/chord/delta` (apply ops
  to the view).
- Produces: `BotsApp({ api: ApiClient; connect: () => WebSocketLike; platform: "web" | "desktop" })`;
  `useBots()`, `useBot(id)`, `useConversation(botId)` hooks; routes for
  every screen id.

- [x] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/shell.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("sidebar lists bots, groups, sections and needs-you markers", async ({ page }) => {
	await page.goto("/");
	await expect(page.getByRole("navigation")).toContainText("Reviewer");
	await expect(page.getByTestId("needs-you")).toHaveCount(1);
	await page.keyboard.press("Control+K");
	await page.keyboard.type("Rev");
	await page.keyboard.press("Enter");
	await expect(page).toHaveURL(/\/bots\//);
});
test("shell matches the reference", async ({ page }) => compareToReference(page, "shell"));
```

- [x] **Step 2: Run it to verify it fails**

Run: `bunx playwright test --project ui shell`
Expected: FAIL.

- [x] **Step 3: Implement the shell** (pin, sections, mark unread,
  duplicate, archive and restore from the sidebar menu; search across bots
  and conversations; Cmd/Ctrl+K)

- [x] **Step 4: Run ui, then run reference for `shell`**

Expected: PASS for both.

- [x] **Step 5: Commit**

```bash
git add packages/bots-ui/src apps/bots/web/e2e/shell.e2e.ts
git commit -m "feat(bots): add the app shell and navigation"
```

### Task 1.4: Chat

**Files:**
- Create: `packages/bots-ui/src/chat/Transcript.tsx`, `Composer.tsx`,
  `Message.tsx`, `cards/QuestionCard.tsx`, `cards/ApprovalCard.tsx`,
  `cards/TakeoverCard.tsx`, `cards/SuggestionCard.tsx`,
  `cards/HelperCard.tsx`, `BotMessageRow.tsx`, `ToolActivity.tsx`,
  `rich/Markdown.tsx`, `rich/Chart.tsx`, `rich/Mermaid.tsx`,
  `FilePreview.tsx`, `LinkPreview.tsx`, `McpAppFrame.tsx`
- Test: `apps/bots/web/e2e/chat.e2e.ts`

**Interfaces:**
- Consumes: `useConversation`, `ClientFrame` `submit`, `stop`, `answer`.
- Produces: `McpAppFrame({ appUrl, onAction })`, which renders an iframe
  from the sandbox origin passed in config (never the app origin) and
  forwards actions to the API, not to a local bridge.

- [x] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/chat.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("send, stream, stop, react, reply, quote, attach, mention and skill", async ({ page }) => {
	await page.goto("/bots/reviewer");
	const composer = page.getByRole("textbox", { name: "Message" });
	await composer.fill("Review PR 12");
	await composer.press("Enter");
	await expect(page.getByTestId("streaming")).toBeVisible();
	await page.getByRole("button", { name: "Stop" }).click();
	await composer.fill("@");
	await expect(page.getByRole("listbox", { name: "Mentions" })).toContainText("Inbox");
	await composer.fill("/");
	await expect(page.getByRole("listbox", { name: "Skills" })).toBeVisible();
	await page.setInputFiles('input[type="file"]', { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("x") });
	await expect(page.getByTestId("attachment")).toContainText("a.txt");
});
test("approval card answers once and stays answerable while chatting", async ({ page }) => {
	await page.goto("/bots/inbox");
	await page.getByRole("textbox", { name: "Message" }).fill("keep going");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	await page.getByRole("button", { name: "Allow once" }).click();
	await expect(page.getByTestId("approval-state")).toHaveText("Allowed");
});
for (const screen of ["chat", "chat-streaming", "composer-mention", "card-question", "card-approval", "card-takeover"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [x] **Step 2: Run it to verify it fails**

Run: `bunx playwright test --project ui chat`
Expected: FAIL.

- [x] **Step 3: Implement the chat components** ("Messaged <bot>" and
  "Message from <bot>" rows open a read-only exchange; "Show tools used" is
  off by default; Mermaid and charts render from the reply)

- [x] **Step 4: Run ui, then run reference for the six chat screens**

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/bots-ui/src/chat apps/bots/web/e2e/chat.e2e.ts
git commit -m "feat(bots): add the chat screen and cards"
```

### Task 1.5: Creating, importing and configuring bots

**Files:**
- Create: `packages/bots-ui/src/bot/CreateBot.tsx`, `Templates.tsx`,
  `ImportAgent.tsx`, `RecipePreview.tsx`, `BotSettings.tsx`,
  `InstructionsHistory.tsx`, `ModelPicker.tsx`, `KnowledgeFiles.tsx`,
  `OpenWork.tsx`, `MemoryViewer.tsx`, `ExportBot.tsx`,
  `packages/bots-ui/src/bot/templates-data.ts`
- Test: `apps/bots/web/e2e/bot.e2e.ts`

**Interfaces:**
- Consumes: `parseRecipe`, `RecipeSchema`, the `ROUTES` for bots, models
  (the model list comes from the API, never from UI constants).
- Produces: `templates-data.ts` with the 44 templates of spec section 5,
  each with KnightCode-written instructions, suggested connectors and
  routines.

- [x] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/bot.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("create from a template, import a recipe, and export it again", async ({ page }) => {
	await page.goto("/new");
	await page.getByRole("tab", { name: "Templates" }).click();
	await expect(page.getByRole("listitem")).toHaveCount(44);
	await page.getByRole("button", { name: "Import an agent" }).click();
	await page.getByRole("textbox", { name: "Paste" }).fill(JSON.stringify({ profile: { name: "X", description: "d" }, memory: [{ content: "likes tea" }], skills: [{ name: "setup", description: "d", content: "c" }], routines: [{ name: "daily", slug: "daily", description: "d", content: "p" }], plugins: [], gettingStarted: { skill: "setup" } }));
	await expect(page.getByRole("checkbox", { name: /likes tea/ })).not.toBeChecked();
	await expect(page.getByRole("checkbox", { name: /daily/ })).not.toBeChecked();
	await expect(page.getByRole("checkbox", { name: /Run setup/ })).not.toBeChecked();
	await page.getByRole("button", { name: "Create bot" }).click();
	await expect(page.getByRole("button", { name: "Run setup" })).toBeVisible();
	await expect(page.getByTestId("streaming")).toHaveCount(0);
});
test("model picker lists models from the API only", async ({ page }) => {
	await page.goto("/bots/reviewer/settings");
	await page.getByRole("combobox", { name: "Model" }).click();
	await expect(page.getByRole("option")).not.toHaveCount(0);
});
for (const screen of ["bot-create", "templates", "bot-settings", "memory"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [x] **Step 2: Run it to verify it fails**

Run: `bunx playwright test --project ui bot`
Expected: FAIL.

- [x] **Step 3: Implement the screens** (imported memory and routines
  start unticked; a recipe's `gettingStarted.skill` shows as its own item
  and becomes a "Run setup" button; the importer never fetches a URL)

- [x] **Step 4: Run ui, then run reference for the four screens**

Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add packages/bots-ui/src/bot apps/bots/web/e2e/bot.e2e.ts
git commit -m "feat(bots): add bot creation, templates, import and settings"
```

### Task 1.6: The computer pane

**Files:**
- Create: `packages/bots-ui/src/computer/ComputerPane.tsx`,
  `ScreenViewer.tsx`, `TakeControl.tsx`, `TerminalDock.tsx`,
  `FilesDock.tsx`, `Maintenance.tsx`, `TeachTask.tsx`, `ProtectedInput.tsx`
- Test: `apps/bots/web/e2e/computer.e2e.ts`

**Interfaces:**
- Consumes: `ComputerState`; the fake backend's screen URL (a local noVNC
  test page).
- Produces: `ScreenViewer({ capabilityUrl, mode: "view" | "control" })`.

- [x] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/computer.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("take control, release, maintenance and teach", async ({ page }) => {
	await page.goto("/bots/reviewer/computer");
	await page.getByRole("button", { name: "Take control" }).click();
	await expect(page.getByText("You have control")).toBeVisible();
	await page.getByRole("button", { name: "Release control" }).click();
	await page.getByRole("button", { name: "More computer actions" }).click();
	for (const name of ["Stop computer", "Update computer", "Recover computer", "Reset computer"]) await expect(page.getByRole("menuitem", { name })).toBeVisible();
	await page.keyboard.press("Escape");
	await page.getByRole("button", { name: "Teach a task" }).click();
	await expect(page.getByRole("button", { name: "Start recording" })).toBeVisible();
});
for (const screen of ["computer", "computer-takeover", "teach"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [x] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui computer`)
- [x] **Step 3: Implement the computer pane components**
- [x] **Step 4: Run ui, then run reference for the three screens**
- [x] **Step 5: Commit**

```bash
git add packages/bots-ui/src/computer apps/bots/web/e2e/computer.e2e.ts
git commit -m "feat(bots): add the computer pane"
```

### Task 1.7: Connectors and skills

**Files:**
- Create: `packages/bots-ui/src/connectors/Catalog.tsx`, `ConnectorPage.tsx`,
  `ConnectFlow.tsx`, `UsageNote.tsx`, `ConnectorPermissions.tsx`,
  `packages/bots-ui/src/skills/Library.tsx`, `SkillEditor.tsx`,
  `FromGitHub.tsx`, `DraftSkillCard.tsx`
- Test: `apps/bots/web/e2e/connectors.e2e.ts`

**Interfaces:**
- Consumes: `CatalogEntry`, `Skill`.
- Produces: no source or marketplace label is rendered anywhere in these
  components (the entry has no field for one).

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/connectors.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("catalog shows apps without source labels and connects with skills", async ({ page }) => {
	await page.goto("/connectors");
	await expect(page.getByRole("main")).not.toContainText(/Claude|xAI|Anthropic|Composio|marketplace/i);
	await page.getByRole("link", { name: "Gmail" }).click();
	await page.getByRole("button", { name: "Connect" }).click();
	await expect(page.getByRole("checkbox", { name: /Add Gmail's skills/ })).toBeChecked();
	await page.getByRole("textbox", { name: "Usage note" }).fill("x".repeat(501));
	await expect(page.getByText("500 characters")).toBeVisible();
});
for (const screen of ["catalog", "connector", "skills"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

The catalog page is checked for labels before opening Gmail, because the
Gmail connect screen carries the spec's one-line processor notice
(`data-testid="processor-notice"`), the only place a processor is named.

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui connectors`)
- [ ] **Step 3: Implement the connector and skill screens**
- [ ] **Step 4: Run ui, then run reference for the three screens**
- [ ] **Step 5: Commit**

```bash
git add packages/bots-ui/src/connectors packages/bots-ui/src/skills apps/bots/web/e2e/connectors.e2e.ts
git commit -m "feat(bots): add the connector catalog and skills library"
```

### Task 1.8: Routines, Activity and Usage

**Files:**
- Create: `packages/bots-ui/src/routines/RoutineList.tsx`,
  `RoutineEditor.tsx`, `TriggerPicker.tsx`, `GrantEditor.tsx`,
  `RunHistory.tsx`, `packages/bots-ui/src/activity/Activity.tsx`,
  `packages/bots-ui/src/usage/Usage.tsx`
- Test: `apps/bots/web/e2e/routines.e2e.ts`

**Interfaces:**
- Consumes: `Routine`, `Trigger`, `Grant`, `UsageRow`.
- Produces: `TriggerPicker` covering all seven trigger kinds; the watch
  trigger shows estimated computer hours for file and command checks.

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/routines.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("create a routine with a grant and every trigger kind available", async ({ page }) => {
	await page.goto("/bots/reviewer/routines/new");
	await page.getByRole("button", { name: "Add trigger" }).click();
	for (const kind of ["Schedule", "GitHub", "Slack", "Email", "App event", "Webhook", "Watch for changes"]) await expect(page.getByRole("menuitem", { name: kind })).toBeVisible();
	await page.getByRole("menuitem", { name: "Watch for changes" }).click();
	await page.getByRole("combobox", { name: "What to watch" }).selectOption("command");
	await expect(page.getByTestId("computer-hours-estimate")).toBeVisible();
	await expect(page.getByRole("group", { name: "Allowed actions" })).toBeVisible();
});
for (const screen of ["routines", "routine-edit", "activity", "usage"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui routines`)
- [ ] **Step 3: Implement the routine, activity and usage screens**
- [ ] **Step 4: Run ui, then run reference for the four screens**
- [ ] **Step 5: Commit**

```bash
git add packages/bots-ui/src/routines packages/bots-ui/src/activity packages/bots-ui/src/usage apps/bots/web/e2e/routines.e2e.ts
git commit -m "feat(bots): add routines, activity and usage screens"
```

### Task 1.9: Pages, inbox, suggestions and catch-up

**Files:**
- Create: `packages/bots-ui/src/pages/Library.tsx`, `PageView.tsx`,
  `blocks/*.tsx` (one per `PageBlock` kind), `packages/bots-ui/src/inbox/Inbox.tsx`,
  `TaskList.tsx`, `CatchUp.tsx`
- Test: `apps/bots/web/e2e/pages.e2e.ts`

**Interfaces:**
- Consumes: `Page`, `PageBlock`, `InboxItem`, `Task`.
- Produces: a renderer for every block kind; no block renders HTML or runs
  script from page data.

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/pages.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("page blocks render safely and the inbox spans bots", async ({ page }) => {
	await page.goto("/pages/weekly");
	await expect(page.locator("script[data-from-page]")).toHaveCount(0);
	await expect(page.getByRole("img", { name: /chart/i })).toBeVisible();
	await page.goto("/inbox");
	await expect(page.getByRole("listitem")).toContainText(["Reviewer", "Inbox"]);
	await page.goto("/?away=5h");
	await expect(page.getByRole("heading", { name: "While you were away" })).toBeVisible();
});
for (const screen of ["pages", "page", "inbox", "catch-up"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui pages`)
- [ ] **Step 3: Implement pages, inbox, tasks and catch-up**
- [ ] **Step 4: Run ui, then run reference for the four screens**
- [ ] **Step 5: Commit**

```bash
git add packages/bots-ui/src/pages packages/bots-ui/src/inbox apps/bots/web/e2e/pages.e2e.ts
git commit -m "feat(bots): add pages, inbox and catch-up"
```

### Task 1.10: Group chats and the Chief of Staff surfaces

**Files:**
- Create: `packages/bots-ui/src/groups/GroupChat.tsx`, `GroupSettings.tsx`,
  `TurnIndicator.tsx`, `packages/bots-ui/src/bot/ManagedBots.tsx`
- Test: `apps/bots/web/e2e/groups.e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/groups.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("group mentions, everyone, passes and a 2-to-10 member limit", async ({ page }) => {
	await page.goto("/groups/launch");
	await page.getByRole("textbox", { name: "Message" }).fill("@everyone status?");
	await page.getByRole("textbox", { name: "Message" }).press("Enter");
	await expect(page.getByTestId("turn-passed")).not.toHaveCount(0);
	await page.goto("/groups/launch/settings");
	await expect(page.getByText("2 to 10 bots")).toBeVisible();
});
test("group matches the reference", async ({ page }) => compareToReference(page, "group"));
```

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui groups`)
- [ ] **Step 3: Implement the group screens** (management changes always
  show the full change on an approval card)
- [ ] **Step 4: Run ui, then run reference for `group`**
- [ ] **Step 5: Commit**

```bash
git add packages/bots-ui/src/groups packages/bots-ui/src/bot/ManagedBots.tsx apps/bots/web/e2e/groups.e2e.ts
git commit -m "feat(bots): add group chats and managed bots"
```

### Task 1.11: Settings, onboarding and billing screens

**Files:**
- Create: `packages/bots-ui/src/settings/Account.tsx` (sign-in methods,
  passkeys, export, delete), `Approvals.tsx` (modes, Allow and Block,
  preview), `Vault.tsx`, `OnePassword.tsx`, `Payments.tsx` (Link wallet,
  per-bot limits), `Finance.tsx`, `HomeRouting.tsx`, `Tailscale.tsx`,
  `Channels.tsx` (Telegram code, Slack install and DMs, bot email
  addresses), `Billing.tsx` (plan, trial, top-up with $5 minimum and custom
  amount, spending limit, receipts showing the payment fee),
  `ConnectProviders.tsx`, `packages/bots-ui/src/onboarding/Checklist.tsx`
- Test: `apps/bots/web/e2e/settings.e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/settings.e2e.ts
import { expect, test } from "@playwright/test";
import { compareToReference } from "./reference/compare.ts";
test("billing enforces the $5 minimum and shows the fee", async ({ page }) => {
	await page.goto("/settings/billing");
	await page.getByRole("spinbutton", { name: "Amount" }).fill("4");
	await expect(page.getByRole("button", { name: "Add credits" })).toBeDisabled();
	for (const amount of ["$5", "$15", "$25"]) await expect(page.getByRole("button", { name: amount })).toBeVisible();
});
test("vault never shows values and bot emails are human-friendly", async ({ page }) => {
	await page.goto("/settings/vault");
	await expect(page.getByTestId("vault-value")).toHaveCount(0);
	await page.goto("/settings/channels");
	await expect(page.getByText(/^reviewer\.[a-z0-9-]{3,20}@bots\.knightcode\.dev$/)).toBeVisible();
});
test("onboarding checklist items disappear when done", async ({ page }) => {
	await page.goto("/?onboarding=1");
	await expect(page.getByRole("list", { name: "Get started" }).getByRole("listitem")).toHaveCount(5);
});
for (const screen of ["settings-account", "settings-approvals", "settings-vault", "settings-payments", "settings-channels", "settings-billing", "onboarding"])
	test(`${screen} matches the reference`, async ({ page }) => compareToReference(page, screen));
```

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui settings`)
- [ ] **Step 3: Implement the settings and onboarding screens**
- [ ] **Step 4: Run ui, then run reference for the seven screens**
- [ ] **Step 5: Commit**

```bash
git add packages/bots-ui/src/settings packages/bots-ui/src/onboarding apps/bots/web/e2e/settings.e2e.ts
git commit -m "feat(bots): add settings, onboarding and billing screens"
```

### Task 1.12: Phone layouts and the installable web app

**Files:**
- Create: `apps/bots/web/public/manifest.webmanifest`,
  `apps/bots/web/src/sw.ts`, `packages/bots-ui/src/shell/MobileNav.tsx`
- Test: `apps/bots/web/e2e/mobile.e2e.ts`

- [ ] **Step 1: Write the failing test**

```ts
// apps/bots/web/e2e/mobile.e2e.ts
import { devices, expect, test } from "@playwright/test";
test.use({ ...devices["iPhone 15"] });
test("phone layout has no horizontal scroll and is installable", async ({ page }) => {
	await page.goto("/");
	expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
	await expect(page.locator('link[rel="manifest"]')).toHaveCount(1);
	await page.goto("/bots/reviewer");
	await expect(page.getByRole("textbox", { name: "Message" })).toBeInViewport();
	await expect(page).toHaveScreenshot("phone-chat.png");
});
```

- [ ] **Step 2: Run it to verify it fails** (`bunx playwright test --project ui mobile`)
- [ ] **Step 3: Implement phone layouts, the manifest and the service worker**
  (push subscription UI only; delivery comes in Task 3.11)
- [ ] **Step 4: Run it to verify it passes** (`--update-snapshots` once)
- [ ] **Step 5: Commit**

```bash
git add apps/bots/web/public/manifest.webmanifest apps/bots/web/src/sw.ts packages/bots-ui/src/shell/MobileNav.tsx apps/bots/web/e2e/mobile.e2e.ts
git commit -m "feat(bots): add phone layouts and the installable web app"
```

### Task 1.13: Desktop product switcher

**Files:**
- Create: `apps/desktop/src/renderer/components/product-switcher.tsx`,
  `apps/desktop/src/renderer/bots/mount.tsx`
- Modify: `apps/desktop/src/renderer/components/sidebar.tsx` (the header
  that renders "KnightCode" becomes the switcher)
- Test: `apps/desktop/test/e2e/bots-switcher.e2e.ts`

**Interfaces:**
- Consumes: `BotsApp` with `platform: "desktop"`; in this task its `api` and
  `connect` come from `createFakeBackend` (Task 4.1 swaps in the real ones).
- Produces: `ProductSwitcher({ product, onChange, needsYou })`; the setting
  `desktop.product` remembered in desktop state.

- [ ] **Step 1: Write the failing test** (in the style of
  `apps/desktop/test/e2e/app.e2e.ts`, reusing its isolated user-data
  directory so the run never opens the owner's real `%APPDATA%\KnightCode`
  profile or blocks the installed app): the sidebar header shows
  "KnightCode ▾"; choosing "KnightCode Bots" renders the bots sidebar with
  the fake bots; a needs-you item shows a badge on the switcher; switching
  back restores the coding sidebar with its threads unchanged.
- [ ] **Step 2: Run it to verify it fails** (`bun run test:e2e -- bots-switcher` in `apps/desktop`)
- [ ] **Step 3: Implement the switcher and the bots mount** (renderer only;
  the coding harness and app server are untouched)
- [ ] **Step 4: Run it to verify it passes**
- [ ] **Step 5: Commit**

```bash
git add apps/desktop/src/renderer/components/product-switcher.tsx apps/desktop/src/renderer/bots apps/desktop/src/renderer/components/sidebar.tsx apps/desktop/test/e2e/bots-switcher.e2e.ts
git commit -m "feat(desktop): add the KnightCode Bots product switcher"
```

### Task 1.14: Visual sign-off

**Files:**
- Modify: whatever screens still fail the reference project

- [ ] **Step 1: Run every reference comparison**

Run: `bunx playwright test --project reference` in `apps/bots/web`
Expected: every screen id from Task 1.1 passes, in light and dark.

- [ ] **Step 2: Compare avatars and animations by eye**

Open each `screens/*.png` next to the matching screen in the dev server;
note any visible difference in the reference folder's `signoff.md` and fix
it. Expected: `signoff.md` lists no open difference.

- [ ] **Step 3: Run the full UI suite**

Run: `bunx playwright test --project ui` and `bunx vitest --run` in
`packages/bots-ui`
Expected: all passed.

- [ ] **Step 4: Commit**

```bash
git add packages/bots-ui apps/bots/web
git commit -m "fix(bots): close the remaining visual differences"
```
