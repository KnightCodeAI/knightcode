import { EventEmitter } from "node:events";
import type { BrowserWindow, WebContents } from "electron";
import { afterEach, expect, test, vi } from "vitest";
import { handleHost } from "../../src/main/host.ts";
import { guardWebviews } from "../../src/main/preview.ts";
import { previewPartition } from "../../src/shared/preview-url.ts";

const electron = vi.hoisted(() => ({
	permission: undefined as
		((contents: unknown, permission: string, callback: (granted: boolean) => void) => void) | undefined,
	guests: new Map<number, { hostWebContents: unknown; capturePage: () => Promise<unknown> }>(),
}));

vi.mock("electron", () => ({
	app: { getPath: () => "", isPackaged: false },
	BrowserWindow: { fromWebContents: () => null },
	clipboard: {},
	dialog: { showSaveDialogSync: () => undefined },
	Menu: {},
	nativeImage: {},
	shell: {},
	session: {
		fromPartition: () => ({
			setPermissionRequestHandler: (handler: typeof electron.permission) => {
				electron.permission = handler;
			},
			setPermissionCheckHandler: () => {},
			on: () => {},
		}),
	},
	webContents: { fromId: (id: number) => electron.guests.get(id) },
}));

afterEach(() => {
	vi.useRealTimers();
	electron.guests.clear();
});

const mac = process.platform === "darwin";

function guarded(onKey: (binding: string) => void = () => {}) {
	const contents = new EventEmitter();
	guardWebviews(contents as unknown as WebContents, onKey);
	return contents;
}

function attach(partition: string, src: string) {
	const prevented = vi.fn();
	const preferences: Record<string, unknown> = {
		preload: "file:///evil.js",
		nodeIntegration: true,
		nodeIntegrationInSubFrames: true,
		contextIsolation: false,
		sandbox: false,
		webSecurity: false,
		allowRunningInsecureContent: true,
	};
	guarded().emit("will-attach-webview", { preventDefault: prevented }, preferences, { partition, src });
	return { refused: prevented.mock.calls.length > 0, preferences };
}

test("a webview attaches only on a thread's partition and a preview URL, never with a preload, Node or web security off", () => {
	const { refused, preferences } = attach(previewPartition("t1"), "http://localhost:3000/");
	expect(refused).toBe(false);
	expect(preferences).toEqual({
		nodeIntegration: false,
		nodeIntegrationInSubFrames: false,
		contextIsolation: true,
		sandbox: true,
		webSecurity: true,
		allowRunningInsecureContent: false,
	});
	expect(attach("persist:other", "http://localhost:3000/").refused).toBe(true);
	expect(attach(previewPartition("t1"), "file:///etc/passwd").refused).toBe(true);
	// Its session grants nothing.
	const granted = vi.fn();
	electron.permission?.({}, "geolocation", granted);
	expect(granted).toHaveBeenCalledWith(false);
});

test("a guest stays on http and https, and a window it opens loads in place", () => {
	vi.useFakeTimers();
	const contents = guarded();
	const guest = Object.assign(new EventEmitter(), {
		open: undefined as ((details: { url: string }) => { action: string }) | undefined,
		setWindowOpenHandler(handler: (details: { url: string }) => { action: string }) {
			this.open = handler;
		},
		loadURL: vi.fn(async () => {}),
	});
	contents.emit("did-attach-webview", {}, guest);
	expect(guest.open?.({ url: "https://example.com/" })).toEqual({ action: "deny" });
	expect(guest.open?.({ url: "javascript:alert(1)" })).toEqual({ action: "deny" });
	vi.runAllTimers();
	expect(guest.loadURL.mock.calls).toEqual([["https://example.com/"]]);
	for (const event of ["will-navigate", "will-redirect"]) {
		const refused = vi.fn();
		guest.emit(event, { preventDefault: refused }, "file:///C:/secret.txt");
		guest.emit(event, { preventDefault: refused }, "https://example.com/next");
		expect(refused).toHaveBeenCalledOnce();
	}
});

test("an app binding pressed in a focused guest runs in its window, other keys stay with the page", () => {
	const keys: string[] = [];
	const contents = guarded((binding) => keys.push(binding));
	const guest = Object.assign(new EventEmitter(), { setWindowOpenHandler: () => {} });
	contents.emit("did-attach-webview", {}, guest);
	const press = (key: string, code: string, mod: boolean) => {
		const taken = vi.fn();
		const input = { type: "keyDown", key, code, control: mod && !mac, meta: mod && mac, shift: false, alt: false };
		guest.emit("before-input-event", { preventDefault: taken }, input);
		return taken.mock.calls.length > 0;
	};
	expect(press("t", "KeyT", true)).toBe(true);
	expect(press("a", "KeyA", false)).toBe(false);
	// The palette's Mod+K: off macOS Ctrl+K stays with the page, which may use it itself.
	expect(press("k", "KeyK", true)).toBe(mac);
	expect(keys).toEqual(mac ? ["desktop.preview.open", "desktop.palette"] : ["desktop.preview.open"]);
});

test("capture refuses a guest another window hosts", async () => {
	const window = { webContents: {} } as BrowserWindow;
	electron.guests.set(7, { hostWebContents: {}, capturePage: async () => ({}) });
	const response = await handleHost(
		{ id: 1, host: "host/preview/capture", params: { webContentsId: 7, rect: { x: 0, y: 0, width: 10, height: 10 } } },
		window,
		{} as Parameters<typeof handleHost>[2],
	);
	expect(response).toEqual({ id: 1, error: { code: "invalidParams", message: "not a preview of this window" } });
});
