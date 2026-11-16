/** Install the public renderer bindings, then synchronously register built-ins before first paint. */
import type { experimental_CommandContext, experimental_DesktopHost } from "@knightcodeai/cli/desktop";
import { createElement } from "react";
import commands from "../builtins/commands/index.ts";
import feedback from "../builtins/feedback/index.tsx";
import layout from "../builtins/layout/index.tsx";
import navigation from "../builtins/navigation/index.tsx";
import threadList, { SharedThreadRow } from "../builtins/thread-list/index.tsx";
import home from "../builtins/home/index.tsx";
import titleBar from "../builtins/title-bar/index.tsx";
import { controls, shellServices, useNavigation, useThreadList } from "./shell-bindings.tsx";
import { HostContent, Slots, StructuralSurface } from "./structural.tsx";
import { Button, Kbd } from "../components/button.tsx";
import * as icons from "../components/icons.tsx";
import { bindingLabel } from "../keys.ts";
import { useStore } from "../store.ts";
import { controllers } from "./controllers.ts";
import { desktopExtensions } from "./runtime.ts";
import { OwnedPortal } from "./surface.tsx";
import { startExternalExtensions } from "./external.ts";
import { useCommandContext } from "./command-context.ts";
import { NativeExtensionRecovery } from "./settings.tsx";

export function initializeDesktopExtensions(): () => void {
	const host: experimental_DesktopHost = {
		experimental_controllers: controllers,
		experimental_useNavigation: useNavigation,
		experimental_useThreadList: useThreadList,
		experimental_useUpdate: () => useStore((s) => s.update),
		experimental_controls: controls,
		experimental_shellServices: shellServices,
		experimental_icons: icons,
		experimental_SurfaceHost: (props) => createElement(StructuralSurface, props),
		experimental_Content: () => createElement(HostContent),
		experimental_Slots: (props) => createElement(Slots, props),
		experimental_ThreadRow: (props) => createElement(SharedThreadRow, props),
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
		desktopExtensions.register("builtin.layout", layout),
		desktopExtensions.register("builtin.navigation", navigation),
		desktopExtensions.register("builtin.thread-list", threadList),
		desktopExtensions.register("builtin.home", home),
		desktopExtensions.register("builtin.title-bar", titleBar),
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

/** Notices and the recovery notice are host-owned; only the presenter is replaceable. */
export function FeedbackSurface() {
	const context = useCommandContext();
	return (
		<>
			<StructuralSurface surface="feedback" />
			<NativeExtensionRecovery context={context} />
		</>
	);
}
