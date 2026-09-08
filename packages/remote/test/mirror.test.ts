import { describe, expect, test } from "vitest";
import { Mirror, type MirrorSource } from "../src/mirror.ts";

function entry(id: string): unknown {
	return {
		type: "message",
		id,
		parentId: null,
		timestamp: "2026-09-07T00:00:00.000Z",
		message: { role: "user", content: [{ type: "text", text: id }] },
	};
}

function source(entries: unknown[]): MirrorSource & { calls: number } {
	return {
		calls: 0,
		cwd: "/repo",
		model: "anthropic/claude",
		getEntries() {
			this.calls += 1;
			return entries;
		},
		getLeafId: () => "leaf",
		getSessionName: () => "my session",
	};
}

describe("mirror", () => {
	test("emits a snapshot first, then only appended entries", () => {
		const entries = [entry("a")];
		const state = source(entries);
		const mirror = new Mirror();

		const first = mirror.drain(state);
		expect(first).toHaveLength(1);
		expect(first[0].type).toBe("snapshot");

		expect(mirror.drain(state)).toEqual([]);

		entries.push(entry("b"));
		const second = mirror.drain(state);
		expect(second).toHaveLength(1);
		expect(second[0]).toMatchObject({ type: "entries" });
		expect((second[0] as { entries: Array<{ id: string }> }).entries.map((e) => e.id)).toEqual(["b"]);
	});

	test("re-snapshots after being marked stale and resets the counter", () => {
		const entries = [entry("a"), entry("b")];
		const state = source(entries);
		const mirror = new Mirror();
		mirror.drain(state);

		mirror.markStale();
		expect(mirror.isStale()).toBe(true);

		const frames = mirror.drain(state);
		expect(frames[0].type).toBe("snapshot");
		expect(mirror.isStale()).toBe(false);
		expect(mirror.drain(state)).toEqual([]);
	});

	test("re-snapshots rather than diffing when the log shrinks onto another branch", () => {
		const entries = [entry("a"), entry("b"), entry("c")];
		const state = source(entries);
		const mirror = new Mirror();
		mirror.drain(state);

		// A tree move can leave fewer entries than before; counting alone would emit
		// nothing forever and the viewer would sit on a transcript that no longer exists.
		entries.length = 1;
		const frames = mirror.drain(state);
		expect(frames[0].type).toBe("snapshot");
	});

	test("strips images from mirrored entries", () => {
		const state = source([
			{
				type: "message",
				id: "i",
				parentId: null,
				timestamp: "t",
				message: { role: "user", content: [{ type: "image", data: "SECRET", mimeType: "image/png" }] },
			},
		]);
		const [snapshot] = new Mirror().drain(state);
		expect(JSON.stringify(snapshot)).not.toContain("SECRET");
	});

	test("carries the source's slash commands in the snapshot", () => {
		const state = { ...source([entry("a")]), getCommands: () => [{ name: "review", description: "Review" }] };
		const [snapshot] = new Mirror().drain(state);
		expect(snapshot).toMatchObject({ type: "snapshot", commands: [{ name: "review", description: "Review" }] });
	});

	test("builds a stream frame without touching the entry log", () => {
		const state = source([entry("a")]);
		const mirror = new Mirror();
		mirror.drain(state);
		const before = state.calls;

		expect(mirror.stream("m1", "partial")).toEqual({ v: 1, type: "stream", messageId: "m1", content: "partial" });
		expect(state.calls).toBe(before);
	});
});
