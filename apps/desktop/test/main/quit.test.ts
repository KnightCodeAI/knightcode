/** A wedged renderer cannot block quitting: windows that do not close within the deadline are destroyed. */
import { Compile } from "typebox/compile";
import { expect, test, vi } from "vitest";
import { closeAllWithin } from "../../src/main/quit.ts";
import { AppCommand } from "../../src/shared/host-protocol.ts";

test("Restart without extensions is a host app command, so the Windows in-app View menu can reach it", () => {
	// On Windows the native menu bar is hidden (titleBarStyle: "hidden"); the renderer menu sends this command.
	expect(Compile(AppCommand).Check("restartSafe")).toBe(true);
});

function fakeWindow(responsive: boolean) {
	const closed = new Set<() => void>();
	let destroyed = false;
	const window = {
		isDestroyed: () => destroyed,
		close: vi.fn(() => {
			// A responsive renderer answers beforeunload and the window closes; a wedged one never answers.
			if (responsive) window.destroy();
		}),
		destroy: vi.fn(() => {
			if (destroyed) return;
			destroyed = true;
			for (const listener of closed) listener();
		}),
		once: (_event: "closed", listener: () => void) => {
			closed.add(listener);
		},
	};
	return window;
}

test("responsive windows close normally and nothing is destroyed", async () => {
	vi.useFakeTimers();
	const windows = [fakeWindow(true), fakeWindow(true)];
	const done = closeAllWithin(windows, 3000);
	await vi.advanceTimersByTimeAsync(0);
	await done;
	for (const window of windows) {
		expect(window.close).toHaveBeenCalledOnce();
		expect(window.destroy).toHaveBeenCalledOnce(); // the fake's own close path
	}
	vi.useRealTimers();
});

test("a wedged window is destroyed after the deadline, a responsive one is not forced", async () => {
	vi.useFakeTimers();
	const responsive = fakeWindow(true);
	const wedged = fakeWindow(false);
	let settled = false;
	const done = closeAllWithin([responsive, wedged], 3000).then(() => {
		settled = true;
	});
	await vi.advanceTimersByTimeAsync(2999);
	expect(settled).toBe(false);
	expect(wedged.isDestroyed()).toBe(false);
	await vi.advanceTimersByTimeAsync(1);
	await done;
	expect(wedged.isDestroyed()).toBe(true);
	expect(responsive.destroy).toHaveBeenCalledOnce();
	vi.useRealTimers();
});

test("already destroyed windows are skipped", async () => {
	const gone = fakeWindow(true);
	gone.destroy();
	gone.destroy.mockClear();
	await closeAllWithin([gone], 3000);
	expect(gone.close).not.toHaveBeenCalled();
	expect(gone.destroy).not.toHaveBeenCalled();
});
