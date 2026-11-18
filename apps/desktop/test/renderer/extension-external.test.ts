/** Real renderer phase/resource code with a native-port and module-delivery boundary, not packaged ESM acceptance. */
import type { DesktopExtensionPhase } from "@knightcode/app-server-protocol";
import type { HostEvent } from "../../src/shared/host-protocol.ts";
import { expect, test, vi } from "vitest";

type Script = { type: string; crossOrigin: string; src: string; onerror?: () => void; remove(): void };
const bridge = vi.hoisted(() => {
	const events = new Set<(event: HostEvent) => void>();
	const leases = new Set<string>();
	const acknowledgements = new Map<string, Record<string, unknown>>();
	const waiting = new Map<string, (ack: Record<string, unknown>) => void>();
	const scripts: string[] = [];
	const node = () => ({ type: "", crossOrigin: "", src: "", remove() {} });
	Object.assign(globalThis, {
		window: { addEventListener() {}, removeEventListener() {} },
		document: {
			createElement: node,
			head: {
				append(script: Script) {
					scripts.push(script.src);
					queueMicrotask(() => {
						const activation = new URL(script.src).searchParams.get("activation");
						if (!activation || !leases.has(activation)) {
							script.onerror?.();
							return;
						}
						globalThis.__knightcodeDesktopLoaded?.(activation, { apiVersion: 1, experimental_setup() {} });
					});
				},
			},
		},
	});
	return {
		events,
		leases,
		scripts,
		async host(method: string, params: Record<string, unknown>) {
			if (method === "host/desktopExtension/list")
				return { safeMode: false, extensions: [], providers: { app: {}, window: {} } };
			if (method === "host/desktopExtension/acquire") {
				if (typeof params.lease !== "string") throw new Error("Malformed lease at the test native boundary");
				leases.add(params.lease);
			}
			if (method === "host/desktopExtension/release" && typeof params.lease === "string") leases.delete(params.lease);
			if (method === "host/desktopExtension/ack" && typeof params.id === "string") {
				acknowledgements.set(params.id, params);
				waiting.get(params.id)?.(params);
				waiting.delete(params.id);
			}
			return {};
		},
		ack(id: string): Promise<Record<string, unknown>> {
			const ack = acknowledgements.get(id);
			return ack
				? Promise.resolve(ack)
				: new Promise((resolve) => {
						waiting.set(id, resolve);
					});
		},
	};
});
vi.mock("../../src/renderer/client.ts", () => ({
	client: {
		host: bridge.host,
		onNotification: () => () => {},
		onServerRequest: () => () => {},
		onHostEvent: (handler: (event: HostEvent) => void) => {
			bridge.events.add(handler);
			return () => {
				bridge.events.delete(handler);
			};
		},
	},
	RequestError: class extends Error {},
}));
import { initializeDesktopExtensions } from "../../src/renderer/extensions/host.tsx";

function send(phase: DesktopExtensionPhase) {
	for (const handler of bridge.events) handler({ event: "desktopExtension/phase", phase });
	return bridge.ack(phase.id);
}

test("unchanged-file reactivation gets a new admitted module lease even while the same revision's CSS is retained", async () => {
	const dispose = initializeDesktopExtensions();
	const revision = "a".repeat(64);
	const identity = { windowId: 1, lifetime: "native-port" };
	const binding = { owner: "example", revision, epoch: "one", window: "server:1", mount: "one" };
	const artifact = { owner: "example", revision, root: "/cache", frontend: "app.js", styles: [], files: ["app.js"] };
	const contracts = { methods: {}, events: {} };
	try {
		const first = await send({ ...identity, id: "prepare-one", phase: "prepare", binding, artifact, contracts });
		expect(first.error).toBeUndefined();
		for (const phase of ["quiesce", "publish", "resume"] as const)
			expect((await send({ ...identity, id: `${phase}-one`, phase, binding })).error).toBeUndefined();
		for (const handler of bridge.events)
			handler({
				event: "desktopExtension/phase",
				phase: { ...identity, id: "ready-one", phase: "ready", binding, artifact, contracts },
			});
		const next = { ...binding, epoch: "two", mount: "two" };
		expect(
			(await send({ ...identity, id: "prepare-two", phase: "prepare", binding: next, artifact, contracts })).error,
		).toBeUndefined();
		expect(bridge.scripts).toHaveLength(2);
		expect(bridge.scripts[0]).not.toBe(bridge.scripts[1]);
	} finally {
		dispose();
	}
});
