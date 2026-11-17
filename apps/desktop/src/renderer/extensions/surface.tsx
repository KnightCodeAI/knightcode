/** Contribution roots isolate render failures and retain original ownership without adding layout boxes. */
import type { experimental_CommandContext, experimental_Surface } from "@knightcodeai/cli/desktop";
import {
	Component,
	type ComponentType,
	createContext,
	type CSSProperties,
	type ReactNode,
	useContext,
	useLayoutEffect,
	useState,
	useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import { retainRevisionStyles } from "./styles.ts";
import { type ExtensionRegistry, type Registration, type SurfaceRegistration } from "./registry.ts";

export class ContributionBoundary extends Component<
	{ owner: string; children: ReactNode; fallback?: ReactNode; onError?(error: Error): void },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error): void {
		console.error(`Desktop contribution ${this.props.owner}`, error);
		this.props.onError?.(error);
	}

	render() {
		return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
	}
}

const Ownership = createContext<Registration | undefined>(undefined);
const OWNED_BASE: CSSProperties = {
	all: "initial",
	display: "contents",
	color: "var(--kc-text)",
	font: "400 var(--kc-size-ui)/1.5 var(--kc-font-ui)",
	colorScheme: "inherit",
};

/** An out-of-tree portal keeps the contribution's original ownership, theme and mount lifetime. */
export function OwnedPortal({ children }: { children: ReactNode }) {
	const entry = useContext(Ownership);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		if (!entry) return;
		const root = document.createElement("div");
		root.dataset.kcOwner = entry.owner;
		if (entry.revision) root.dataset.kcRevision = entry.revision;
		Object.assign(root.style, OWNED_BASE);
		document.body.append(root);
		const release = retainRevisionStyles(entry.owner, entry.revision);
		setContainer(root);
		return () => {
			root.remove();
			release();
		};
	}, [entry]);
	if (!entry) throw new Error("experimental_Portal must be rendered inside a desktop contribution.");
	return container ? createPortal(children, container) : null;
}

/** Mark each actual overlay root; the overlay library still owns presence, focus and portal mounting. */
export function usePortalOwnership(): { "data-kc-owner"?: string; "data-kc-revision"?: string } {
	const entry = useContext(Ownership);
	return { "data-kc-owner": entry?.owner, "data-kc-revision": entry?.revision };
}

/** Use for each individual command/slot/provider, not for its surrounding replacement's owner. */
export function ContributionRoot({
	entry,
	children,
	fallback,
}: {
	entry: Registration;
	children: ReactNode;
	fallback?: ReactNode;
}) {
	const parent = useContext(Ownership);
	useLayoutEffect(() => retainRevisionStyles(entry.owner, entry.revision), [entry]);
	return (
		<Ownership.Provider value={entry}>
			<ContributionBoundary key={entry.sequence} owner={entry.owner} fallback={fallback} onError={entry.reportError}>
				<div
					data-kc-owner={entry.owner}
					data-kc-revision={entry.revision}
					style={entry.revision || (parent && parent.owner !== entry.owner) ? OWNED_BASE : { display: "contents" }}
				>
					{children}
				</div>
			</ContributionBoundary>
		</Ownership.Provider>
	);
}

export function SurfaceEntry({
	entry,
	context,
	fallback,
	wrap: Wrap,
}: {
	entry: SurfaceRegistration;
	context: experimental_CommandContext;
	fallback?: ReactNode;
	wrap?: ComponentType<{ children: ReactNode }>;
}) {
	const Render = entry.contribution.experimental_render;
	return (
		<ContributionRoot entry={entry} fallback={fallback}>
			{Wrap ? (
				<Wrap>
					<Render context={context} signal={entry.signal} />
				</Wrap>
			) : (
				<Render context={context} signal={entry.signal} />
			)}
		</ContributionRoot>
	);
}

/** Default to the named built-in; a failed chosen provider remounts that built-in and leaves choice untouched. */
export function SurfaceHost({
	registry,
	surface,
	builtin,
	preferred,
	context,
	pending,
}: {
	registry: ExtensionRegistry;
	surface: experimental_Surface;
	builtin: string;
	preferred?: string;
	context: experimental_CommandContext;
	pending?: boolean;
}) {
	useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
	if (pending)
		return (
			<div
				role="status"
				aria-label={`Loading ${surface}`}
				data-kc-skeleton={surface}
				className="min-h-0 flex-1 bg-shell"
				style={
					surface === "titleBar"
						? { height: 36, flex: "none" }
						: surface === "navigation"
							? { width: 52, flex: "none" }
							: undefined
				}
			/>
		);
	const fallback = registry.resolveProvider(surface, builtin, undefined, context);
	const selected = registry.resolveProvider(surface, builtin, preferred, context);
	const unavailable = <div role="status">The built-in {surface} view is unavailable.</div>;
	const builtInView = fallback ? (
		<SurfaceEntry entry={fallback} context={context} fallback={unavailable} />
	) : (
		unavailable
	);
	return (
		<>
			{selected ? (
				<SurfaceEntry
					key={selected.sequence}
					entry={selected}
					context={context}
					fallback={selected === fallback ? unavailable : builtInView}
				/>
			) : (
				unavailable
			)}
			{registry.slots(surface, context).map((entry) => (
				<SurfaceEntry key={entry.sequence} entry={entry} context={context} />
			))}
		</>
	);
}
