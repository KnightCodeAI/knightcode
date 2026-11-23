import type * as React from "react";
import {
	defineDesktopExtension,
	experimental_shellServices,
	experimental_controllers,
	experimental_composer,
	experimental_attachComposerEditor,
} from "@knightcodeai/cli/desktop";
import { afterEach, expect, test, vi } from "vitest";

const host = vi.hoisted(() => vi.fn(async () => ({})));
const request = vi.hoisted(() => vi.fn());
vi.hoisted(() => Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } }));
vi.mock("react", async (original) => ({
	...(await original<typeof React>()),
	useSyncExternalStore: (_subscribe: unknown, read: () => unknown) => read(),
}));
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
import { desktopExtensions } from "../../src/renderer/extensions/runtime.ts";
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import {
	getState,
	navigate,
	refreshThreads,
	composerDraftOf,
	setComposerDraft,
	selectPanelContribution,
} from "../../src/renderer/store.ts";

afterEach(() => vi.clearAllMocks());

test("page listing and opening share the real sidebar context", () => {
	const dispose = initializeDesktopExtensions();
	const page = desktopExtensions.register(
		"sidebar-page",
		defineDesktopExtension((app) => {
			app.experimental_registerPage({
				id: "open",
				label: "Open sidebar",
				experimental_available: (context) => context.sidebarOpen,
				experimental_render: () => null,
			});
		}),
	);
	try {
		const c = experimental_controllers();
		c.experimental_setSidebarOpen(false);
		expect(
			experimental_shellServices()
				.experimental_usePages()
				.some((p) => p.id === "sidebar-page/open"),
		).toBe(false);
		expect(c.experimental_openPage("sidebar-page/open")).toBe(false);
		c.experimental_setSidebarOpen(true);
		expect(
			experimental_shellServices()
				.experimental_usePages()
				.some((p) => p.id === "sidebar-page/open"),
		).toBe(true);
		expect(c.experimental_openPage("sidebar-page/open")).toBe(true);
	} finally {
		page.dispose();
		dispose();
	}
});

test("reselecting an extension file tab retains its path and line", () => {
	selectPanelContribution("tab-thread", { id: "tools/view", file: { path: "README.md", line: 7 } });
	selectPanelContribution("tab-thread", { id: "tools/view" });
	expect(getState().panelContributions["tab-thread"]).toEqual({
		id: "tools/view",
		file: { path: "README.md", line: 7 },
	});
	selectPanelContribution("tab-thread");
});

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
	expect(composerDraftOf(getState(), "thread:A")).toEqual({ text: "unsent", images: ["/image.png"], revision: 1 });
	expect(composerDraftOf(getState(), "thread:B")).toEqual({ text: "", images: [], revision: 0 });
	setComposerDraft("thread:A", () => ({ text: "", images: [] }));
	expect(composerDraftOf(getState(), "thread:A")).toEqual({ text: "", images: [], revision: 2 });
});

test("the public composer facade inserts into an explicitly mounted editor, not the current thread", () => {
	const dispose = initializeDesktopExtensions();
	try {
		const target = { threadId: "public-editor-A" };
		let text = "";
		const attached = experimental_attachComposerEditor(target, {
			experimental_read: () => ({
				text,
				selection: { start: 0, end: 0, direction: "none" },
				focused: true,
				composing: false,
			}),
			experimental_apply: (edit) => {
				text = edit.text;
			},
			experimental_focus() {},
			experimental_caretAnchor: () => undefined,
		});
		expect(attached.status).toBe("mounted");
		if (attached.status !== "mounted") throw new Error("Editor refused");
		try {
			navigate({ kind: "thread", id: "public-editor-B" });
			expect(experimental_composer(target).experimental_insert("A", 0)).toEqual({ status: "applied", revision: 1 });
			expect(text).toBe("A");
			expect(composerDraftOf(getState(), "thread:public-editor-A").text).toBe("A");
			expect(composerDraftOf(getState(), "thread:public-editor-B").text).toBe("");
		} finally {
			attached.mount.dispose();
		}
	} finally {
		dispose();
	}
});

test("host disposal revokes saved editor calls and locks without letting an old disposer detach a new mount", () => {
	const first = initializeDesktopExtensions();
	const target = { threadId: "host-lifetime" };
	const adapter = {
		experimental_read: () => ({
			text: "",
			selection: { start: 0, end: 0, direction: "none" as const },
			focused: true,
			composing: false,
		}),
		experimental_apply() {},
		experimental_focus() {},
		experimental_caretAnchor: () => undefined,
	};
	const c = experimental_composer(target);
	const old = experimental_attachComposerEditor(target, adapter);
	const owner = new AbortController();
	c.experimental_lock(owner.signal);
	first();
	expect(c.experimental_insert("old", 0)).toEqual({ status: "unavailable" });
	c.experimental_lock(owner.signal);
	const second = initializeDesktopExtensions();
	const current = experimental_attachComposerEditor(target, adapter);
	try {
		if (old.status !== "mounted" || current.status !== "mounted") throw new Error("Editor refused");
		old.mount.dispose();
		expect(experimental_composer(target).experimental_insert("new", 0).status).toBe("applied");
		current.mount.dispose();
	} finally {
		owner.abort();
		second();
	}
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
