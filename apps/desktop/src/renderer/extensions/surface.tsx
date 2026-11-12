/** Contribution roots isolate render failures and retain original ownership without adding layout boxes. */
import type { experimental_CommandContext, experimental_Surface } from "@knightcodeai/cli/desktop";
import { Component, type ReactNode, useSyncExternalStore } from "react";
import { type ExtensionRegistry, type Registration, type SurfaceRegistration } from "./registry.ts";

export class ContributionBoundary extends Component<
	{ owner: string; children: ReactNode; fallback?: ReactNode },
	{ failed: boolean }
> {
	state = { failed: false };

	static getDerivedStateFromError() {
		return { failed: true };
	}

	componentDidCatch(error: Error): void {
		console.error(`Desktop contribution ${this.props.owner}`, error);
	}

	render() {
		return this.state.failed ? (this.props.fallback ?? null) : this.props.children;
	}
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
	return (
		<ContributionBoundary key={entry.sequence} owner={entry.owner} fallback={fallback}>
			<div data-kc-owner={entry.owner} style={{ display: "contents" }}>
				{children}
			</div>
		</ContributionBoundary>
	);
}

function SurfaceEntry({
	entry,
	context,
	fallback,
}: {
	entry: SurfaceRegistration;
	context: experimental_CommandContext;
	fallback?: ReactNode;
}) {
	const Render = entry.contribution.experimental_render;
	return (
		<ContributionRoot entry={entry} fallback={fallback}>
			<Render context={context} signal={entry.signal} />
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
}: {
	registry: ExtensionRegistry;
	surface: experimental_Surface;
	builtin: string;
	preferred?: string;
	context: experimental_CommandContext;
}) {
	useSyncExternalStore(registry.subscribe, registry.getSnapshot, registry.getSnapshot);
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
