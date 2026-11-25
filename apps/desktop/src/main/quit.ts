/**
 * Quitting closes each window gracefully, which waits for the renderer's beforeunload handlers. A wedged renderer
 * (an external extension in an infinite loop) never answers, so quit and "Restart without extensions" would hang.
 * Windows still open after the deadline are destroyed.
 */

type ClosableWindow = {
	isDestroyed(): boolean;
	close(): void;
	destroy(): void;
	once(event: "closed", listener: () => void): unknown;
};

/** Close every window, destroying those that have not closed within `milliseconds`; both graceful and forced close waits are bounded. */
export async function closeAllWithin(windows: readonly ClosableWindow[], milliseconds: number): Promise<void> {
	const open = windows.filter((window) => !window.isDestroyed());
	const closed = open.map((window) => new Promise<void>((resolve) => window.once("closed", resolve)));
	for (const window of open) window.close();
	const allClosed = Promise.all(closed);
	const wait = async (duration: number) => {
		let timer: ReturnType<typeof setTimeout> | undefined;
		try {
			await Promise.race([
				allClosed,
				new Promise<void>((resolve) => {
					timer = setTimeout(resolve, duration);
				}),
			]);
		} finally {
			clearTimeout(timer);
		}
	};
	await wait(milliseconds);
	for (const window of open) if (!window.isDestroyed()) window.destroy();
	await wait(Math.min(250, milliseconds / 2));
}
