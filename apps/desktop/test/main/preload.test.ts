import { expect, test, vi } from "vitest";

// The preload reads its argv and wires its listeners at import, so the fakes exist before it loads.
const page = vi.hoisted(() => {
	process.argv.push("--kc-origin=app://desktop", "--kc-window-id=3");
	let onMessage: (event: { source: unknown; origin: string; data: unknown }) => void = () => {};
	let onPort: (event: { ports: unknown[] }) => void = () => {};
	const window = {
		location: { origin: "app://desktop" },
		postMessage: vi.fn(),
		addEventListener: (_type: string, listener: typeof onMessage) => (onMessage = listener),
	};
	Object.assign(globalThis, { window });
	return {
		window,
		/** A `message` event as the page would see it. */
		message: (data: unknown, origin: string, source: unknown = window) => onMessage({ source, origin, data }),
		/** Main handing the preload a new port. */
		port: (port: unknown) => onPort({ ports: [port] }),
		setOnPort: (listener: typeof onPort) => (onPort = listener),
	};
});

vi.mock("electron", () => ({
	contextBridge: { exposeInMainWorld: vi.fn() },
	ipcRenderer: { on: (_channel: string, listener: (event: { ports: unknown[] }) => void) => page.setOnPort(listener) },
}));

import "../../src/preload.ts";

test("the port goes only to a hello from the page itself at the expected origin", () => {
	const first = { name: "first" };
	page.port(first);
	page.message("kc:hello", "https://evil.example");
	page.message("kc:hello", "app://desktop", { name: "another frame" });
	expect(page.window.postMessage).not.toHaveBeenCalled();
	page.message("kc:hello", "app://desktop");
	expect(page.window.postMessage).toHaveBeenCalledExactlyOnceWith("kc:port", "app://desktop", [first]);
});

test("a page that navigated to another origin never receives a port", () => {
	page.window.postMessage.mockClear();
	page.window.location.origin = "https://evil.example";
	page.port({ name: "second" });
	expect(page.window.postMessage).not.toHaveBeenCalled();
});
