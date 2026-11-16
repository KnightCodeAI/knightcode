/** Experimental desktop contributions. This entry is inert outside a desktop renderer and has no runtime imports. */
import type {
	ComponentProps,
	ComponentType,
	KeyboardEvent,
	MouseEvent,
	ReactElement,
	ReactNode,
	SVGProps,
} from "react";
import type { DropdownMenu } from "radix-ui";

/** Shared host singletons available to external ESM; all other bare runtime imports are refused. */
export const experimental_RUNTIME_IMPORTS = [
	"@knightcodeai/cli/desktop",
	"react",
	"react-dom",
	"react/jsx-runtime",
	"radix-ui",
	"@pierre/diffs",
	"@pierre/trees",
	"typebox",
] as const;

/** Published, read-only CSS variables. Extension styles cannot redefine --kc-* names. */
export const experimental_THEME_TOKENS = [
	"--kc-text",
	"--kc-text-secondary",
	"--kc-text-tertiary",
	"--kc-font-ui",
	"--kc-font-code",
	"--kc-font-content",
	"--kc-focus",
	"--kc-selection",
	"--kc-size-ui",
] as const;

export interface experimental_Disposable {
	dispose(): void;
}

/** A captured target, never an implicit read of whichever thread is selected later. */
export interface experimental_CommandContext {
	thread?: { id: string; cwd: string };
	cwd?: string;
	sidebarOpen: boolean;
	row?: experimental_Thread;
}

export type experimental_KeybindingId =
	| "desktop.thread.new"
	| "desktop.project.open"
	| "desktop.sidebar.toggle"
	| "desktop.terminal.toggle"
	| "desktop.terminal.new"
	| "desktop.settings"
	| "desktop.shortcuts";

export type experimental_IconName =
	| "SquarePen"
	| "FolderOpen"
	| "PanelLeft"
	| "SquareTerminal"
	| "Settings"
	| "Keyboard"
	| "CircleCheck"
	| "CircleAlert"
	| "Info"
	| "X"
	| "ArrowLeft"
	| "ArrowRight"
	| "Download"
	| "ArrowUpRight"
	| "BookOpen"
	| "CircleUserRound"
	| "House"
	| "LifeBuoy"
	| "LogIn"
	| "LogOut"
	| "Archive"
	| "ArrowDownUp"
	| "ChevronRight"
	| "Folder"
	| "FolderPlus"
	| "GitBranchPlus"
	| "List"
	| "MoreHorizontal"
	| "Pin"
	| "PinOff"
	| "Search"
	| "Layers";

export type experimental_IconProps = SVGProps<SVGSVGElement> & {
	name: experimental_IconName;
	size?: number | string;
	filled?: boolean;
};

export type experimental_ButtonProps = Omit<ComponentProps<"button">, "color"> & {
	variant?: "ghost" | "solid" | "soft" | "outline" | "surface" | "field" | "accent";
	color?: "primary" | "secondary" | "danger";
	size?: "3xs" | "2xs" | "xs" | "sm" | "md" | "lg" | "xl" | "2xl";
	uniform?: boolean;
	pill?: boolean;
	squircle?: boolean;
	block?: boolean;
	strong?: boolean;
	toggle?: boolean;
	toolbar?: boolean;
};

export interface experimental_Command {
	id: string;
	order?: number;
	label(context: experimental_CommandContext): string;
	icon?: experimental_IconName;
	binding?: experimental_KeybindingId;
	experimental_available?(context: experimental_CommandContext): boolean;
	experimental_run(context: experimental_CommandContext, signal: AbortSignal): void | Promise<void>;
}

/** Replaceable structural surfaces and ordered contribution locations. */
export type experimental_Surface =
	| "feedback"
	| "layout"
	| "navigation"
	| "threadList"
	| "home"
	| "titleBar"
	| "homeSection"
	| "threadRowMetadata"
	| "threadRowStatus"
	| "threadRowActions";

/** Only these surfaces accept selectable replacement providers. */
export type experimental_ProviderSurface = "feedback" | "layout" | "navigation" | "threadList" | "home" | "titleBar";

export interface experimental_ProviderContribution extends Omit<experimental_SurfaceContribution, "surface"> {
	surface: experimental_ProviderSurface;
}

export interface experimental_SurfaceContribution {
	id: string;
	surface: experimental_Surface;
	order?: number;
	experimental_available?(context: experimental_CommandContext): boolean;
	experimental_render(props: { context: experimental_CommandContext; signal: AbortSignal }): ReactNode;
}

export interface experimental_Toast {
	id: number;
	text: string;
	kind: "error" | "success" | "info";
}

/** Host-owned state and mediated intents, shared by built-in and external UI. */
export type experimental_SettingsPage =
	| "general"
	| "appearance"
	| "models"
	| "shortcuts"
	| "archived"
	| "configuration"
	| "tools"
	| "mcp"
	| "extensions"
	| "plugins"
	| "worktrees"
	| "about";

/** Finite native intents; main validates and applies them to the sender's window. */
export type experimental_WindowCommand =
	| "undo"
	| "redo"
	| "cut"
	| "copy"
	| "paste"
	| "delete"
	| "selectAll"
	| "reload"
	| "toggleDevTools"
	| "zoomIn"
	| "zoomOut"
	| "resetZoom"
	| "quit"
	| "minimize"
	| "toggleMaximize"
	| "toggleFullScreen"
	| "close"
	| "focus";

export interface experimental_Controllers {
	experimental_showNew(cwd?: string): void;
	experimental_addProject(): Promise<string | undefined>;
	experimental_setSidebarOpen(open: boolean): void;
	experimental_showSettings(page: experimental_SettingsPage): void;
	experimental_goBack(delta: -1 | 1): boolean;
	experimental_openPage(id: string): boolean;
	experimental_openThread(id: string): Promise<boolean>;
	experimental_removeProject(path: string): boolean;
	experimental_pinThread(id: string, pinned: boolean): boolean;
	experimental_renameThread(id: string, name: string): Promise<boolean>;
	experimental_archiveThread(id: string): Promise<boolean>;
	experimental_windowCommand(command: experimental_WindowCommand): Promise<boolean>;
	experimental_toggleTerminal(thread: { id: string; cwd: string }): void;
	experimental_newTerminal(thread: { id: string; cwd: string }): Promise<void>;
	experimental_notify(text: string, kind?: experimental_Toast["kind"]): void;
	experimental_dismissToast(id: number): void;
}

/** Pages may remain reachable through explicit navigation without a rail entry. */
export interface experimental_Page extends Omit<experimental_SurfaceContribution, "surface"> {
	label: string;
	hidden?: boolean;
}

/** Declarative rail visibility; recovery destinations are intentionally not part of this vocabulary. */
export interface experimental_NavigationVisibility {
	id: string;
	target: "home" | "profile";
	order?: number;
	experimental_available?(context: experimental_CommandContext): boolean;
}

export interface experimental_DesktopApp {
	experimental_signal: AbortSignal;
	experimental_registerCommand(command: experimental_Command): experimental_Disposable;
	experimental_registerPage(page: experimental_Page): experimental_Disposable;
	experimental_hideNavigation(entry: experimental_NavigationVisibility): experimental_Disposable;
	experimental_registerSlot(slot: experimental_SurfaceContribution): experimental_Disposable;
	experimental_registerProvider(provider: experimental_ProviderContribution): experimental_Disposable;
	experimental_onDispose(dispose: () => void): void;
}

export interface experimental_DesktopExtension {
	apiVersion: number;
	experimental_setup(app: experimental_DesktopApp): void;
}

/** Declare an extension without executing it or reading the renderer host. */
export function defineDesktopExtension(
	setup: experimental_DesktopExtension["experimental_setup"],
	options: { apiVersion: number } = { apiVersion: 1 },
): experimental_DesktopExtension {
	return { apiVersion: options.apiVersion, experimental_setup: setup };
}

/** Renderer-installed bindings; not a raw bridge or a separate state container. */
export interface experimental_DesktopHost {
	experimental_useNavigation(): experimental_NavigationState;
	experimental_useThreadList(): experimental_ThreadListState;
	experimental_useUpdate(): experimental_Update;
	experimental_controls: experimental_Controls;
	experimental_shellServices: experimental_ShellServices;
	experimental_icons: Record<experimental_IconName, ComponentType<Omit<experimental_IconProps, "name">>>;
	experimental_SurfaceHost(props: { surface: "navigation" | "threadList" | "home" | "titleBar" }): ReactNode;
	experimental_Content(): ReactNode;
	experimental_Slots(props: { surface: experimental_Surface; thread?: experimental_Thread; cwd?: string }): ReactNode;
	experimental_ThreadRow(props: { threadId: string; inset?: boolean }): ReactNode;
	experimental_controllers: experimental_Controllers;
	experimental_useToasts(): readonly experimental_Toast[];
	experimental_Icon(props: experimental_IconProps): ReactElement;
	experimental_Button(props: experimental_ButtonProps): ReactElement;
	experimental_KeybindingKeys(props: { binding: experimental_KeybindingId }): ReactElement;
	experimental_Portal(props: { children: ReactNode }): ReactNode;
}

declare global {
	var __knightcodeDesktop: experimental_DesktopHost | undefined;
}

function host(): experimental_DesktopHost {
	const value = globalThis.__knightcodeDesktop;
	if (!value) throw new Error("The desktop SDK requires a KnightCode desktop renderer host.");
	return value;
}

/** Get stable controllers backed by the window's existing store. */
export function experimental_controllers(): experimental_Controllers {
	return host().experimental_controllers;
}

/** Subscribe to host-owned notifications; remounting a presenter does not reset them. */
export function experimental_useToasts(): readonly experimental_Toast[] {
	return host().experimental_useToasts();
}

/** Draw a host icon by its public name. */
export function experimental_Icon(props: experimental_IconProps): ReactElement {
	return host().experimental_Icon(props);
}

/** Draw the shared themed button without importing renderer components. */
export function experimental_Button(props: experimental_ButtonProps): ReactElement {
	return host().experimental_Button(props);
}

/** Render an owned portal with the contribution\'s revision, theme and disposal lifetime. */
export function experimental_Portal(props: { children: ReactNode }): ReactNode {
	return host().experimental_Portal(props);
}

/** Draw the user\'s configured keys for a command. */
export function experimental_KeybindingKeys(props: { binding: experimental_KeybindingId }): ReactElement {
	return host().experimental_KeybindingKeys(props);
}

/** A thread-list read model, independent of protocol implementation types. */
export interface experimental_Thread {
	id: string;
	cwd: string;
	projectCwd: string;
	name: string;
	status:
		| { type: "notLoaded" | "idle" }
		| { type: "active"; waitingOn: ("approval" | "dialog")[] }
		| { type: "systemError"; message: string };
	archived: boolean;
	createdAt: string;
	updatedAt: string;
	forkedFromId?: string;
	workspaceMode: "local" | "worktree";
}

export interface experimental_Project {
	path: string;
	name?: string;
	collapsed: boolean;
}

export type experimental_View =
	| { kind: "new"; cwd?: string }
	| { kind: "thread"; id: string }
	| { kind: "settings"; page: experimental_SettingsPage }
	| { kind: "page"; id: string };

export interface experimental_NavigationState {
	view: experimental_View;
	sidebarOpen: boolean;
	canGoBack: boolean;
	canGoForward: boolean;
}

export interface experimental_ThreadListState {
	threads: experimental_Thread[];
	projects: experimental_Project[];
	pins: string[];
	unread: string[];
	folded: string[];
	organize: "project" | "list";
	sort: "updated" | "created";
	width: number;
}

/** Shared themed controls; portals preserve the rendering contribution's ownership. */
export interface experimental_Controls {
	experimental_IconButton: ComponentType<
		Omit<experimental_ButtonProps, "children" | "uniform" | "variant" | "color"> & {
			label: string;
			round?: boolean;
			children: ReactNode;
		}
	>;
	experimental_Menu: typeof DropdownMenu.Root;
	experimental_MenuTrigger: ComponentType<ComponentProps<typeof DropdownMenu.Trigger>>;
	experimental_MenuContent: ComponentType<
		ComponentProps<typeof DropdownMenu.Content> & { minWidth?: number; variant?: "app" }
	>;
	experimental_MenuItem: ComponentType<
		Omit<ComponentProps<typeof DropdownMenu.Item>, "children"> & {
			icon?: ReactNode;
			hint?: ReactNode;
			children: ReactNode;
		}
	>;
	experimental_MenuSub: ComponentType<{ label: ReactNode; icon?: ReactNode; minWidth?: number; children: ReactNode }>;
	experimental_MenuSeparator: ComponentType;
	experimental_MenuRadioGroup: typeof DropdownMenu.RadioGroup;
	experimental_MenuRadioItem: ComponentType<
		Omit<ComponentProps<typeof DropdownMenu.RadioItem>, "children"> & { icon?: ReactNode; children: ReactNode }
	>;
	experimental_HoverCard: ComponentType<{ content: ReactNode; children: ReactElement }>;
	experimental_Tooltip: ComponentType<{ content: ReactNode; children: ReactElement }>;
	experimental_ConfirmDialog: ComponentType<{
		title: ReactNode;
		description: ReactNode;
		confirm: string;
		onConfirm(): void;
		onClose(): void;
	}>;
	experimental_NavRow: ComponentType<
		Omit<ComponentProps<"div">, "onClick" | "children"> & {
			icon?: ReactNode;
			inset?: boolean;
			label: ReactNode;
			status?: ReactNode;
			actions?: ReactNode;
			current?: boolean;
			selected?: boolean;
			expanded?: boolean;
			onActivate(event: MouseEvent | KeyboardEvent): void;
			onContextMenu?: (event: MouseEvent) => void;
		}
	>;
	experimental_RenameThreadDialog: ComponentType<{ threadId: string; onClose(): void }>;
	experimental_DeleteThreadDialog: ComponentType<{ thread: { id: string; name: string }; onClose(): void }>;
	experimental_HomeComposer: ComponentType<{ cwd?: string; onChange(cwd: string): void }>;
	experimental_ProjectPicker: ComponentType<{
		cwd: string;
		onChange(cwd: string): void;
		side: "bottom";
		trigger(): ReactNode;
	}>;
	experimental_HomeSetup: ComponentType<{ cwd?: string }>;
}

export interface experimental_RowSelection {
	ids: string[];
	anchor?: string;
}

export interface experimental_SidebarModel {
	pinned: experimental_Thread[];
	attention: experimental_Thread[];
	projects: (experimental_Project & { threads: experimental_Thread[] })[];
	recent: experimental_Thread[];
}

export type experimental_MenuAction = { label: string; run(): void; disabled?: boolean; binding?: string };
export type experimental_ContextMenuItem =
	experimental_MenuAction | "-" | { label: string; items: (experimental_MenuAction | "-")[] };

/** Reusable host operations needed by structural presenters, not unrestricted store/protocol access. */
export interface experimental_ShellServices {
	experimental_platform: string;
	experimental_titleBarHeight: number;
	experimental_sidebarWidth: { default: number; min: number; max: number };
	experimental_sidebarModel(
		threads: experimental_Thread[],
		projects: experimental_Project[],
		pins: string[],
		query: string,
		samePath: (a: string, b: string) => boolean,
		options: { organize: "project" | "list"; sort: "updated" | "created" },
	): experimental_SidebarModel;
	experimental_threadSlots(model: experimental_SidebarModel, folded: string[]): experimental_Thread[];
	experimental_selectRows(
		selection: experimental_RowSelection,
		order: string[],
		id: string,
		mode: "toggle" | "range",
	): experimental_RowSelection;
	experimental_useHiddenNavigation(): readonly string[];
	experimental_usePages(): { id: string; label: string; hidden?: boolean }[];
	experimental_basename(path: string): string;
	experimental_samePath(a: string, b: string): boolean;
	experimental_messageTime(time: number): string;
	experimental_isMac(): boolean;
	experimental_bindingLabel(binding: string): string;
	experimental_matches(event: KeyboardEvent, binding: string): boolean;
	experimental_followDrag(move: (event: globalThis.PointerEvent) => void, end: () => void): void;
	experimental_showContextMenu(items: experimental_ContextMenuItem[]): Promise<void>;
	experimental_showInFolder(path: string): Promise<boolean>;
	experimental_profile(action: "read" | "signIn" | "signOut"): Promise<experimental_Profile>;
	experimental_openDocumentation(): Promise<boolean>;
	experimental_checkForUpdates(): void;
	experimental_installUpdate(): void;
	experimental_openUpdatePage(url: string): void;
	experimental_setPaletteOpen(open: boolean): void;
	experimental_setFinding(open: boolean): void;
	experimental_toggleSection(id: string): void;
	experimental_toggleProject(path: string): void;
	experimental_setSidebarWidth(width: number): void;
	experimental_setSidebarOption(key: "organize", value: "project" | "list"): void;
	experimental_setSidebarOption(key: "sort", value: "updated" | "created"): void;
	experimental_archiveThreads(ids: string[], project?: string): Promise<void>;
	experimental_threadMenu(
		thread: { id: string; cwd: string },
		options: { pinned: boolean; unread: boolean; open: boolean; onRename(): void; onDelete(): void },
	): experimental_ContextMenuItem[];
}

export type experimental_Profile = { signedIn: false } | { signedIn: true; login?: string; avatarUrl?: string };
export type experimental_Update =
	| { state: "unavailable" }
	| { state: "idle" }
	| { state: "checking" }
	| { state: "downloading" }
	| { state: "ready"; version?: string }
	| { state: "available"; version: string; url: string };

/** Read the current navigation and history without exposing store selectors. */
export function experimental_useNavigation(): experimental_NavigationState {
	return host().experimental_useNavigation();
}

/** Read projects, threads, unread and sidebar presentation preferences. */
export function experimental_useThreadList(): experimental_ThreadListState {
	return host().experimental_useThreadList();
}

/** Read the update indicator state; update installation remains host-mediated. */
export function experimental_useUpdate(): experimental_Update {
	return host().experimental_useUpdate();
}

/** Get shared accessible themed controls for structural providers. */
export function experimental_controls(): experimental_Controls {
	return host().experimental_controls;
}

/** Get finite structural presenter services, never the raw host bridge. */
export function experimental_shellServices(): experimental_ShellServices {
	return host().experimental_shellServices;
}

/** Get shared icons without a private renderer import. */
export function experimental_icons(): Record<
	experimental_IconName,
	ComponentType<Omit<experimental_IconProps, "name">>
> {
	return host().experimental_icons;
}

/** Mount a structural host; recursive replacement of the same surface is refused. */
export function experimental_SurfaceHost(props: {
	surface: "navigation" | "threadList" | "home" | "titleBar";
}): ReactNode {
	return host().experimental_SurfaceHost(props);
}

/** Mount the host-owned current-view region, including recovery settings. */
export function experimental_Content(): ReactNode {
	return host().experimental_Content();
}

/** Mount ordered contributions at their original ownership roots. */
export function experimental_Slots(props: {
	surface: experimental_Surface;
	thread?: experimental_Thread;
	cwd?: string;
}): ReactNode {
	return host().experimental_Slots(props);
}

/** Mount a shared thread row with its context menu, dialogs, status and keyboard activation. */
export function experimental_ThreadRow(props: { threadId: string; inset?: boolean }): ReactNode {
	return host().experimental_ThreadRow(props);
}
