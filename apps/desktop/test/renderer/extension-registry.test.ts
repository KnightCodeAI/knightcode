import {
	defineDesktopExtension,
	type experimental_CommandContext,
	type experimental_DesktopApp,
} from "@knightcodeai/cli/desktop";
import { expect, test, vi } from "vitest";
import { ExtensionRegistry } from "../../src/renderer/extensions/registry.ts";

const context: experimental_CommandContext = { sidebarOpen: true };
const command = (id: string, order = 0) => ({ id, order, label: () => id, experimental_run: () => {} });

test("declarations stay inert until registration, then publish once in order, owner and registration order", () => {
	const registry = new ExtensionRegistry();
	const changed = vi.fn();
	registry.subscribe(changed);
	const setup = vi.fn((app: experimental_DesktopApp) => {
		app.experimental_registerCommand(command("second"));
		app.experimental_registerCommand(command("first"));
	});
	const extension = defineDesktopExtension(setup);
	expect(setup).not.toHaveBeenCalled();
	registry.register("z", extension);
	registry.register(
		"a",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand(command("normal"));
			app.experimental_registerCommand(command("early", -1));
		}),
	);
	expect(registry.commands(context).map((entry) => entry.id)).toEqual(["a/early", "a/normal", "z/second", "z/first"]);
	expect(changed).toHaveBeenCalledTimes(2);
});

test("duplicate ids across kinds reject the whole set without publishing and clean up setup", () => {
	const registry = new ExtensionRegistry();
	const cleanup = vi.fn();
	const changed = vi.fn();
	registry.subscribe(changed);
	expect(() =>
		registry.register(
			"bad",
			defineDesktopExtension((app) => {
				app.experimental_onDispose(cleanup);
				app.experimental_registerCommand(command("same"));
				app.experimental_registerSlot({ id: "same", surface: "feedback", experimental_render: () => null });
			}),
		),
	).toThrow(/duplicate.*bad\/same/i);
	expect(registry.getSnapshot()).toEqual([]);
	expect(changed).not.toHaveBeenCalled();
	expect(cleanup).toHaveBeenCalledOnce();
});

test("duplicate owners cannot replace a published set", () => {
	const registry = new ExtensionRegistry();
	const extension = defineDesktopExtension((app) => {
		app.experimental_registerCommand(command("one"));
	});
	registry.register("owner", extension);
	expect(() => registry.register("owner", extension)).toThrow(/owner/i);
	expect(registry.commands(context).map((entry) => entry.id)).toEqual(["owner/one"]);
});

test("unsupported apiVersion rejects before setup or publication", () => {
	const registry = new ExtensionRegistry();
	const setup = vi.fn();
	expect(() => registry.register("future", defineDesktopExtension(setup, { apiVersion: 2 }))).toThrow(/apiVersion/);
	expect(setup).not.toHaveBeenCalled();
	expect(registry.getSnapshot()).toEqual([]);
});

test("disposal is idempotent, aborts async work, removes entries and continues after a throwing disposer", () => {
	const errors = vi.fn();
	const registry = new ExtensionRegistry(errors);
	const cleanup = vi.fn();
	let signal!: AbortSignal;
	const handle = registry.register(
		"owner",
		defineDesktopExtension((app) => {
			signal = app.experimental_signal;
			app.experimental_registerCommand(command("one"));
			app.experimental_onDispose(cleanup);
			app.experimental_onDispose(() => {
				throw new Error("cleanup failed");
			});
		}),
	);
	handle.dispose();
	handle.dispose();
	expect(signal.aborted).toBe(true);
	expect(registry.getSnapshot()).toEqual([]);
	expect(cleanup).toHaveBeenCalledOnce();
	expect(errors).toHaveBeenCalledWith("owner", expect.objectContaining({ message: "cleanup failed" }));
	registry.register(
		"owner",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand(command("two"));
		}),
	);
	handle.dispose();
	expect(registry.commands(context).map((entry) => entry.id)).toEqual(["owner/two"]);
});

test("registration handles dispose individual entries before or after publication", () => {
	const registry = new ExtensionRegistry();
	let remove!: () => void;
	registry.register(
		"owner",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand(command("staged")).dispose();
			const handle = app.experimental_registerCommand(command("live"));
			remove = () => handle.dispose();
		}),
	);
	expect(registry.commands(context).map((entry) => entry.id)).toEqual(["owner/live"]);
	remove();
	remove();
	expect(registry.getSnapshot()).toEqual([]);
});

test("disposing an individual registration aborts only its async work", () => {
	const registry = new ExtensionRegistry();
	let remove!: () => void;
	registry.register(
		"owner",
		defineDesktopExtension((app) => {
			const first = app.experimental_registerCommand(command("first"));
			remove = () => first.dispose();
			app.experimental_registerCommand(command("second"));
		}),
	);
	const [first, second] = registry.commands(context);
	remove();
	expect(first!.signal.aborted).toBe(true);
	expect(second!.signal.aborted).toBe(false);
});

test("setup failure rolls back registrations and cleanup; retained registration callbacks cannot publish later", () => {
	const registry = new ExtensionRegistry();
	const cleanup = vi.fn();
	let late!: () => void;
	expect(() =>
		registry.register(
			"bad",
			defineDesktopExtension((app) => {
				app.experimental_onDispose(cleanup);
				late = () => {
					app.experimental_registerCommand(command("late"));
				};
				app.experimental_registerCommand(command("one"));
				throw new Error("setup failed");
			}),
		),
	).toThrow("setup failed");
	expect(cleanup).toHaveBeenCalledOnce();
	expect(late).toThrow(/closed/i);
	expect(registry.getSnapshot()).toEqual([]);
});

test("commands receive the supplied context, availability and signal; disposed commands cannot run", () => {
	const registry = new ExtensionRegistry();
	const run = vi.fn();
	const handle = registry.register(
		"owner",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand({
				...command("one"),
				experimental_available: (ctx) => !!ctx.thread,
				experimental_run: run,
			});
		}),
	);
	expect(registry.commands(context)).toEqual([]);
	const explicit = { ...context, thread: { id: "A", cwd: "/A" } };
	const entry = registry.commands(explicit)[0]!;
	registry.runCommand(entry, explicit);
	expect(run).toHaveBeenCalledWith(explicit, entry.signal);
	handle.dispose();
	registry.runCommand(entry, { ...context, thread: { id: "B", cwd: "/B" } });
	expect(run).toHaveBeenCalledOnce();
});

test("a throwing command label is contained instead of crashing the palette", () => {
	const report = vi.fn();
	const registry = new ExtensionRegistry(report);
	registry.register(
		"bad",
		defineDesktopExtension((app) => {
			app.experimental_registerCommand({
				...command("one"),
				label: () => {
					throw new Error("bad label");
				},
			});
		}),
	);
	expect(registry.commandLabel(registry.commands(context)[0]!, context)).toBeUndefined();
	expect(report).toHaveBeenCalledWith("bad", expect.objectContaining({ message: "bad label" }));
});

test("provider default ignores import order; missing and unavailable choices fall back without changing preference", () => {
	for (const owners of [
		["external", "builtin"],
		["builtin", "external"],
	]) {
		const registry = new ExtensionRegistry();
		for (const owner of owners)
			registry.register(
				owner,
				defineDesktopExtension((app) => {
					app.experimental_registerProvider({ id: "toasts", surface: "feedback", experimental_render: () => null });
				}),
			);
		registry.register(
			"unavailable",
			defineDesktopExtension((app) => {
				app.experimental_registerProvider({
					id: "toasts",
					surface: "feedback",
					experimental_available: () => false,
					experimental_render: () => null,
				});
			}),
		);
		const preference = { provider: "missing/toasts" };
		for (const preferred of [undefined, preference.provider, "unavailable/toasts"])
			expect(registry.resolveProvider("feedback", "builtin/toasts", preferred, context)?.id).toBe("builtin/toasts");
		expect(preference.provider).toBe("missing/toasts");
		expect(registry.resolveProvider("feedback", "builtin/toasts", "external/toasts", context)?.id).toBe(
			"external/toasts",
		);
	}
});
