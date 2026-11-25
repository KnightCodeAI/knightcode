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
import conversation from "../builtins/conversation/index.tsx";
import threadHeader from "../builtins/thread-header/index.tsx";
import workspace from "../builtins/workspace/index.ts";
import requests from "../builtins/requests/index.tsx";
import { conversationServices, ItemRenderer, MessageActions } from "./conversation.tsx";
import composer, { ComposerFrame } from "../builtins/composer/index.tsx";
import { TextareaEditor } from "../builtins/composer/editor.tsx";
import { ComposerRoot, ComposerContributions, useComposer, useComposerEditor } from "./composer-root.tsx";
import { client } from "../client.ts";
import { controls, shellServices, useNavigation, useThreadList, pickerServices } from "./shell-bindings.tsx";
import { HostContent, Slots, StructuralSurface } from "./structural.tsx";
import { Button, Kbd } from "../components/button.tsx";
import * as icons from "../components/icons.tsx";
import { bindingLabel } from "../keys.ts";
import { composerDraftOf, useStore } from "../store.ts";
import { composerController, composerKey, mountEditor } from "./composer-controller.ts";
import { controllers } from "./controllers.ts";
import { desktopExtensions } from "./runtime.ts";
import { OwnedPortal } from "./surface.tsx";
import { startExternalExtensions } from "./external.ts";
import { useCommandContext } from "./command-context.ts";
import { panelServices } from "./panel.tsx";
import { OperationRecovery, startWorkspaceOperations, workspaceServices } from "./workspace.ts";
import { NativeExtensionRecovery } from "./settings.tsx";
import {
	appearance,
	settingsControls,
	SettingsSections,
	settingsServices,
	startZoomFeedback,
	ThemeScope,
	useZoom,
} from "./settings-host.tsx";
import settings from "../builtins/settings/index.tsx";

export function initializeDesktopExtensions(): () => void {
	const lifetime = new AbortController();
	startWorkspaceOperations(lifetime.signal);
	startZoomFeedback(lifetime.signal);
	const host: experimental_DesktopHost = {
		experimental_signal: lifetime.signal,
		experimental_panelServices: panelServices(lifetime.signal),
		experimental_workspaceServices: workspaceServices(lifetime.signal),
		experimental_conversationServices: conversationServices,
		experimental_pickerServices: pickerServices,
		experimental_ItemRenderer: (props) => createElement(ItemRenderer, props),
		experimental_MessageActions: (props) => createElement(MessageActions, props),
		experimental_ComposerRoot: (props) => createElement(ComposerRoot, props),
		experimental_ComposerFrame: (props) => createElement(ComposerFrame, props),
		experimental_TextareaEditor: () => createElement(TextareaEditor),
		experimental_useComposer: useComposer,
		experimental_useComposerEditor: useComposerEditor,
		experimental_ComposerContributions: (props) => createElement(ComposerContributions, props),
		experimental_imageThumbnail: async (path) => (await client.host("host/image/thumbnail", { path })).dataUrl,
		experimental_composer: (target) => composerController(target, lifetime.signal),
		experimental_attachComposerEditor: (target, adapter) => mountEditor(target, adapter, lifetime.signal),
		experimental_useComposerDraft: (target) => useStore((s) => composerDraftOf(s, composerKey(target))),
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
		experimental_settingsServices: settingsServices(),
		experimental_settingsControls: settingsControls,
		experimental_appearance: appearance(),
		experimental_SettingsSections: (props) => createElement(SettingsSections, props),
		experimental_ThemeScope: (props) => createElement(ThemeScope, props),
		experimental_useZoom: useZoom,
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
		desktopExtensions.register("builtin.composer", composer),
		desktopExtensions.register("builtin.thread-header", threadHeader),
		desktopExtensions.register("builtin.requests", requests),
		desktopExtensions.register("builtin.workspace", workspace),
		desktopExtensions.register("builtin.conversation", conversation),
		desktopExtensions.register("builtin.settings", settings),
	];
	const disposeExternal = startExternalExtensions(desktopExtensions);
	const dispose = () => {
		lifetime.abort();
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
			<OperationRecovery />
		</>
	);
}
