import type { ThreadSummary } from "@knightcode/app-server-protocol";
import { afterEach, expect, test, vi } from "vitest";
import { ListingPages } from "../../src/app-server/listing-pages.ts";

const summaries = (): ThreadSummary[] =>
	Array.from({ length: 120 }, (_, i) => ({
		id: String(i),
		cwd: "cwd",
		projectCwd: "cwd",
		name: `Thread ${i}`,
		status: "notLoaded",
		archived: false,
		updatedAt: "2026-10-11T00:00:00.000Z",
	}));
afterEach(() => vi.useRealTimers());
test("continuations use an immutable scan and never rescan after appends or edits", async () => {
	const pages = new ListingPages();
	const data = summaries();
	const scan = vi.fn(async () => data);
	const first = await pages.page({}, scan);
	expect(first.threads).toHaveLength(50);
	data[60].name = "changed";
	data[60].archived = true;
	data.unshift({ ...data[0], id: "new" });
	const second = await pages.page({ cursor: first.nextCursor }, scan);
	const third = await pages.page({ cursor: second.nextCursor }, scan);
	expect(scan).toHaveBeenCalledTimes(1);
	expect([...first.threads, ...second.threads, ...third.threads].map((t) => t.id)).toEqual(
		Array.from({ length: 120 }, (_, i) => String(i)),
	);
	expect(second.threads[10]).toMatchObject({ name: "Thread 60", archived: false });
	expect(third.nextCursor).toBeUndefined();
});

test("cursors bind filters, expire, and are bounded by LRU retention", async () => {
	vi.useFakeTimers({ toFake: ["Date"] });
	const pages = new ListingPages();
	const scan = async () => summaries();
	const first = await pages.page({ cwd: "a" }, scan);
	await expect(pages.page({ cursor: first.nextCursor, cwd: "b" }, scan)).rejects.toMatchObject({
		code: "invalidCursor",
	});
	await expect(pages.page({ cursor: first.nextCursor, cwd: "a", archived: true }, scan)).rejects.toMatchObject({
		code: "invalidCursor",
	});
	await expect(pages.page({ cursor: "malformed" }, scan)).rejects.toMatchObject({ code: "invalidCursor" });
	vi.setSystemTime(Date.now() + 5 * 60_000 + 1);
	await expect(pages.page({ cursor: first.nextCursor, cwd: "a" }, scan)).rejects.toMatchObject({
		code: "invalidCursor",
	});
	const oldest = await pages.page({}, scan);
	for (let i = 0; i < 32; i++) await pages.page({}, scan);
	await expect(pages.page({ cursor: oldest.nextCursor }, scan)).rejects.toMatchObject({ code: "invalidCursor" });
	pages.clear();
});
