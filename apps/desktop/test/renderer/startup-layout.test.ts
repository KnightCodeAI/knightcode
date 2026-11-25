import { afterEach, expect, test, vi } from "vitest";
import { StartupLayout } from "../../src/renderer/extensions/startup-layout.ts";

const memory = () => {
	let value: string | null = null;
	return {
		getItem: () => value,
		setItem: (_key: string, next: string) => {
			value = next;
		},
		removeItem: () => {
			value = null;
		},
	};
};
afterEach(() => vi.useRealTimers());

test("last-known providers and hidden rail entries are synchronous, and only the skeleton grace expires at 300ms", () => {
	vi.useFakeTimers();
	const storage = memory();
	const previous = new StartupLayout(storage, false);
	previous.update({ layout: "owner/layout" }, [{ owner: "owner", revision: "r1", target: "home" }]);
	previous.dispose();
	const startup = new StartupLayout(storage, false);
	expect(startup.getSnapshot()).toMatchObject({
		grace: true,
		providers: { layout: "owner/layout" },
		hidden: [{ target: "home" }],
	});
	vi.advanceTimersByTime(299);
	expect(startup.getSnapshot().grace).toBe(true);
	vi.advanceTimersByTime(1);
	expect(startup.getSnapshot()).toMatchObject({ grace: false, hidden: [{ target: "home" }] });
	startup.invalidateOwner("owner");
	expect(startup.getSnapshot().hidden).toEqual([]);
	expect(startup.getSnapshot().providers.layout).toBe("owner/layout");
	startup.dispose();
});

test("safe mode ignores cache and invalid persisted data is discarded", () => {
	const storage = memory();
	storage.setItem(
		"",
		JSON.stringify({
			version: 1,
			providers: { layout: "bad/layout" },
			hidden: [{ owner: "bad", revision: "r1", target: "home" }],
		}),
	);
	const safe = new StartupLayout(storage, true);
	expect(safe.getSnapshot()).toEqual({ grace: false, providers: {}, hidden: [] });
	safe.dispose();
	for (const value of [
		"broken",
		JSON.stringify({ version: 999 }),
		JSON.stringify({ version: 1, providers: {}, hidden: [{ owner: "bad", revision: "r", target: "recovery" }] }),
	]) {
		storage.setItem("", value);
		const invalid = new StartupLayout(storage, false);
		expect(invalid.getSnapshot().hidden).toEqual([]);
		invalid.dispose();
	}
});

test("authoritative inventory invalidates disabled, missing and changed revisions without clearing provider choice", () => {
	const storage = memory();
	const cache = new StartupLayout(storage, false);
	cache.update({ navigation: "owner/nav" }, [{ owner: "owner", revision: "r1", target: "home" }]);
	cache.reconcile({ navigation: "owner/nav" }, [{ owner: "owner", revision: "r2", enabled: true, approved: true }]);
	expect(cache.getSnapshot().hidden).toEqual([]);
	expect(cache.getSnapshot().providers.navigation).toBe("owner/nav");
	cache.update({}, [{ owner: "owner", revision: "r2", target: "profile" }]);
	cache.reconcile({}, [{ owner: "owner", revision: "r2", enabled: false, approved: true }]);
	expect(cache.getSnapshot().hidden).toEqual([]);
	cache.dispose();
});
