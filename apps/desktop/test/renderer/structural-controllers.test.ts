import { experimental_controllers } from "@knightcodeai/cli/desktop";
import { afterEach, expect, test, vi } from "vitest";

const host = vi.hoisted(() => vi.fn(async () => ({})));
const request = vi.hoisted(() => vi.fn());
vi.hoisted(() => Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } }));
vi.mock("../../src/renderer/client.ts", () => ({
	client: {
		host,
		request,
		onNotification: () => () => {},
		onServerRequest: () => () => {},
		onHostEvent: () => () => {},
	},
	RequestError: class extends Error {},
}));
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { getState, navigate, refreshThreads, composerDraftOf, setComposerDraft } from "../../src/renderer/store.ts";

afterEach(() => vi.clearAllMocks());

test("thread mutation facades return confirmed success or refusal, never success after a failed request", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		request.mockResolvedValueOnce({
			threads: [
				{
					id: "A",
					cwd: "/A",
					projectCwd: "/A",
					name: "A",
					status: { type: "idle" },
					archived: false,
					workspaceMode: "local",
					createdAt: "2026-01-01",
					updatedAt: "2026-01-01",
				},
			],
		});
		await refreshThreads();
		const c = experimental_controllers();
		request.mockRejectedValueOnce(new Error("rename refused"));
		expect(await c.experimental_renameThread("A", "new name")).toBe(false);
		request.mockResolvedValueOnce({});
		expect(await c.experimental_renameThread("A", "new name")).toBe(true);
		request.mockRejectedValueOnce(new Error("archive refused"));
		expect(await c.experimental_archiveThread("A")).toBe(false);
		expect(request).toHaveBeenLastCalledWith("thread/archive", { threadId: "A" });
	} finally {
		dispose();
	}
});

test("draft text and attachments belong to the store, not a replaceable surface mount", () => {
	const dispose = initializeDesktopExtensions();
	try {
		setComposerDraft("thread:A", (draft) => ({ ...draft, text: "unsent", images: ["/image.png"] }));
	} finally {
		dispose();
	}
	expect(composerDraftOf(getState(), "thread:A")).toEqual({ text: "unsent", images: ["/image.png"] });
	expect(composerDraftOf(getState(), "thread:B")).toEqual({ text: "", images: [] });
	setComposerDraft("thread:A", () => ({ text: "", images: [] }));
	expect(composerDraftOf(getState(), "thread:A")).toEqual({ text: "", images: [] });
});

test("navigation facade preserves history and refuses absent pages and threads", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		const c = experimental_controllers();
		navigate({ kind: "new", cwd: "/A" });
		c.experimental_showSettings("archived");
		expect(c.experimental_goBack(-1)).toBe(true);
		expect(getState().view).toEqual({ kind: "new", cwd: "/A" });
		expect(c.experimental_goBack(1)).toBe(true);
		expect(getState().view).toEqual({ kind: "settings", page: "archived" });
		expect(c.experimental_goBack(1)).toBe(false);
		expect(c.experimental_openPage("absent/page")).toBe(false);
		expect(await c.experimental_openThread("absent")).toBe(false);
	} finally {
		dispose();
	}
});

test("window commands use the existing host gate and report declined transport without throwing", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		const c = experimental_controllers();
		expect(await c.experimental_windowCommand("minimize")).toBe(true);
		expect(host).toHaveBeenCalledWith("host/app/command", { command: "minimize" });
		host.mockRejectedValueOnce(new Error("window closed"));
		expect(await c.experimental_windowCommand("close")).toBe(false);
		expect(getState().toasts.at(-1)?.text).toBe("window closed");
	} finally {
		dispose();
	}
});

test("project and thread facade refuse stale identities rather than touching the current selection", async () => {
	const dispose = initializeDesktopExtensions();
	try {
		const c = experimental_controllers();
		navigate({ kind: "new", cwd: "/B" });
		expect(c.experimental_removeProject("/A")).toBe(false);
		expect(c.experimental_pinThread("missing-A", true)).toBe(false);
		expect(await c.experimental_renameThread("missing-A", "renamed")).toBe(false);
		expect(await c.experimental_archiveThread("missing-A")).toBe(false);
		expect(getState().view).toEqual({ kind: "new", cwd: "/B" });
		expect(host).not.toHaveBeenCalled();
	} finally {
		dispose();
	}
});
