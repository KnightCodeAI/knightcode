/** Capture one render's command target so callbacks cannot resolve a later selection. */
import type { experimental_CommandContext } from "@knightcodeai/cli/desktop";
import { useStore } from "../store.ts";

export function useCommandContext(): experimental_CommandContext {
	const view = useStore((s) => s.view);
	const thread = useStore((s) => (s.view.kind === "thread" ? s.held[s.view.id]?.thread : undefined));
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	return {
		sidebarOpen,
		...(thread ? { thread: { id: thread.id, cwd: thread.cwd }, cwd: thread.cwd } : {}),
		...(view.kind === "new" && view.cwd ? { cwd: view.cwd } : {}),
	};
}
