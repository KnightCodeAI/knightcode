/** Backend handles retain their original epoch and settle cancellation without replaying writes. */
import { expect, test, vi } from "vitest";
import { Type } from "typebox";
import type { HostEvent } from "../../src/shared/host-protocol.ts";
const transport = vi.hoisted(() => ({ host: vi.fn(), onHostEvent: vi.fn() }));
vi.mock("../../src/renderer/client.ts", () => ({ client: transport }));
import { FrontendBackend } from "../../src/renderer/extensions/backend.ts";
const binding = { owner: "example", revision: "v1", epoch: "one", window: "server:1", mount: "one" };
const read = { id: "read", params: Type.Number(), result: Type.Number() };
const contracts = {
	methods: {
		read: { kind: "read" as const, params: Type.Number(), result: Type.Number() },
		write: { kind: "write" as const, params: Type.Number(), result: Type.Number() },
	},
	events: { tick: Type.Number() },
};
function fixture() {
	vi.resetAllMocks();
	let receive!: (event: HostEvent) => void;
	const off = vi.fn();
	transport.onHostEvent.mockImplementation((callback) => {
		receive = callback;
		return off;
	});
	const lifetime = new AbortController();
	let live = false;
	const backend = new FrontendBackend(binding, contracts, lifetime.signal, () => live);
	return {
		backend,
		lifetime,
		off,
		receive: (event: HostEvent) => receive(event),
		ready: () => {
			live = true;
		},
	};
}
test("preparation is inert; RPC checks both schemas and never routes a retired handle", async () => {
	const f = fixture();
	expect(await f.backend.experimental_call(read, 1)).toEqual({ status: "disconnected" });
	expect(transport.host).not.toHaveBeenCalled();
	f.ready();
	transport.host.mockResolvedValue({ status: "ok", value: 2 });
	expect(await f.backend.experimental_call(read, 1)).toEqual({ status: "ok", value: 2 });
	expect(transport.host.mock.calls[0]![1]).toMatchObject({ binding, method: "read", args: 1 });
	transport.host.mockResolvedValue({ status: "ok", value: "wrong" });
	expect(await f.backend.experimental_call(read, 1)).toMatchObject({ status: "error" });
	f.lifetime.abort();
	const calls = transport.host.mock.calls.length;
	expect(await f.backend.experimental_call(read, 1)).toEqual({ status: "disconnected" });
	expect(transport.host).toHaveBeenCalledTimes(calls);
});
test("cancelling an admitted write settles outcome-unknown and sends one cancellation, never a retry", async () => {
	const f = fixture();
	f.ready();
	transport.host.mockImplementation((method) =>
		method.endsWith("/call") ? new Promise(() => {}) : Promise.resolve({}),
	);
	const controller = new AbortController();
	const pending = f.backend.experimental_call({ ...read, id: "write" }, 1, controller.signal);
	controller.abort();
	expect(await pending).toEqual({ status: "outcome-unknown" });
	expect(transport.host.mock.calls.map(([method]) => method)).toEqual([
		"host/desktopExtension/call",
		"host/desktopExtension/cancel",
	]);
});
test("subscriptions check their schema and full binding and are removed once on abort", () => {
	const f = fixture();
	f.ready();
	transport.host.mockResolvedValue({ status: "subscribed" });
	const value = vi.fn();
	const subscription = f.backend.experimental_subscribe({ id: "tick", schema: Type.Number() }, value);
	const event: HostEvent = {
		event: "desktopExtension/event",
		payload: {
			windowId: 1,
			lifetime: "window",
			binding,
			id: transport.host.mock.calls[0]![1].id,
			event: "tick",
			value: 3,
		},
	};
	f.receive(event);
	expect(value).toHaveBeenCalledWith(3);
	f.receive({ ...event, payload: { ...event.payload, binding: { ...binding, mount: "new" }, value: 4 } });
	f.receive({ ...event, payload: { ...event.payload, value: "wrong" } });
	expect(value).toHaveBeenCalledTimes(1);
	f.lifetime.abort();
	subscription.dispose();
	expect(f.off).toHaveBeenCalledOnce();
	expect(transport.host.mock.calls.filter(([method]) => method.endsWith("/unsubscribe"))).toHaveLength(1);
});
