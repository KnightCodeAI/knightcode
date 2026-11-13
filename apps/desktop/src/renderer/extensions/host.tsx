/** Install the public renderer bindings, then synchronously register built-ins before first paint. */
import type { experimental_CommandContext, experimental_DesktopHost } from "@knightcodeai/cli/desktop";
import { createElement, useSyncExternalStore } from "react";
import commands from "../builtins/commands/index.ts";
import feedback from "../builtins/feedback/index.tsx";
import { Button, Kbd } from "../components/button.tsx";
import * as icons from "../components/icons.tsx";
import { bindingLabel } from "../keys.ts";
import {
	addProject,
	dismissToast,
	navigate,
	newTerminal,
	setSidebarOpen,
	showNew,
	toast,
	toggleTerminal,
	useStore,
} from "../store.ts";
import { desktopExtensions } from "./runtime.ts";
import { OwnedPortal, SurfaceHost } from "./surface.tsx";
import { externalState, startExternalExtensions } from "./external.ts";
import { NativeExtensionRecovery } from "./settings.tsx";

export function initializeDesktopExtensions(): () => void {
	const host: experimental_DesktopHost = {
		experimental_controllers: {
			experimental_showNew: showNew,
			experimental_addProject: addProject,
			experimental_setSidebarOpen: setSidebarOpen,
			experimental_showSettings: (page) => navigate({ kind: "settings", page }),
			experimental_toggleTerminal: ({ id, cwd }) => toggleTerminal(id, cwd),
			experimental_newTerminal: ({ id, cwd }) => newTerminal(id, cwd),
			experimental_notify: toast,
			experimental_dismissToast: dismissToast,
		},
		experimental_useToasts: () => useStore((s) => s.toasts),
		experimental_Icon: ({ name, ...props }) => createElement(icons[name], props),
		experimental_Button: (props) => createElement(Button, props),
		experimental_KeybindingKeys: ({ binding }) => createElement(Kbd, { children: bindingLabel(binding) }),
		experimental_Portal: (props) => createElement(OwnedPortal, props),
	};
	globalThis.__knightcodeDesktop = host;
	const handles = [
		desktopExtensions.register("builtin.commands", commands),
		desktopExtensions.register("builtin.feedback", feedback),
	];
	const disposeExternal = startExternalExtensions(desktopExtensions);
	const dispose = () => {
		disposeExternal();
		for (const handle of handles) handle.dispose();
		if (globalThis.__knightcodeDesktop === host) globalThis.__knightcodeDesktop = undefined;
		window.removeEventListener("pagehide", dispose);
	};
	window.addEventListener("pagehide", dispose, { once: true });
	return dispose;
}

/** Capture targets for this render; callbacks keep that target instead of reading a later selection. */
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

export function FeedbackSurface() {
	const context = useCommandContext();
	const providers = useSyncExternalStore(externalState.subscribe, externalState.getProviders);
	const preferred = providers.window.feedback ?? providers.app.feedback;
	return (
		<>
			<SurfaceHost
				registry={desktopExtensions}
				surface="feedback"
				builtin="builtin.feedback/toasts"
				preferred={preferred}
				context={context}
			/>
			<NativeExtensionRecovery context={context} />
		</>
	);
}
