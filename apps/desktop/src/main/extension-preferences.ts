/** Explicit app provider choices persist in desktop-state; window overrides survive renderer reload only. */
import type { DesktopProviderPreferences } from "../shared/desktop-extensions.ts";
import type { StateFile } from "./state.ts";

export class ExtensionProviderPreferences {
	private readonly state: StateFile;
	private readonly windows = new Map<number, Record<string, string>>();
	constructor(state: StateFile) {
		this.state = state;
	}

	read(windowId: number): DesktopProviderPreferences {
		return { app: this.state.read().desktopProviders ?? {}, window: this.windows.get(windowId) ?? {} };
	}

	set(surface: string, provider: string, scope: "app" | "window", windowId: number): void {
		if (scope === "app") this.state.setDesktopProvider(surface, provider);
		else {
			const providers = { ...this.windows.get(windowId) };
			if (provider) providers[surface] = provider;
			else delete providers[surface];
			this.windows.set(windowId, providers);
		}
	}

	releaseWindow(windowId: number): void {
		this.windows.delete(windowId);
	}
}
