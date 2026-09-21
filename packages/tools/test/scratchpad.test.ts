import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI } from "@knightcodeai/cli";
import { ENV_AGENT_DIR } from "@knightcodeai/cli/config";
import { afterEach, beforeEach, describe, expect, test } from "vitest";
import {
	NOTES_MAX_BYTES,
	openScratchpad,
	registerScratchpad,
	restoredNotes,
	scratchpadDir,
	scratchpadSection,
} from "../src/scratchpad.ts";
import { resetSessionOverrides, setMode } from "../src/state.ts";

type Handler = (event: unknown, ctx: unknown) => unknown;
type Sent = { customType: string; content: unknown; display?: boolean; options?: { triggerTurn?: boolean } };

// A stand-in for ExtensionAPI that records handlers and sent messages.
function fakePi() {
	const handlers = new Map<string, Handler>();
	const sent: Sent[] = [];
	const pi = {
		on: (event: string, handler: Handler) => {
			handlers.set(event, handler);
		},
		sendMessage: (message: Sent, options?: Sent["options"]) => {
			sent.push({ ...message, options });
		},
	} as unknown as ExtensionAPI;
	return { pi, handlers, sent };
}

const ctx = (sessionId: string) => ({ sessionManager: { getSessionId: () => sessionId } });

let base: string;
beforeEach(() => {
	base = mkdtempSync(join(tmpdir(), "kc-scratchpad-"));
	// tools.json is read from the agent dir; point it at the temp folder so your real one is never read.
	process.env[ENV_AGENT_DIR] = join(base, "agent");
	resetSessionOverrides();
});
afterEach(() => {
	delete process.env[ENV_AGENT_DIR];
	resetSessionOverrides();
	rmSync(base, { recursive: true, force: true });
});

describe("scratchpadDir", () => {
	test("is one directory per session under the base", () => {
		const first = scratchpadDir("s1", base);
		expect(first.startsWith(base)).toBe(true);
		expect(first.endsWith("s1")).toBe(true);
		expect(scratchpadDir("s2", base)).not.toBe(first);
	});
});

describe("scratchpadSection", () => {
	test("names the directory with forward slashes and the notes convention", () => {
		const text = scratchpadSection("C:\\Temp\\knightcode\\scratchpad\\s1");
		expect(text).toContain("C:/Temp/knightcode/scratchpad/s1");
		expect(text).toContain("notes.md");
		expect(text).toContain("restored after compaction");
	});

	test("stays within its token budget", () => {
		// Every request carries this text while the feature is on: about 60 tokens plus the path.
		expect(scratchpadSection("").length).toBeLessThanOrEqual(260);
	});
});

describe("restoredNotes", () => {
	test("is undefined when notes.md is missing or blank", () => {
		expect(restoredNotes(base)).toBeUndefined();
		writeFileSync(join(base, "notes.md"), "  \n");
		expect(restoredNotes(base)).toBeUndefined();
	});

	test("frames the notes with their path", () => {
		writeFileSync(join(base, "notes.md"), "- [ ] wire auth\n");
		const text = restoredNotes(base);
		expect(text).toContain("restored after compaction");
		expect(text).toContain("- [ ] wire auth");
		expect(text).toContain(join(base, "notes.md").replace(/\\/g, "/"));
	});

	test("caps the restore and points at the file for the rest", () => {
		writeFileSync(join(base, "notes.md"), "a line of working notes\n".repeat(2000));
		const text = restoredNotes(base) ?? "";
		expect(Buffer.byteLength(text, "utf8")).toBeLessThan(NOTES_MAX_BYTES + 512);
		expect(text).toContain("truncated; read");
	});

	test("restores the head of a first line longer than the cap", () => {
		// The leading "x" puts the byte cap in the middle of a two-byte "é".
		writeFileSync(join(base, "notes.md"), `x${"é".repeat(NOTES_MAX_BYTES)}\n- next step\n`);
		const text = restoredNotes(base) ?? "";
		expect(text).toContain("é".repeat(100));
		expect(text).not.toContain("�");
		expect(Buffer.byteLength(text, "utf8")).toBeLessThan(NOTES_MAX_BYTES + 512);
		expect(text).toContain("truncated; read");
	});
});

describe("openScratchpad", () => {
	test("creates the session directory", () => {
		const dir = openScratchpad("s1", base);
		expect(dir).toBe(scratchpadDir("s1", base));
		expect(existsSync(dir)).toBe(true);
	});

	// Windows has no uid, and its temp dir is per-user.
	test.skipIf(!process.getuid)("refuses a parent directory other users can write to", () => {
		const owner = join(base, `knightcode-${process.getuid?.()}`);
		mkdirSync(owner);
		chmodSync(owner, 0o777);
		expect(() => openScratchpad("s1", base)).toThrow("not a private directory owned by you");
		expect(existsSync(scratchpadDir("s1", base))).toBe(false);
	});
});

describe("registerScratchpad", () => {
	test("while disabled, leaves the prompt alone, creates nothing and restores nothing", async () => {
		const { pi, handlers, sent } = fakePi();
		registerScratchpad(pi, base);
		const sections: Record<string, string> = {};
		await handlers.get("before_agent_start")?.({ systemPromptOptions: { sections } }, ctx("s1"));
		await handlers.get("session_compact")?.({}, ctx("s1"));
		expect(sections).toEqual({});
		expect(sent).toEqual([]);
		expect(existsSync(scratchpadDir("s1", base))).toBe(false);
	});

	test("once enabled, adds the section and creates the directory", async () => {
		await setMode("scratchpad", "session");
		const { pi, handlers } = fakePi();
		registerScratchpad(pi, base);
		const sections: Record<string, string> = {};
		await handlers.get("before_agent_start")?.({ systemPromptOptions: { sections } }, ctx("s1"));
		const dir = scratchpadDir("s1", base);
		expect(sections.scratchpad).toBe(scratchpadSection(dir));
		expect(existsSync(dir)).toBe(true);
	});

	test("after compaction, sends notes.md back once as a hidden message", async () => {
		await setMode("scratchpad", "session");
		const dir = openScratchpad("s1", base);
		writeFileSync(join(dir, "notes.md"), "- mint.ts:42 mints the token\n");
		const { pi, handlers, sent } = fakePi();
		registerScratchpad(pi, base);
		await handlers.get("session_compact")?.({}, ctx("s1"));
		expect(sent).toHaveLength(1);
		expect(sent[0]).toMatchObject({ customType: "scratchpad-notes", display: false });
		expect(String(sent[0].content)).toContain("mint.ts:42 mints the token");
	});

	test("steers the notes only when a response follows the compaction", async () => {
		await setMode("scratchpad", "session");
		const dir = openScratchpad("s1", base);
		writeFileSync(join(dir, "notes.md"), "- mint.ts:42 mints the token\n");
		const { pi, handlers, sent } = fakePi();
		registerScratchpad(pi, base);
		await handlers.get("agent_start")?.({}, ctx("s1"));
		await handlers.get("session_compact")?.({ willRetry: false }, ctx("s1"));
		await handlers.get("agent_end")?.({}, ctx("s1"));
		await handlers.get("session_compact")?.({ willRetry: true }, ctx("s1"));
		await handlers.get("session_compact")?.({ willRetry: false }, ctx("s1"));
		expect(sent.map((message) => message.options)).toEqual([undefined, undefined, { triggerTurn: false }]);
	});

	test("after compaction with no notes, sends nothing", async () => {
		await setMode("scratchpad", "session");
		const { pi, handlers, sent } = fakePi();
		registerScratchpad(pi, base);
		await handlers.get("session_compact")?.({}, ctx("s1"));
		expect(sent).toEqual([]);
	});
});
