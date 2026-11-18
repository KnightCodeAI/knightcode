/** Renderer phases never publish a candidate before the shared backend decision. */
import { defineDesktopExtension } from "@knightcodeai/cli/desktop";
import type {
	DesktopActivationBinding,
	DesktopBackendContracts,
	DesktopArtifact,
} from "@knightcode/app-server-protocol";
import type { Static } from "typebox";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
vi.hoisted(() => {
	Object.assign(globalThis, { window: { addEventListener() {}, removeEventListener() {} } });
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: { onNotification: () => () => {}, onServerRequest: () => () => {}, onHostEvent: () => () => {} },
	RequestError: class extends Error {},
}));
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";
import { FrontendExtensions } from "../../src/renderer/extensions/loader.ts";
let disposeHost: () => void;
beforeEach(() => {
	disposeHost = initializeDesktopExtensions();
});
afterEach(() => {
	disposeHost();
});
const extension = (label: string) =>
	defineDesktopExtension((app) => {
		app.experimental_registerCommand({ id: "test", label: () => label, experimental_run() {} });
	});
function preparation(
	revision: string,
	epoch = revision,
): { binding: DesktopActivationBinding; artifact: Static<typeof DesktopArtifact>; contracts: DesktopBackendContracts } {
	return {
		binding: { owner: "example", revision, epoch, window: "server:1", mount: `mount-${epoch}` },
		artifact: { owner: "example", revision, root: "/cache", frontend: "app.js", styles: [], files: ["app.js"] },
		contracts: { methods: {}, events: {} },
	};
}
async function activate(loader: FrontendExtensions, packet: ReturnType<typeof preparation>) {
	await loader.prepare(packet);
	await loader.quiesce(packet.binding);
	loader.publish(packet.binding);
	loader.resume(packet.binding);
	loader.ready(packet.binding);
}

test("failed preparation retains the live pair; authoritative revocation releases it", async () => {
	const registry = new ExtensionRegistry();
	const disposed: string[] = [];
	const errors: string[] = [];
	const loader = new FrontendExtensions(
		registry,
		async (artifact) => {
			if (artifact.revision === "bad") throw new Error("CSS failed");
			return {
				extension: extension(artifact.revision),
				dispose: () => {
					disposed.push(artifact.revision);
				},
			};
		},
		(_owner, _revision, _phase, message) => {
			errors.push(message);
		},
	);
	await activate(loader, preparation("one"));
	await expect(loader.prepare(preparation("bad"))).rejects.toThrow("CSS failed");
	expect(registry.commandLabel(registry.commands({ sidebarOpen: true })[0]!, { sidebarOpen: true })).toBe("one");
	expect(errors).toContain("CSS failed");
	expect(disposed).toEqual([]);
	loader.revoke("example");
	expect(registry.getSnapshot()).toEqual([]);
	expect(disposed).toEqual(["one"]);
	loader.dispose();
});

test("prepare and quiesce do not replace old registrations; publication retires them under a new epoch", async () => {
	const registry = new ExtensionRegistry();
	let mounts = 0;
	let disposed = 0;
	const loader = new FrontendExtensions(
		registry,
		async () => ({
			extension: extension(`mount ${++mounts}`),
			dispose: () => {
				disposed++;
			},
		}),
		() => {},
	);
	const first = preparation("same", "old");
	await activate(loader, first);
	const previous = registry.getSnapshot()[0]!;
	const next = preparation("same", "new");
	await loader.prepare(next);
	expect(registry.getSnapshot()[0]).toBe(previous);
	expect(previous.signal.aborted).toBe(false);
	await loader.quiesce(next.binding);
	expect(registry.commands({ sidebarOpen: true })).toEqual([]);
	loader.publish(next.binding);
	expect(previous.signal.aborted).toBe(true);
	expect(disposed).toBe(1);
	expect(registry.commands({ sidebarOpen: true })).toEqual([]);
	loader.resume(next.binding);
	loader.ready(next.binding);
	expect(registry.commandLabel(registry.commands({ sidebarOpen: true })[0]!, { sidebarOpen: true })).toBe("mount 2");
	loader.ready(first.binding);
	expect(registry.getSnapshot()[0]!.activation!.binding.epoch).toBe("new");
	loader.dispose();
});

test("a late candidate cannot publish after authoritative revocation", async () => {
	const registry = new ExtensionRegistry();
	let finish!: () => void;
	let disposed = 0;
	const loader = new FrontendExtensions(
		registry,
		async () => {
			await new Promise<void>((resolve) => {
				finish = resolve;
			});
			return {
				extension: extension("late"),
				dispose: () => {
					disposed++;
				},
			};
		},
		() => {},
	);
	const packet = preparation("late");
	const pending = loader.prepare(packet);
	loader.revoke("example");
	finish();
	await expect(pending).rejects.toThrow(/revoked|inactive|cancel/i);
	expect(registry.getSnapshot()).toEqual([]);
	expect(disposed).toBe(1);
});

test("discard resumes the old epoch without claiming that a rejected candidate activated", async () => {
	const registry = new ExtensionRegistry();
	const active: string[] = [];
	const loader = new FrontendExtensions(
		registry,
		async (artifact) => ({ extension: extension(artifact.revision), dispose() {} }),
		(_owner, revision, phase) => {
			if (phase === "active") active.push(revision);
		},
	);
	const first = preparation("old");
	await activate(loader, first);
	const next = preparation("candidate");
	await loader.prepare(next);
	await loader.quiesce(next.binding);
	loader.discard(next.binding);
	loader.resume(first.binding);
	loader.ready(first.binding);
	expect(active).toEqual(["old"]);
	expect(registry.commands({ sidebarOpen: true })[0]!.activation!.binding.epoch).toBe("old");
	loader.dispose();
});

test("a failed post-decision publication uses fallback, never the disposed old registrations", async () => {
	const registry = new ExtensionRegistry();
	let fail = false;
	const loader = new FrontendExtensions(
		registry,
		async (artifact) => ({ extension: extension(artifact.revision), dispose() {} }),
		() => {},
		(commit) => {
			commit();
			if (fail) throw new Error("mount failed");
		},
	);
	const first = preparation("old");
	await activate(loader, first);
	const old = registry.getSnapshot()[0]!;
	const next = preparation("next");
	await loader.prepare(next);
	await loader.quiesce(next.binding);
	fail = true;
	expect(() => loader.publish(next.binding)).toThrow("mount failed");
	expect(old.signal.aborted).toBe(true);
	expect(registry.getSnapshot()).toEqual([]);
	loader.dispose();
});
