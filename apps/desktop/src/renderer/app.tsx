import { CircleAlert, Sparkles } from "lucide-react";
import { isMac, useBinding } from "./keys.ts";
import { Composer } from "./components/composer.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { ThreadView } from "./components/thread-view.tsx";
import { addProject, showNew, useStore } from "./store.ts";

function NewThread({ cwd }: { cwd?: string }) {
	return (
		<div className="flex h-full min-w-0 flex-1 flex-col">
			<div className={`drag h-10 shrink-0 ${isMac() ? "" : "pr-36"}`} />
			<div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-6">
				<Sparkles size={28} className="mb-4 text-accent" />
				<h1 className="mb-8 text-2xl font-medium tracking-tight">What should we build?</h1>
				<Composer newCwd={cwd} />
			</div>
		</div>
	);
}

function ServerBanner() {
	const server = useStore((s) => s.server);
	if (server.state === "ready") return null;
	if (server.state === "failed")
		return (
			<div className="flex items-center gap-2 border-b border-danger/30 bg-del-bg px-4 py-2 text-danger">
				<CircleAlert size={14} /> {server.message ?? "KnightCode stopped."} Check the app-server log in the logs folder.
			</div>
		);
	return (
		<div className="kc-pulse border-b border-line bg-elevated px-4 py-1.5 text-center text-[12px] text-muted">
			{server.state === "starting" ? "Starting KnightCode…" : "Reconnecting to KnightCode…"}
		</div>
	);
}

export function App() {
	const view = useStore((s) => s.view);
	const toasts = useStore((s) => s.toasts);
	useBinding("desktop.thread.new", () => showNew());
	useBinding("desktop.project.open", () => void addProject());
	return (
		<div className="flex h-full flex-col">
			<ServerBanner />
			<div className="flex min-h-0 flex-1">
				<Sidebar />
				<main className="flex min-w-0 flex-1 bg-surface">
					{view.kind === "thread" ? <ThreadView key={view.id} id={view.id} /> : <NewThread cwd={view.cwd} />}
				</main>
			</div>
			<div className="pointer-events-none fixed right-4 bottom-4 z-50 space-y-2">
				{toasts.map((t) => (
					<div
						key={t.id}
						className="pointer-events-auto max-w-sm rounded-lg border border-line-strong bg-elevated px-3 py-2 text-[12px] shadow-xl"
					>
						{t.text}
					</div>
				))}
			</div>
		</div>
	);
}
