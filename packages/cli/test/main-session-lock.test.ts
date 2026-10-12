import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vitest";
import type { ExtensionCommandContext } from "../src/core/extensions/types.ts";
import { SessionLockedError } from "../src/core/session-lock.ts";
import { InteractiveMode } from "../src/modes/interactive/interactive-mode.ts";
import { canonicalSessionPath } from "../src/core/session-lock.ts";
import { SessionManager } from "../src/core/session-manager.ts";
import { openOrOfferFork } from "../src/main.ts";

type ResumeOptions = Parameters<ExtensionCommandContext["switchSession"]>[1];
type ResumeResult = { cancelled: boolean };
const resume = (
	InteractiveMode.prototype as unknown as {
		handleResumeSession(path: string, options?: ResumeOptions): Promise<ResumeResult>;
	}
).handleResumeSession;

const dirs: string[] = [];
afterEach(() => {
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function lockedSession() {
	const dir = mkdtempSync(join(tmpdir(), "knightcode-main-lock-"));
	dirs.push(dir);
	const manager = SessionManager.create(dir, dir);
	manager.appendMessage({ role: "user", content: [{ type: "text", text: "hi" }], timestamp: 1 });
	const file = manager.getSessionFile()!;
	manager.close();
	// Another process's fresh lock directory (as in session-lock.test.ts).
	mkdirSync(`${file}.lock`);
	return { dir, file, release: () => rmSync(`${file}.lock`, { recursive: true, force: true }) };
}

test("a held session opens as a fork when the user accepts", async () => {
	const { dir, file, release } = lockedSession();
	try {
		const opened = await openOrOfferFork(
			() => SessionManager.open(file),
			dir,
			dir,
			async () => true,
		);
		expect(opened.getSessionFile()).not.toBe(canonicalSessionPath(file));
		// The fork names its source by the canonical path the lock error carried.
		expect(opened.getHeader()?.parentSession).toBe(canonicalSessionPath(file));
		opened.close();
	} finally {
		release();
	}
});

test.each([true, false])(
	"TUI resume offers a fork and preserves the current session on refusal (accept=%s)",
	async (accept) => {
		const { dir, file, release } = lockedSession();
		const current = SessionManager.inMemory(dir);
		const switchSession = vi
			.fn()
			.mockRejectedValueOnce(new SessionLockedError(file))
			.mockImplementation(async (target: string) => {
				const manager = SessionManager.open(target, dir);
				manager.close();
				return { cancelled: false };
			});
		const host = {
			runtimeHost: { cwd: dir, switchSession },
			sessionManager: current,
			clearStatusIndicator: vi.fn(),
			createProjectTrustContext: vi.fn(),
			showExtensionConfirm: vi.fn().mockResolvedValue(accept),
			showStatus: vi.fn(),
			handleFatalRuntimeError: async (_prefix: string, error: unknown): Promise<never> => {
				throw error;
			},
			handleResumeSession(path: string, options?: ResumeOptions): Promise<ResumeResult> {
				return resume.call(host as unknown as InteractiveMode, path, options);
			},
		};
		try {
			expect(await host.handleResumeSession(file)).toEqual({ cancelled: !accept });
			expect(host.showExtensionConfirm).toHaveBeenCalledWith(
				"Session is open elsewhere",
				expect.stringContaining("fork"),
			);
			expect(switchSession).toHaveBeenCalledTimes(accept ? 2 : 1);
			if (accept) expect(switchSession.mock.calls[1][0]).not.toBe(file);
			current.appendCustomEntry("still-alive", {});
		} finally {
			current.close();
			release();
		}
	},
);

test("a held session is refused when the user declines", async () => {
	const { dir, file, release } = lockedSession();
	try {
		await expect(
			openOrOfferFork(
				() => SessionManager.open(file),
				dir,
				dir,
				async () => false,
			),
		).rejects.toThrow("open in another KnightCode process");
	} finally {
		release();
	}
});
