/** One frontend epoch's authority, layered over the existing window and editor lifetimes. */
import * as SDK from "@knightcodeai/cli/desktop";
import { useSyncExternalStore } from "react";
import { FrontendBackend } from "./backend.ts";
import type { DesktopActivationBinding, DesktopBackendContracts } from "@knightcode/app-server-protocol";
import { composerController, mountEditor, whenEditorsIdle } from "./composer-controller.ts";
import { useComposerEditor } from "./composer-root.tsx";
import { panelServices } from "./panel.tsx";
import { workspaceServices } from "./workspace.ts";
import { appearance, extensionSettingsServices } from "./settings-host.tsx";
import { followDrag } from "../drag.ts";

type Phase = "prepared" | "published" | "live" | "quiescing" | "closed";
export type ActivationState = { phase: Phase; finishingInput: boolean };

export class FrontendActivation {
	readonly binding: DesktopActivationBinding;
	readonly signal: AbortSignal;
	readonly sdk: typeof SDK;
	readonly backend: FrontendBackend;
	failure?: string;
	private readonly lifetime = new AbortController();
	private readonly listeners = new Set<() => void>();
	private readonly changed: () => void;
	private state: ActivationState = { phase: "prepared", finishingInput: false };

	constructor(
		binding: DesktopActivationBinding,
		host: SDK.experimental_DesktopHost,
		changed: () => void,
		contracts: DesktopBackendContracts = { methods: {}, events: {} },
	) {
		this.binding = binding;
		this.changed = changed;
		this.signal = AbortSignal.any([host.experimental_signal, this.lifetime.signal]);
		const backend = new FrontendBackend(binding, contracts, this.signal, () => this.admitted());
		this.backend = backend;
		const controller = (target: SDK.experimental_ComposerTarget) =>
			composerController(target, this.signal, () => this.admitted());
		const controls = host.experimental_controllers;
		const scopedControllers: SDK.experimental_Controllers = {
			experimental_showNew: (cwd) => {
				if (this.admitted()) controls.experimental_showNew(cwd);
			},
			experimental_runCommand: (id, context) => this.admitted() && controls.experimental_runCommand(id, context),
			experimental_addProject: async () => {
				if (!this.admitted()) return;
				const result = await controls.experimental_addProject();
				return this.admitted() ? result : undefined;
			},
			experimental_setSidebarOpen: (open) => {
				if (this.admitted()) controls.experimental_setSidebarOpen(open);
			},
			experimental_showSettings: (page) => {
				if (this.admitted()) controls.experimental_showSettings(page);
			},
			experimental_goBack: (delta) => this.admitted() && controls.experimental_goBack(delta),
			experimental_openPage: (id) => this.admitted() && controls.experimental_openPage(id),
			experimental_openThread: async (id) =>
				this.admitted() && (await controls.experimental_openThread(id)) && this.admitted(),
			experimental_removeProject: (path) => this.admitted() && controls.experimental_removeProject(path),
			experimental_pinThread: (id, pinned) => this.admitted() && controls.experimental_pinThread(id, pinned),
			experimental_renameThread: async (id, name) =>
				this.admitted() && (await controls.experimental_renameThread(id, name)) && this.admitted(),
			experimental_archiveThread: async (id) =>
				this.admitted() && (await controls.experimental_archiveThread(id)) && this.admitted(),
			experimental_windowCommand: async (command) =>
				this.admitted() && (await controls.experimental_windowCommand(command)) && this.admitted(),
			experimental_toggleTerminal: (thread) => {
				if (this.admitted()) controls.experimental_toggleTerminal(thread);
			},
			experimental_newTerminal: async (thread) => {
				if (this.admitted()) await controls.experimental_newTerminal(thread);
			},
			experimental_notify: (text, kind) => {
				if (this.admitted()) controls.experimental_notify(text, kind);
			},
			experimental_dismissToast: (id) => {
				if (this.admitted()) controls.experimental_dismissToast(id);
			},
		};
		const conversation = host.experimental_conversationServices;
		const scopedConversation: SDK.experimental_ConversationServices = {
			...conversation,
			experimental_openFile: (thread, path, line) =>
				this.admitted() && conversation.experimental_openFile(thread, path, line),
			experimental_copyText: async (text) =>
				this.admitted() && (await conversation.experimental_copyText(text)) && this.admitted(),
			experimental_fork: async (thread, item) => {
				if (this.admitted()) await conversation.experimental_fork(thread, item);
			},
			experimental_resendEdited: async (thread, turn, text, images) => {
				if (this.admitted()) await conversation.experimental_resendEdited(thread, turn, text, images);
			},
			experimental_showChanges: (thread, scope) => {
				if (this.admitted()) conversation.experimental_showChanges(thread, scope);
			},
			experimental_undoTurnEdits: async (thread, turn, reapply) =>
				this.admitted() && (await conversation.experimental_undoTurnEdits(thread, turn, reapply)) && this.admitted(),
			experimental_answerApproval: (thread, request, result) =>
				this.admitted() && conversation.experimental_answerApproval(thread, request, result),
			experimental_answerDialog: (thread, request, result) =>
				this.admitted() && conversation.experimental_answerDialog(thread, request, result),
			experimental_answerQuestions: (thread, request, result) =>
				this.admitted() && conversation.experimental_answerQuestions(thread, request, result),
			experimental_setPanelOpen: (open) => {
				if (this.admitted()) conversation.experimental_setPanelOpen(open);
			},
			experimental_copyLastCodeBlock: (thread) => {
				if (this.admitted()) conversation.experimental_copyLastCodeBlock(thread);
			},
			experimental_loadEarlier: async (thread) => {
				if (this.admitted()) await conversation.experimental_loadEarlier(thread);
			},
			experimental_find: (thread, open) => this.admitted() && conversation.experimental_find(thread, open),
			experimental_scroll: (thread, to) => this.admitted() && conversation.experimental_scroll(thread, to),
		};
		const shell = host.experimental_shellServices;
		const scopedShell: SDK.experimental_ShellServices = {
			...shell,
			experimental_useBinding: (id, handler, enabled) =>
				shell.experimental_useBinding(
					id,
					(event) => (this.admitted() ? handler(event) : false),
					enabled !== false && this.admitted(),
				),
			experimental_useBindings: (actions, enabled) =>
				shell.experimental_useBindings(
					actions.map((action) => ({
						...action,
						run: () => {
							if (this.admitted()) action.run();
						},
					})),
					enabled !== false && this.admitted(),
				),
			experimental_followDrag: (move, end) => {
				if (this.admitted())
					followDrag(
						(event) => {
							if (this.admitted()) move(event);
						},
						() => {
							if (this.admitted()) end();
						},
						this.signal,
					);
			},
			experimental_showContextMenu: async (items) => {
				if (this.admitted()) await shell.experimental_showContextMenu(this.menu(items));
			},
			experimental_showInFolder: async (path) =>
				this.admitted() && (await shell.experimental_showInFolder(path)) && this.admitted(),
			experimental_profile: async (action) => {
				if (!this.admitted()) return { signedIn: false };
				const profile = await shell.experimental_profile(action);
				return this.admitted() ? profile : { signedIn: false };
			},
			experimental_openDocumentation: async () =>
				this.admitted() && (await shell.experimental_openDocumentation()) && this.admitted(),
			experimental_checkForUpdates: () => {
				if (this.admitted()) shell.experimental_checkForUpdates();
			},
			experimental_installUpdate: () => {
				if (this.admitted()) shell.experimental_installUpdate();
			},
			experimental_openUpdatePage: (url) => {
				if (this.admitted()) shell.experimental_openUpdatePage(url);
			},
			experimental_setPaletteOpen: (open) => {
				if (this.admitted()) shell.experimental_setPaletteOpen(open);
			},
			experimental_setFinding: (open) => {
				if (this.admitted()) shell.experimental_setFinding(open);
			},
			experimental_toggleSection: (id) => {
				if (this.admitted()) shell.experimental_toggleSection(id);
			},
			experimental_toggleProject: (path) => {
				if (this.admitted()) shell.experimental_toggleProject(path);
			},
			experimental_setSidebarWidth: (width) => {
				if (this.admitted()) shell.experimental_setSidebarWidth(width);
			},
			experimental_setSidebarOption: (...args: ["organize", "project" | "list"] | ["sort", "updated" | "created"]) => {
				if (!this.admitted()) return;
				if (args[0] === "organize") shell.experimental_setSidebarOption(args[0], args[1]);
				else shell.experimental_setSidebarOption(args[0], args[1]);
			},
			experimental_archiveThreads: async (ids, project) => {
				if (this.admitted()) await shell.experimental_archiveThreads(ids, project);
			},
			experimental_threadMenu: (thread, options) =>
				this.menu(
					shell.experimental_threadMenu(thread, {
						...options,
						onRename: () => {
							if (this.admitted()) options.onRename();
						},
						onDelete: () => {
							if (this.admitted()) options.onDelete();
						},
					}),
				),
		};
		const ownedHost: SDK.experimental_DesktopHost = {
			...host,
			experimental_signal: this.signal,
			experimental_backend: backend,
			experimental_panelServices: panelServices(this.signal, () => this.admitted()),
			experimental_workspaceServices: workspaceServices(this.signal, () => this.admitted()),
			experimental_settingsServices: extensionSettingsServices(() => this.admitted()),
			experimental_appearance: appearance(() => this.admitted()),
			experimental_useBackend: () =>
				useSyncExternalStore(
					this.subscribe,
					() => (this.admitted() ? backend : undefined),
					() => undefined,
				),
			experimental_controllers: scopedControllers,
			experimental_conversationServices: scopedConversation,
			experimental_shellServices: scopedShell,
			experimental_composer: controller,
			experimental_attachComposerEditor: (target, adapter) =>
				this.mounted() && this.state.phase !== "quiescing"
					? mountEditor(target, adapter, this.signal, this.signal)
					: { status: "unavailable" },
			experimental_useComposerEditor: (adapter) => useComposerEditor(adapter, this.signal),
			experimental_useComposer: () => {
				const state = host.experimental_useComposer();
				return {
					...state,
					controller: controller(state.target),
					workspaceChoice: state.workspaceChoice && {
						value: state.workspaceChoice.value,
						experimental_select: (value) =>
							this.admitted() && (state.workspaceChoice?.experimental_select(value) ?? false),
					},
					project: state.project
						? {
								...state.project,
								onChange: (cwd) => {
									if (this.admitted()) state.project?.onChange(cwd);
								},
							}
						: undefined,
					dropProps: {
						onDragOver: (event) => {
							if (this.admitted()) state.dropProps.onDragOver?.(event);
						},
						onDragLeave: (event) => {
							if (this.admitted()) state.dropProps.onDragLeave?.(event);
						},
						onDrop: (event) => {
							if (this.admitted()) state.dropProps.onDrop?.(event);
						},
					},
					canSend: this.admitted() && state.canSend,
					canStop: this.admitted() && state.canStop,
					onKeyDown: (event) => {
						if (this.admitted()) state.onKeyDown(event);
					},
					refreshSuggestions: async (text, caret) => {
						if (this.admitted()) await state.refreshSuggestions(text, caret);
					},
					setSelected: (index) => {
						if (this.admitted()) state.setSelected(index);
					},
					accept: (suggestion) => {
						if (this.admitted()) state.accept(suggestion);
					},
					toggleAddMenu: async () => {
						if (this.admitted()) await state.toggleAddMenu();
					},
					dismissSuggestions: () => {
						if (this.admitted()) state.dismissSuggestions();
					},
					submit: (alternate) => (this.admitted() ? state.submit(alternate) : { status: "unavailable" }),
					stop: () => {
						if (this.admitted()) state.stop();
					},
					removeImage: (path) => {
						if (this.admitted()) state.removeImage(path);
					},
					queueSteer: (id, text) => {
						if (this.admitted()) state.queueSteer(id, text);
					},
					queueDelete: (id) => {
						if (this.admitted()) state.queueDelete(id);
					},
					queueEdit: (id, text) => {
						if (this.admitted()) state.queueEdit(id, text);
					},
				};
			},
			experimental_imageThumbnail: async (path) => {
				if (!this.mounted()) return;
				const image = await host.experimental_imageThumbnail(path);
				return this.mounted() ? image : undefined;
			},
		};
		Object.defineProperty(ownedHost, Symbol.for("knightcode.desktop.activationHost"), { value: true });
		// Binding `this` changes no argument or result contract; constants and pure declaration helpers remain shared.
		this.sdk = Object.fromEntries(
			Object.entries(SDK).map(([name, value]) => [
				name,
				typeof value === "function" ? (...args: unknown[]) => Reflect.apply(value, ownedHost, args) : value,
			]),
		) as typeof SDK;
	}

	subscribe = (listener: () => void): (() => void) => {
		this.listeners.add(listener);
		return () => {
			this.listeners.delete(listener);
		};
	};

	getSnapshot = (): ActivationState => this.state;

	admitted(): boolean {
		return !this.signal.aborted && this.failure === undefined && this.state.phase === "live";
	}

	fail(error: unknown): void {
		if (this.signal.aborted) return;
		this.failure = error instanceof Error ? error.message : String(error);
		this.changed();
	}

	mounted(): boolean {
		return (
			!this.signal.aborted &&
			(this.state.phase === "published" || this.state.phase === "live" || this.state.phase === "quiescing")
		);
	}

	publish(): void {
		if (this.state.phase !== "prepared" || this.signal.aborted)
			throw new Error("Frontend activation is no longer prepared.");
		this.set({ phase: "published", finishingInput: false });
	}

	ready(): void {
		if (!this.signal.aborted && this.state.phase !== "prepared") this.set({ phase: "live", finishingInput: false });
	}

	async quiesce(signal: AbortSignal): Promise<void> {
		if (!this.mounted()) return;
		this.set({ phase: "quiescing", finishingInput: true });
		await whenEditorsIdle(this.signal, signal);
		if (signal.aborted || this.signal.aborted) throw new Error("Frontend quiescence revoked.");
		this.set({ phase: "quiescing", finishingInput: false });
	}

	dispose(): void {
		if (this.state.phase === "closed") return;
		this.set({ phase: "closed", finishingInput: false });
		this.lifetime.abort();
		this.listeners.clear();
	}

	private menu(items: SDK.experimental_ContextMenuItem[]): SDK.experimental_ContextMenuItem[] {
		return items.map((item) => {
			if (item === "-") return item;
			if ("items" in item)
				return { ...item, items: item.items.map((child) => (child === "-" ? child : this.menuAction(child))) };
			return this.menuAction(item);
		});
	}

	private menuAction(item: SDK.experimental_MenuAction): SDK.experimental_MenuAction {
		return {
			...item,
			run: () => {
				if (this.admitted()) item.run();
			},
		};
	}

	private set(state: ActivationState): void {
		if (this.state.phase === state.phase && this.state.finishingInput === state.finishingInput) return;
		this.state = state;
		this.changed();
		for (const listener of this.listeners) listener();
	}
}
