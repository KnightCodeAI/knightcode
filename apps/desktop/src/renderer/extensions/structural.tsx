/** Structural mounting remains host-owned; providers cannot replace recovery controls or native authority. */
import type { experimental_CommandContext, experimental_Surface, experimental_Thread } from "@knightcodeai/cli/desktop";
import { createContext, type ReactNode, useContext, useSyncExternalStore, Component } from "react";
import { Button } from "../components/button.tsx";
import { CircleAlert } from "../components/icons.tsx";
import { ThreadView } from "../components/thread-view.tsx";
import { navigate, selectProjects, useStore } from "../store.ts";
import { useCommandContext } from "./command-context.ts";
import { HomeSetup } from "./home-support.tsx";
import { externalState } from "./external.ts";
import { desktopExtensions } from "./runtime.ts";
import { SurfaceEntry, SurfaceHost } from "./surface.tsx";
import { startupLayout } from "./startup.ts";
import { STRUCTURAL_BUILTINS, type ProviderSurface } from "./providers.ts";
const Mounting = createContext<readonly string[]>([]);

class ViewBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
	state: { error?: Error } = {};

	static getDerivedStateFromError(error: Error) {
		return { error };
	}

	render() {
		const { error } = this.state;
		if (!error) return this.props.children;
		return (
			<div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
				<CircleAlert size={20} className="text-danger" />
				<p className="text-base text-ink">This view hit an error.</p>
				<p className="max-w-xl text-sm break-words text-secondary">{error.message}</p>
				<Button variant="surface" size="md" onClick={() => this.setState({ error: undefined })}>
					Try again
				</Button>
			</div>
		);
	}
}

/** Mount one named host. Recursive replacement falls back instead of recursively mounting itself. */
export function StructuralSurface({ surface, builtinOnly }: { surface: ProviderSurface; builtinOnly?: boolean }) {
	const context = useCommandContext();
	const preferences = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	const boot = useSyncExternalStore(startupLayout.subscribe, startupLayout.getSnapshot);
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const mounting = useContext(Mounting);
	const view = useStore((s) => s.view);
	const homeCwd = useStore((s) => (s.view.kind === "new" ? (s.view.cwd ?? selectProjects(s)[0]?.path) : undefined));
	// The recovery route keeps the built-in shell and column, whatever provider is chosen.
	const recovery = view.kind === "settings" && view.page === "extensions";
	if (surface === "threadList" && view.kind === "settings")
		return <StructuralSurface surface="settingsNav" builtinOnly={builtinOnly || recovery} />;
	const builtin = STRUCTURAL_BUILTINS[surface];
	const preferred =
		builtinOnly || mounting.includes(surface)
			? undefined
			: (preferences.window[surface] ?? preferences.app[surface] ?? boot.providers[surface]);
	const selected = desktopExtensions.resolveProvider(surface, builtin, preferred, context);
	const pending = boot.grace && !!preferred && preferred !== builtin && selected?.id !== preferred;
	return (
		<Mounting.Provider value={[...mounting, surface]}>
			<SurfaceHost
				registry={desktopExtensions}
				surface={surface}
				builtin={builtin}
				preferred={preferred}
				context={context}
				pending={pending}
			/>
			{surface === "home" && selected?.id !== builtin && !pending ? (
				<div data-kc-owner="host.trust" className="absolute top-16 right-8 left-8 z-20">
					<HomeSetup cwd={homeCwd} />
				</div>
			) : null}
		</Mounting.Provider>
	);
}

/** Ordered slots always retain their own contribution root, even inside another owner's layout. */
export function Slots({
	surface,
	thread,
	cwd,
	context: explicitContext,
}: {
	surface: experimental_Surface;
	thread?: experimental_Thread;
	cwd?: string;
	context?: experimental_CommandContext;
}) {
	const captured = useCommandContext();
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const context = explicitContext ?? {
		...captured,
		...(thread ? { row: thread, thread: { id: thread.id, cwd: thread.cwd }, cwd: thread.cwd } : {}),
		...(cwd ? { cwd } : {}),
	};
	return (
		<>
			{desktopExtensions.slots(surface, context).map((entry) => (
				<SurfaceEntry key={entry.sequence} entry={entry} context={context} />
			))}
		</>
	);
}

/** Content and recovery settings are selected from host navigation, not extension-local state. */
export function HostContent() {
	const view = useStore((s) => s.view);
	const context = useCommandContext();
	useSyncExternalStore(desktopExtensions.subscribe, desktopExtensions.getSnapshot);
	const page =
		view.kind === "page" ? desktopExtensions.pages(context).find((entry) => entry.id === view.id) : undefined;
	const key =
		view.kind === "thread" || view.kind === "page"
			? view.id
			: view.kind === "settings"
				? `settings:${view.page}`
				: view.kind;
	return (
		<ViewBoundary key={key}>
			{view.kind === "thread" ? (
				<ThreadView key={view.id} id={view.id} />
			) : view.kind === "settings" ? (
				<StructuralSurface surface="settings" builtinOnly={view.page === "extensions"} />
			) : view.kind === "page" ? (
				page ? (
					<SurfaceEntry entry={page} context={context} />
				) : (
					<div role="status" className="p-8">
						This page is unavailable.{" "}
						<Button onClick={() => navigate({ kind: "settings", page: "extensions" })}>Manage extensions</Button>
					</div>
				)
			) : (
				<StructuralSurface surface="home" />
			)}
		</ViewBoundary>
	);
}

/** Recovery settings bypass replacement layouts; a working management route is never optional. */
export function LayoutSurface() {
	const view = useStore((s) => s.view);
	if (view.kind === "settings" && view.page === "extensions") return <StructuralSurface surface="layout" builtinOnly />;
	return <StructuralSurface surface="layout" />;
}
