/** Capture one render's command target so callbacks cannot resolve a later selection. */
import type { experimental_CommandContext } from "@knightcodeai/cli/desktop";
import { getState, useStore, type State } from "../store.ts";

/** Read the same page availability context used by rendered navigation. */
export function readCommandContext(): experimental_CommandContext {
	const state = getState();
	return contextFor(
		state.view,
		state.view.kind === "thread" ? state.held[state.view.id]?.thread : undefined,
		state.sidebarOpen,
	);
}

export function useCommandContext(): experimental_CommandContext {
	const view = useStore((s) => s.view);
	const thread = useStore((s) => (s.view.kind === "thread" ? s.held[s.view.id]?.thread : undefined));
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	return contextFor(view, thread, sidebarOpen);
}

function contextFor(
	view: State["view"],
	thread: State["held"][string]["thread"] | undefined,
	sidebarOpen: boolean,
): experimental_CommandContext {
	return {
		sidebarOpen,
		...(thread ? { thread: { id: thread.id, cwd: thread.cwd }, cwd: thread.cwd } : {}),
		...(view.kind === "new" && view.cwd ? { cwd: view.cwd } : {}),
	};
}
