import { CircleAlert, FolderPlus, LogIn } from "lucide-react";
import { useEffect } from "react";
import { client } from "./client.ts";
import { ArchiveView } from "./components/archive.tsx";
import { Composer } from "./components/composer.tsx";
import { Palette } from "./components/palette.tsx";
import { Settings } from "./components/settings.tsx";
import { Sidebar } from "./components/sidebar.tsx";
import { ThreadView } from "./components/thread-view.tsx";
import { TitleBar } from "./components/titlebar.tsx";
import { useBinding } from "./keys.ts";
import {
	addProject,
	goBack,
	navigate,
	selectPreferences,
	selectProjects,
	setPaletteOpen,
	setSidebarOpen,
	showNew,
	useStore,
} from "./store.ts";

/** Onboarding (section 9.12): sign in, add a folder, then the composer. */
function NewThread({ cwd }: { cwd?: string }) {
	const accounts = useStore((s) => s.accounts);
	const models = useStore((s) => s.models);
	const projects = useStore(selectProjects);
	const signedOut = accounts !== undefined && accounts.accounts.length === 0 && models.length === 0;
	return (
		<div className="flex h-full min-w-0 flex-1 flex-col items-center justify-center px-6 pb-10">
			<h1 className="mb-8 text-[28px] font-medium tracking-tight">What should we build?</h1>
			{signedOut ? (
				<div className="mb-6 flex w-full max-w-3xl items-center gap-4 rounded-2xl border border-line bg-sidebar px-5 py-4">
					<LogIn size={18} className="shrink-0 text-muted" />
					<div className="flex-1">
						<div>Sign in to a model provider to start.</div>
						<div className="text-[13px] text-muted">Sign-ins are shared with the KnightCode terminal.</div>
					</div>
					<button
						type="button"
						onClick={() => navigate({ kind: "settings", page: "models" })}
						className="rounded-lg bg-accent px-3 py-1.5 font-medium text-on-accent hover:bg-accent-hover"
					>
						Sign in
					</button>
				</div>
			) : null}
			{projects.length === 0 && !cwd ? (
				<button
					type="button"
					onClick={() => void addProject().then((path) => path && showNew(path))}
					className="mb-6 flex w-full max-w-3xl items-center gap-4 rounded-2xl border border-dashed border-line-strong px-5 py-4 text-left hover:bg-hover"
				>
					<FolderPlus size={18} className="shrink-0 text-muted" />
					<div>
						<div>Add a project folder</div>
						<div className="text-[13px] text-muted">KnightCode works in the folder you choose.</div>
					</div>
				</button>
			) : null}
			<Composer newCwd={cwd} />
		</div>
	);
}

function ServerBanner() {
	const server = useStore((s) => s.server);
	if (server.state === "ready") return null;
	if (server.state === "failed")
		return (
			<div className="flex items-center gap-2 border-b border-danger/30 bg-del-bg px-4 py-2 text-danger">
				<CircleAlert size={14} /> {server.message ?? "KnightCode stopped."}
				<button type="button" className="underline" onClick={() => navigate({ kind: "settings", page: "about" })}>
					Show logs
				</button>
			</div>
		);
	return (
		<div className="kc-pulse border-b border-line bg-elevated px-4 py-1.5 text-center text-[13px] text-muted">
			{server.state === "starting" ? "Starting KnightCode…" : "Reconnecting to KnightCode…"}
		</div>
	);
}

/** Resolve the theme preference onto <html> and the native caption buttons. */
function useTheme(): void {
	const { theme } = useStore(selectPreferences);
	useEffect(() => {
		const media = window.matchMedia("(prefers-color-scheme: dark)");
		const apply = () => {
			const dark = theme === "dark" || (theme === "system" && media.matches);
			document.documentElement.dataset.theme = dark ? "dark" : "light";
			void client.host("host/window/setTheme", { dark }).catch(() => {});
		};
		apply();
		media.addEventListener("change", apply);
		return () => media.removeEventListener("change", apply);
	}, [theme]);
}

export function App() {
	const view = useStore((s) => s.view);
	const toasts = useStore((s) => s.toasts);
	const sidebarOpen = useStore((s) => s.sidebarOpen);
	const paletteOpen = useStore((s) => s.paletteOpen);
	useTheme();
	useBinding("desktop.thread.new", () => showNew());
	useBinding("desktop.project.open", () => void addProject());
	useBinding("desktop.sidebar.toggle", () => setSidebarOpen(!sidebarOpen));
	useBinding("desktop.palette", () => setPaletteOpen(!paletteOpen));
	useBinding("desktop.settings", () => navigate({ kind: "settings", page: "general" }));
	useBinding("desktop.nav.back", () => goBack(-1));
	useBinding("desktop.nav.forward", () => goBack(1));
	return (
		<div className="flex h-full flex-col bg-shell">
			<TitleBar />
			<ServerBanner />
			<div className="flex min-h-0 flex-1">
				{sidebarOpen ? <Sidebar /> : null}
				<main className="flex min-w-0 flex-1 bg-surface">
					{view.kind === "thread" ? (
						<ThreadView key={view.id} id={view.id} />
					) : view.kind === "settings" ? (
						<Settings page={view.page} />
					) : view.kind === "archive" ? (
						<ArchiveView />
					) : (
						<NewThread cwd={view.cwd} />
					)}
				</main>
			</div>
			{paletteOpen ? <Palette /> : null}
			<div className="pointer-events-none fixed right-4 bottom-4 z-50 space-y-2">
				{toasts.map((t) => (
					<div
						key={t.id}
						className="pointer-events-auto max-w-sm rounded-xl border border-line-strong bg-elevated px-3.5 py-2.5 text-[13px] shadow-xl"
					>
						{t.text}
					</div>
				))}
			</div>
		</div>
	);
}
