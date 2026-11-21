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
import type { ActivationState } from "./activation.ts";
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

/** Read the contribution whose lifetime owns the current render. */
export const useContributionOwner = () => useContext(Ownership);

/** The nearest theme preview; undefined follows the window theme. */
export type ThemeOverride = { theme: "light" | "dark"; tokens: Record<string, string> };
const ThemeContext = createContext<ThemeOverride | undefined>(undefined);

/** Provide a previewed theme to a subtree and to every owned portal or overlay opened inside it. */
export function ThemeProvider({ value, children }: { value: ThemeOverride; children: ReactNode }) {
	return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}
const builtInState: ActivationState = { phase: "live", finishingInput: false };
const builtInActivation = { subscribe: (_listener: () => void) => () => {}, getSnapshot: () => builtInState };

function useActivation(entry: Registration | undefined): ActivationState {
	const activation = entry?.activation ?? builtInActivation;
	return useSyncExternalStore(activation.subscribe, activation.getSnapshot, activation.getSnapshot);
}
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
	const theme = useContext(ThemeContext);
	const state = useActivation(entry);
	const gated = state.phase !== "live" || entry?.activation?.failure !== undefined;
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	useLayoutEffect(() => {
		if (!entry) return;
		const root = document.createElement("div");
		root.dataset.kcOwner = entry.owner;
		if (entry.revision) root.dataset.kcRevision = entry.revision;
		if (entry.activation) {
			root.dataset.kcEpoch = entry.activation.binding.epoch;
			root.dataset.kcMount = entry.activation.binding.mount;
			root.dataset.kcWindow = entry.activation.binding.window;
		}
		Object.assign(root.style, OWNED_BASE);
		document.body.append(root);
		const release = retainRevisionStyles(entry.owner, entry.revision);
		setContainer(root);
		const remove = () => root.remove();
		entry.signal.addEventListener("abort", remove, { once: true });
		return () => {
			entry.signal.removeEventListener("abort", remove);
			root.remove();
			release();
		};
	}, [entry]);
	useLayoutEffect(() => {
		if (container) container.inert = gated && !state.finishingInput;
	}, [container, gated, state.finishingInput]);
	// A preview's theme follows into the portal; without one the container inherits the window theme live.
	useLayoutEffect(() => {
		if (!container) return;
		if (theme) container.dataset.theme = theme.theme;
		for (const [name, value] of Object.entries(theme?.tokens ?? {})) container.style.setProperty(name, value);
		return () => {
			delete container.dataset.theme;
			for (const name of Object.keys(theme?.tokens ?? {})) container.style.removeProperty(name);
		};
	}, [container, theme]);
	if (!entry) throw new Error("experimental_Portal must be rendered inside a desktop contribution.");
	return container ? createPortal(children, container) : null;
}

/** Mark each actual overlay root; the overlay library still owns presence, focus and portal mounting. */
export function usePortalOwnership(): {
	"data-kc-owner"?: string;
	"data-kc-revision"?: string;
	"data-kc-epoch"?: string;
	"data-kc-mount"?: string;
	"data-theme"?: "light" | "dark";
	style?: CSSProperties;
} {
	const entry = useContext(Ownership);
	const theme = useContext(ThemeContext);
	return {
		"data-kc-owner": entry?.owner,
		"data-kc-revision": entry?.revision,
		"data-kc-epoch": entry?.activation?.binding.epoch,
		"data-kc-mount": entry?.activation?.binding.mount,
		"data-theme": theme?.theme,
		// A preview's derived tokens follow the overlay out of the preview's subtree.
		style: theme ? (theme.tokens as CSSProperties) : undefined,
	};
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
	const state = useActivation(entry);
	const gated = state.phase !== "live" || entry.activation?.failure !== undefined;
	useLayoutEffect(() => retainRevisionStyles(entry.owner, entry.revision), [entry]);
	return (
		<Ownership.Provider value={entry}>
			<ContributionBoundary
				key={entry.sequence}
				owner={entry.owner}
				fallback={fallback}
				onError={(error) => entry.reportError(error, fallback === undefined ? undefined : "fallback")}
			>
				{gated && (
					<div role="status" className="text-xs text-secondary">
						Updating extension…
					</div>
				)}
				<div
					inert={gated && !state.finishingInput}
					aria-busy={gated || undefined}
					data-kc-owner={entry.owner}
					data-kc-revision={entry.revision}
					data-kc-epoch={entry.activation?.binding.epoch}
					data-kc-window={entry.activation?.binding.window}
					data-kc-mount={entry.activation?.binding.mount}
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
	builtinOnly,
}: {
	registry: ExtensionRegistry;
	surface: experimental_Surface;
	builtin: string;
	preferred?: string;
	context: experimental_CommandContext;
	pending?: boolean;
	builtinOnly?: boolean;
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
	const fallback = registry.resolveProvider(surface, builtin, undefined, context, builtinOnly);
	const selected =
		builtinOnly || !preferred ? fallback : registry.resolveProvider(surface, builtin, preferred, context);
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
			{registry.slots(surface, context, builtinOnly).map((entry) => (
				<SurfaceEntry key={entry.sequence} entry={entry} context={context} />
			))}
		</>
	);
}
