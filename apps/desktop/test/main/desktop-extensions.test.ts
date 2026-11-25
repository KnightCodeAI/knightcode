/** Native approval forwards only the entry kinds actually reviewed in the confirmation. */
import { tmpdir } from "node:os";
import type { BrowserWindow } from "electron";
import { afterEach, expect, test, vi } from "vitest";
import { handleDesktopExtensions } from "../../src/main/desktop-extensions.ts";
import { ExtensionArtifacts } from "../../src/main/extension-artifacts.ts";
import { ExtensionProviderPreferences } from "../../src/main/extension-preferences.ts";
import { ServerConnection } from "../../src/main/server.ts";
import { StateFile } from "../../src/main/state.ts";
import { DesktopExtensionWindows } from "../../src/main/desktop-extension-runtime.ts";

const electron = vi.hoisted(() => ({
	show: vi.fn<(...args: unknown[]) => Promise<{ response: number }>>(async () => ({ response: 0 })),
}));
vi.mock("electron", () => ({ dialog: { showMessageBox: electron.show } }));
afterEach(() => {
	vi.restoreAllMocks();
	electron.show.mockReset().mockResolvedValue({ response: 0 });
});

function fixture(initial: ("frontend" | "backend")[]) {
	let kinds = initial;
	let revision = "a".repeat(64);
	const server = new ServerConnection({
		command: { command: "not-started", args: [] },
		env: {},
		logsDir: tmpdir(),
		clientVersion: "0",
		onMessage() {},
		onState() {},
		onExit() {},
	});
	const request = vi.spyOn(server, "request").mockImplementation(async (method) => {
		if (method === "desktopExtension/list") {
			return {
				safeMode: false,
				preview: true,
				extensions: [
					{
						owner: "example",
						name: "example",
						source: "/reviewed/example",
						scope: "user",
						kinds,
						approved: false,
						enabled: false,
						dev: false,
						revision,
						diagnostics: [],
					},
				],
			};
		}
		if (method === "desktopExtension/set" || method === "desktopExtension/preview/set") return {};
		throw new Error(`Unexpected request: ${method}`);
	});
	const services = {
		server,
		runtime: new DesktopExtensionWindows(server),
		artifacts: new ExtensionArtifacts("app://desktop"),
		safeMode: false,
		providers: new ExtensionProviderPreferences(new StateFile(tmpdir())),
		providersChanged() {},
		isCurrent: () => true,
	};
	// The native presenter receives an opaque window; this test does not mock browser behavior.
	const approve = () =>
		handleDesktopExtensions(
			{
				id: 1,
				host: "host/desktopExtension/set",
				params: { owner: "example", source: "/reviewed/example", approve: true, enabled: true },
			},
			{} as BrowserWindow,
			1,
			services,
		);
	return {
		request,
		services,
		approve,
		changeRevision: (next: string) => {
			revision = next;
		},
		changeKinds: (next: ("frontend" | "backend")[]) => {
			kinds = next;
		},
	};
}

test("a prepared candidate lease uses coordinated metadata, not an unversioned inventory artifact", async () => {
	const { services, request } = fixture(["frontend", "backend"]);
	const artifact = {
		owner: "example",
		revision: "a".repeat(64),
		root: tmpdir(),
		frontend: "app.js",
		styles: [],
		files: ["app.js"],
	};
	vi.spyOn(services.runtime, "artifact").mockReturnValue(artifact);
	const register = vi.spyOn(services.artifacts, "register");
	const result = await handleDesktopExtensions(
		{
			id: 2,
			host: "host/desktopExtension/acquire",
			params: { owner: artifact.owner, revision: artifact.revision, lease: "lease" },
		},
		{} as BrowserWindow,
		1,
		services,
	);
	expect(result).not.toHaveProperty("error");
	expect(register).toHaveBeenCalledWith(artifact, 1, "lease");
	expect(request).not.toHaveBeenCalled();
});

test("the native backend warning describes OS permissions and forwards the reviewed kinds", async () => {
	const { request, approve } = fixture(["frontend", "backend"]);
	expect(await approve()).not.toHaveProperty("error");
	const options = electron.show.mock.calls[0]![1] as { detail: string };
	expect(options.detail).toMatch(/backend/i);
	expect(options.detail).toContain("a".repeat(64));
	expect(options.detail).toMatch(/OS permissions/i);
	expect(request).toHaveBeenLastCalledWith(
		"desktopExtension/set",
		expect.objectContaining({
			kinds: ["frontend", "backend"],
			revision: "a".repeat(64),
		}),
	);
	expect(request).toHaveBeenCalledWith("desktopExtension/list", { review: "example" });
});

test("the grant echoes the reviewed snapshot, not kinds added while the native dialog was open", async () => {
	const { changeKinds, request, approve } = fixture(["frontend"]);
	electron.show.mockImplementation(async () => {
		changeKinds(["frontend", "backend"]);
		return { response: 0 };
	});
	expect(await approve()).not.toHaveProperty("error");
	expect(request).toHaveBeenLastCalledWith("desktopExtension/set", expect.objectContaining({ kinds: ["frontend"] }));
});

test("declines approval when the reviewed revision changes during the native dialog", async () => {
	const { changeRevision, request, approve } = fixture(["frontend"]);
	electron.show.mockImplementation(async () => {
		changeRevision("b".repeat(64));
		return { response: 1 };
	});
	expect(await approve()).toHaveProperty("error");
	expect(request).not.toHaveBeenCalledWith("desktopExtension/set", expect.anything());
});

test("turning the extensions preview on needs a native confirmation; turning it off does not", async () => {
	const { request, services } = fixture(["frontend"]);
	const preview = (enabled: boolean) =>
		handleDesktopExtensions(
			{ id: 3, host: "host/desktopExtension/preview/set", params: { enabled } },
			{} as BrowserWindow,
			1,
			services,
		);
	electron.show.mockResolvedValueOnce({ response: 1 });
	expect(await preview(true)).not.toHaveProperty("error");
	expect(request).not.toHaveBeenCalledWith("desktopExtension/preview/set", expect.anything());
	expect(await preview(true)).not.toHaveProperty("error");
	expect(request).toHaveBeenLastCalledWith("desktopExtension/preview/set", { enabled: true });
	expect((electron.show.mock.calls[1]![1] as { detail: string }).detail).toMatch(/not sandboxed/i);
	electron.show.mockClear();
	expect(await preview(false)).not.toHaveProperty("error");
	expect(electron.show).not.toHaveBeenCalled();
	expect(request).toHaveBeenLastCalledWith("desktopExtension/preview/set", { enabled: false });
});
