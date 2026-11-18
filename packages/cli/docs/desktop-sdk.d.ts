// Generated from src/desktop.ts. Run bun packages/cli/scripts/generate-desktop-api.ts.


import type {
	ComponentProps,
	ComponentType,
	KeyboardEvent,
	MouseEvent,
	ReactElement,
	ReactNode,
	RefObject,
	SVGProps,
} from "react";

import type { DropdownMenu } from "radix-ui";

import type * as Domain from "./desktop-models.ts";

import type { Static, TSchema } from "typebox";

import type { experimental_BackendDataSelector } from "./desktop-backend-sdk.d.ts";

export type experimental_BackendResult<T> =
	| { status: "ok"; value: T }
	| { status: "disconnected" | "cancelled" | "outcome-unknown" }
	| { status: "error"; message: string };

export interface experimental_BackendClient {
	experimental_call<P extends TSchema, R extends TSchema>(
		method: { id: string; params: P; result: R },
		args: Static<P>,
		signal?: AbortSignal,
	): Promise<experimental_BackendResult<Static<R>>>;
	experimental_settings(
		context?: experimental_BackendDataSelector,
		signal?: AbortSignal,
	): Promise<experimental_BackendResult<Record<string, unknown>>>;
	experimental_setSetting(
		id: string,
		value: unknown,
		context?: experimental_BackendDataSelector,
		signal?: AbortSignal,
	): Promise<experimental_BackendResult<Record<string, unknown>>>;
	experimental_subscribe<S extends TSchema>(
		event: { id: string; schema: S },
		listener: (value: Static<S>) => void,
		signal?: AbortSignal,
	): experimental_Disposable;
}

export type experimental_ViewItem = Domain.Item & { index?: number };

export interface experimental_ViewTurn extends Omit<Domain.Turn, "items"> {
	items: experimental_ViewItem[];
}

export type experimental_TurnFile = Domain.TurnFile;

export type experimental_ApprovalMode = Domain.ApprovalMode;

export type experimental_ThinkingLevel = Domain.ThinkingLevel;

export type experimental_ModelInfo = Domain.ModelInfo;

export interface experimental_PickerServices {
	experimental_useModels(): Domain.ModelInfo[];
	experimental_useAllowFullAccess(): boolean;
	experimental_useProjects(): experimental_Project[];
}

export type experimental_ToolOutput = Domain.ToolOutput;

export type experimental_BackgroundShell = Domain.BackgroundShell;

export type experimental_BackgroundShellNotice = Domain.BackgroundShellNotice;

export type experimental_DeclarativeView = Domain.View;

export type experimental_AppItem = Extract<experimental_ViewItem, { type: "toolCall" }> & {
	mcpApp: NonNullable<Extract<experimental_ViewItem, { type: "toolCall" }>["mcpApp"]>;
};

export type experimental_Approval = {
	id: string | number;
	method: "item/toolCall/requestApproval";
	params: Domain.ApprovalParams;
};

export type experimental_Dialog = { id: string | number; method: "ui/dialog"; params: Domain.DialogParams };

export type experimental_UserInput = {
	id: string | number;
	method: "item/toolCall/requestUserInput";
	params: Domain.QuestionParams;
};

export type experimental_Request = experimental_Approval | experimental_Dialog | experimental_UserInput;

export interface experimental_ThreadView {
	thread: Domain.Thread;
	turns: experimental_ViewTurn[];
	queue: Domain.TurnQueue;
	ui: Domain.UiSnapshot;
	requests: experimental_Request[];
	retry?: { attempt: number; maxAttempts: number; delayMs: number; error: string; at: number };
	pending: { clientMessageId: string; text: string; images?: Domain.ImageInput[]; failed?: string }[];
	nextCursor?: string;
	backgroundShells?: Domain.BackgroundShell[];
}

export interface experimental_ThreadHeaderState {
	name: string;
	cwd: string;
	project: string;
	workspaceMode: "local" | "worktree";
	statuses: { key: string; text: string }[];
	sessionFile?: string;
	pinned: boolean;
	unread: boolean;
	panelOpen: boolean;
}

export interface experimental_ConversationServices {
	experimental_useThread(threadId: string): experimental_ThreadView | undefined;
	experimental_useHeader(threadId: string): experimental_ThreadHeaderState;
	experimental_useTurnStatus(threadId: string): {
		idle: boolean;
		cwd: string;
		workingVisible: boolean;
		workingMessage?: string;
	};
	experimental_useUndone(turnId: string): boolean;
	experimental_useBackgroundState(
		threadId: string | undefined,
		id: string | undefined,
	): Domain.BackgroundShell | Domain.BackgroundShellNotice | undefined;
	experimental_openFile(threadId: string | undefined, path: string, line?: number): boolean;
	experimental_ToolPatch: ComponentType<{ patch: string }>;
	experimental_Totals: ComponentType<{ additions: number; deletions: number; className?: string }>;
	experimental_readThread(threadId: string): experimental_ThreadView | undefined;
	experimental_useRequest(threadId: string): experimental_Request | undefined;
	experimental_dialogTitle(title: string): { question: string; body?: string };
	experimental_dialogOption(option: string): { label: string; description?: string; recommended: boolean };
	experimental_copyText(text: string): Promise<boolean>;
	experimental_fork(threadId: string, atItemId?: string): Promise<void>;
	experimental_resendEdited(
		threadId: string,
		turnId: string,
		text: string,
		images?: Domain.ImageInput[],
	): Promise<void>;
	experimental_showChanges(threadId: string, scope: "lastTurn"): void;
	experimental_undoTurnEdits(threadId: string, turnId: string, reapply?: boolean): Promise<boolean>;
	experimental_answerApproval(threadId: string, request: experimental_Approval, result: Domain.ApprovalResult): boolean;
	experimental_answerDialog(threadId: string, request: experimental_Dialog, result: Domain.DialogResult): boolean;
	experimental_answerQuestions(
		threadId: string,
		request: experimental_UserInput,
		result: Domain.QuestionResult,
	): boolean;
	experimental_setPanelOpen(open: boolean): void;
	experimental_copyLastCodeBlock(threadId: string): void;
	experimental_loadEarlier(threadId: string): Promise<void>;
	experimental_find(threadId: string, open: boolean): boolean;
	experimental_scroll(threadId: string, to: "top" | "bottom"): boolean;
	experimental_Markdown: ComponentType<{ text: string; tone?: "user" }>;
	experimental_ViewNode: ComponentType<{ view: Domain.View }>;
	experimental_McpAppCard: ComponentType<{ threadId: string; item: experimental_AppItem }>;
	experimental_ThreadSummary: ComponentType<{ threadId: string; anchor: RefObject<HTMLElement | null> }>;
	experimental_ActiveRow: ComponentType<{ item: Extract<experimental_ViewItem, { type: "toolCall" }>; cwd: string }>;
	experimental_ToolRow: ComponentType<{
		item: Extract<experimental_ViewItem, { type: "toolCall" }>;
		cwd: string;
		nested: Extract<experimental_ViewItem, { type: "toolCall" }>[];
	}>;
	experimental_ActivityGroup: ComponentType<{
		items: Extract<experimental_ViewItem, { type: "toolCall" }>[];
		cwd: string;
		nestedOf(id: string): Extract<experimental_ViewItem, { type: "toolCall" }>[];
	}>;
	experimental_BackgroundNotices: ComponentType<{ notices: Domain.BackgroundShellNotice[] }>;
}

export declare const experimental_RUNTIME_IMPORTS: readonly ["@knightcodeai/cli/desktop", "react", "react-dom", "react/jsx-runtime", "radix-ui", "@pierre/diffs", "@pierre/trees", "typebox"];

export declare const experimental_THEME_TOKENS: readonly ["--kc-text", "--kc-text-secondary", "--kc-text-tertiary", "--kc-font-ui", "--kc-font-code", "--kc-font-content", "--kc-focus", "--kc-selection", "--kc-size-ui"];

export interface experimental_Disposable {
	dispose(): void;
}

export interface experimental_CommandContext {
	thread?: { id: string; cwd: string };
	cwd?: string;
	sidebarOpen: boolean;
	row?: experimental_Thread;
	composer?: experimental_ComposerTarget;
	item?: experimental_ViewItem;
	request?: experimental_Request;
}

export type experimental_KeybindingId =
	| "desktop.thread.new"
	| "desktop.project.open"
	| "desktop.sidebar.toggle"
	| "desktop.terminal.toggle"
	| "desktop.terminal.new"
	| "desktop.settings"
	| "desktop.shortcuts"
	| "desktop.composer.send"
	| "desktop.composer.steer"
	| "desktop.turn.interrupt"
	| "desktop.thread.find"
	| "desktop.thread.copyCode";

export type experimental_IconName =
	| "ChevronRight"
	| "ChevronLeft"
	| "ChevronDown"
	| "ChevronUp"
	| "ArrowUp"
	| "ArrowDown"
	| "Download"
	| "ArrowLeft"
	| "ArrowRight"
	| "ArrowUpRight"
	| "ArrowLeftRight"
	| "CornerDownLeft"
	| "ExternalLink"
	| "RefreshCw"
	| "Plug"
	| "Undo"
	| "Spinner"
	| "CollapseAll"
	| "ExpandAll"
	| "Maximize"
	| "Minimize"
	| "X"
	| "Plus"
	| "Minus"
	| "Check"
	| "MoreHorizontal"
	| "Search"
	| "Settings"
	| "House"
	| "File"
	| "FileText"
	| "FilePen"
	| "FileDiff"
	| "FileSearch"
	| "Folder"
	| "FolderOpen"
	| "FolderPlus"
	| "Folders"
	| "GitBranch"
	| "GitBranchPlus"
	| "GitCommitHorizontal"
	| "GitPullRequest"
	| "GitPullRequestDraft"
	| "Square"
	| "SquareTerminal"
	| "Code"
	| "SquareSlash"
	| "SquarePen"
	| "Columns2"
	| "Rows2"
	| "PanelLeft"
	| "PanelRight"
	| "SquarePlus"
	| "Pencil"
	| "AppWindow"
	| "Copy"
	| "Clipboard"
	| "Eye"
	| "Trash2"
	| "Archive"
	| "ArchiveRestore"
	| "Pin"
	| "PinOff"
	| "CircleAlert"
	| "CircleCheck"
	| "MailDot"
	| "List"
	| "ArrowDownUp"
	| "ListFilter"
	| "Import"
	| "Info"
	| "CircleHelp"
	| "Globe"
	| "CircleUserRound"
	| "LifeBuoy"
	| "ShieldTerminal"
	| "ShieldAlert"
	| "LogIn"
	| "LogOut"
	| "KeyRound"
	| "Keyboard"
	| "Hand"
	| "MessageSquare"
	| "ListTodo"
	| "Layers"
	| "BookOpen"
	| "Lightbulb"
	| "Brain"
	| "Sparkles"
	| "Zap"
	| "Wrench"
	| "WrapText"
	| "ImagePlus"
	| "CloudUpload"
	| "Sun";

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
	| "threadRowActions"
	| "composer"
	| "threadHeader"
	| "requests"
	| "composerActions"
	| "composerBanners"
	| "composerChips"
	| "composerAddMenu"
	| "composerSendMenu"
	| "composerSuggestions"
	| "composerPopups"
	| "threadHeaderActions"
	| "threadHeaderStatuses"
	| "threadHeaderTitle"
	| "threadHeaderRow"
	| "messageActions"
	| "transcriptItem";

export type experimental_ProviderSurface =
	"feedback" | "layout" | "navigation" | "threadList" | "home" | "titleBar" | "composer" | "threadHeader" | "requests";

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
	experimental_runCommand(id: string, context: experimental_CommandContext): boolean;
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

export interface experimental_Page extends Omit<experimental_SurfaceContribution, "surface"> {
	label: string;
	hidden?: boolean;
}

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
	experimental_registerPanelTab(tab: experimental_Page): experimental_Disposable;
	experimental_hideNavigation(entry: experimental_NavigationVisibility): experimental_Disposable;
	experimental_registerSlot(slot: experimental_SurfaceContribution): experimental_Disposable;
	experimental_registerItemRenderer(
		renderer: Omit<experimental_SurfaceContribution, "surface">,
	): experimental_Disposable;
	experimental_registerMessageAction(
		action: Omit<experimental_SurfaceContribution, "surface">,
	): experimental_Disposable;
	experimental_registerProvider(provider: experimental_ProviderContribution): experimental_Disposable;
	experimental_onDispose(dispose: () => void): void;
}

export interface experimental_DesktopExtension {
	apiVersion: number;
	experimental_setup(app: experimental_DesktopApp): void;
}

export declare function defineDesktopExtension(setup: experimental_DesktopExtension["experimental_setup"], options?: { apiVersion: number }): experimental_DesktopExtension;

export type experimental_ComposerTarget = { threadId: string } | { cwd: string | undefined };

export interface experimental_EditorSelection {
	start: number;
	end: number;
	direction: "forward" | "backward" | "none";
}

export interface experimental_EditorState {
	text: string;
	selection?: experimental_EditorSelection;
	focused: boolean;
	composing: boolean;
}

export interface experimental_CaretAnchor {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface experimental_EditorAdapter {
	experimental_read(): experimental_EditorState;
	experimental_apply(edit: { text: string; selection?: experimental_EditorSelection }): void;
	experimental_focus(): void;
	experimental_caretAnchor(): experimental_CaretAnchor | undefined;
}

export type experimental_EditorResult =
	{ status: "applied" | "stale"; revision: number } | { status: "unavailable" | "busy" | "locked" };

export interface experimental_ComposerDraft {
	text: string;
	images: string[];
	revision: number;
	selection?: experimental_EditorSelection;
	focused?: boolean;
	composing?: boolean;
	locked?: boolean;
}

export interface experimental_EditorMount extends experimental_Disposable {
	/** Apply the latest canonical snapshot without overwriting an active composition. */
	experimental_sync(): experimental_EditorResult;
	/** Report editor changes against the revision last applied or synchronized by this mount. */
	experimental_report(revision: number): experimental_EditorResult;
}

export type experimental_EditorAttachment =
	{ status: "mounted"; mount: experimental_EditorMount } | { status: "busy" | "unavailable" };

export interface experimental_ComposerSuggestion {
	key: string;
	label: string;
	detail?: string;
	insert?: string;
	run?: () => void;
	section?: string;
	icon: "file" | "folder" | "command" | "skill" | "image" | "plan";
}

export type experimental_ComposerHost =
	"actions" | "banners" | "chips" | "addMenu" | "sendMenu" | "suggestions" | "popups";

export interface experimental_ComposerProps {
	threadId?: string;
	project?: { cwd: string | undefined; onChange(cwd: string): void };
}

export interface experimental_ComposerState {
	target: experimental_ComposerTarget;
	controller: experimental_ComposerController;
	text: string;
	images: string[];
	threadId?: string;
	project?: experimental_ComposerProps["project"];
	running: boolean;
	hasContent: boolean;
	canSend: boolean;
	canStop: boolean;
	placeholder: string;
	whileRunning: "queue" | "steer";
	usage?: { contextTokens?: number; contextWindow: number; cost: number };
	showContextUsage: boolean;
	parts: { project: ReactNode; workspace: ReactNode; permissions: ReactNode; model: ReactNode; comments: ReactNode };
	queued: { id?: string; text: string; steer: boolean; attachments?: number }[];
	suggestions?: { items: experimental_ComposerSuggestion[]; truncated: boolean; start: number; revision: number };
	selected: number;
	dragging: boolean;
	boxRef: RefObject<HTMLDivElement | null>;
	panelRef: RefObject<HTMLDivElement | null>;
	dropProps: Pick<ComponentProps<"div">, "onDragOver" | "onDragLeave" | "onDrop">;
	onKeyDown(event: KeyboardEvent): void;
	refreshSuggestions(text: string, caret: number): Promise<void>;
	setSelected(index: number): void;
	accept(suggestion: experimental_ComposerSuggestion): void;
	toggleAddMenu(): Promise<void>;
	dismissSuggestions(): void;
	submit(alternate: boolean): experimental_EditorResult;
	stop(): void;
	removeImage(path: string): void;
	queueSteer(id: string, text: string): void;
	queueDelete(id: string): void;
	queueEdit(id: string, text: string): void;
}

export interface experimental_ComposerController {
	experimental_getSnapshot(): experimental_ComposerDraft;
	experimental_insert(text: string, revision: number): experimental_EditorResult;
	experimental_replace(range: experimental_EditorSelection, text: string, revision: number): experimental_EditorResult;
	experimental_select(range: experimental_EditorSelection, revision: number): experimental_EditorResult;
	experimental_focus(): experimental_EditorResult;
	experimental_focusEnd(): experimental_EditorResult;
	experimental_caretAnchor(): experimental_CaretAnchor | undefined;
	experimental_lock(signal: AbortSignal): experimental_Disposable;
	experimental_canSubmit(): boolean;
	experimental_submit(alternate?: boolean): experimental_EditorResult;
	experimental_stop(): experimental_EditorResult;
}

export interface experimental_DesktopHost {
	experimental_signal: AbortSignal;
	experimental_backend?: experimental_BackendClient;
	experimental_useBackend?(): experimental_BackendClient | undefined;
	experimental_composer(target: experimental_ComposerTarget): experimental_ComposerController;
	experimental_attachComposerEditor(
		target: experimental_ComposerTarget,
		adapter: experimental_EditorAdapter,
	): experimental_EditorAttachment;
	experimental_useComposerDraft(target: experimental_ComposerTarget): experimental_ComposerDraft;
	experimental_ComposerRoot(props: experimental_ComposerProps): ReactNode;
	experimental_ComposerFrame(props: { editor?: ReactNode }): ReactNode;
	experimental_TextareaEditor(): ReactNode;
	experimental_useComposer(): experimental_ComposerState;
	experimental_useComposerEditor(adapter: experimental_EditorAdapter | undefined): experimental_EditorMount | undefined;
	experimental_ComposerContributions(props: { host: experimental_ComposerHost }): ReactNode;
	experimental_imageThumbnail(path: string): Promise<string | undefined>;
	experimental_conversationServices: experimental_ConversationServices;
	experimental_pickerServices: experimental_PickerServices;
	experimental_ItemRenderer(props: { threadId?: string; item: experimental_ViewItem; children: ReactNode }): ReactNode;
	experimental_MessageActions(props: { threadId: string; item: experimental_ViewItem }): ReactNode;
	experimental_useNavigation(): experimental_NavigationState;
	experimental_useThreadList(): experimental_ThreadListState;
	experimental_useUpdate(): experimental_Update;
	experimental_controls: experimental_Controls;
	experimental_shellServices: experimental_ShellServices;
	experimental_icons: Record<experimental_IconName, ComponentType<Omit<experimental_IconProps, "name">>>;
	experimental_SurfaceHost(props: { surface: "navigation" | "threadList" | "home" | "titleBar" }): ReactNode;
	experimental_Content(): ReactNode;
	experimental_Slots(props: {
		surface: experimental_Surface;
		thread?: experimental_Thread;
		cwd?: string;
		context?: experimental_CommandContext;
	}): ReactNode;
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

export declare function experimental_backend(this: unknown): experimental_BackendClient | undefined;

export declare function experimental_useBackend(this: unknown): experimental_BackendClient | undefined;

export declare function experimental_controllers(this: unknown): experimental_Controllers;

export declare function experimental_composer(this: unknown, target: experimental_ComposerTarget): experimental_ComposerController;

export declare function experimental_attachComposerEditor(this: unknown, target: experimental_ComposerTarget, adapter: experimental_EditorAdapter): experimental_EditorAttachment;

export declare function experimental_useComposerDraft(this: unknown, target: experimental_ComposerTarget): experimental_ComposerDraft;

export declare function experimental_ComposerRoot(this: unknown, props: experimental_ComposerProps): ReactNode;

export declare function experimental_ComposerFrame(this: unknown, props: { editor?: ReactNode }): ReactNode;

export declare function experimental_TextareaEditor(this: unknown): ReactNode;

export declare function experimental_useComposer(this: unknown): experimental_ComposerState;

export declare function experimental_useComposerEditor(this: unknown, adapter: experimental_EditorAdapter | undefined): experimental_EditorMount | undefined;

export declare function experimental_ComposerContributions(this: unknown, props: { host: experimental_ComposerHost }): ReactNode;

export declare function experimental_imageThumbnail(this: unknown, path: string): Promise<string | undefined>;

export declare function experimental_pickerServices(this: unknown): experimental_PickerServices;

export declare function experimental_conversationServices(this: unknown): experimental_ConversationServices;

export declare function experimental_ItemRenderer(this: unknown, props: {
		threadId?: string;
		item: experimental_ViewItem;
		children: ReactNode;
	}): ReactNode;

export declare function experimental_MessageActions(this: unknown, props: { threadId: string; item: experimental_ViewItem }): ReactNode;

export declare function experimental_useToasts(this: unknown): readonly experimental_Toast[];

export declare function experimental_Icon(this: unknown, props: experimental_IconProps): ReactElement;

export declare function experimental_Button(this: unknown, props: experimental_ButtonProps): ReactElement;

export declare function experimental_Portal(this: unknown, props: { children: ReactNode }): ReactNode;

export declare function experimental_KeybindingKeys(this: unknown, props: { binding: experimental_KeybindingId }): ReactElement;

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
			danger?: boolean;
			description?: ReactNode;
			children: ReactNode;
		}
	>;
	experimental_MenuSub: ComponentType<{ label: ReactNode; icon?: ReactNode; minWidth?: number; children: ReactNode }>;
	experimental_MenuSeparator: ComponentType;
	experimental_Kbd: ComponentType<{ children: ReactNode }>;
	experimental_MenuLabel: ComponentType<{ children: ReactNode }>;
	experimental_ListSeparator: ComponentType;
	experimental_ListRow: ComponentType<{
		icon?: ReactNode;
		description?: ReactNode;
		hint?: ReactNode;
		checked?: boolean;
		danger?: boolean;
		onClick(): void;
		children: ReactNode;
	}>;
	experimental_Popover: ComponentType<{
		trigger(open: boolean): ReactNode;
		children(close: () => void): ReactNode;
		open?: boolean;
		onOpenChange?(open: boolean): void;
		takeFocus?: boolean;
		side?: "top" | "bottom";
		align?: "start" | "center" | "end";
		anchor?: RefObject<HTMLElement | null>;
		sideOffset?: number;
		alignOffset?: number;
		className?: string;
	}>;
	experimental_MenuRadioGroup: typeof DropdownMenu.RadioGroup;
	experimental_MenuRadioItem: ComponentType<
		Omit<ComponentProps<typeof DropdownMenu.RadioItem>, "children"> & {
			icon?: ReactNode;
			children: ReactNode;
			description?: ReactNode;
			danger?: boolean;
		}
	>;
	experimental_HoverCard: ComponentType<{ content: ReactNode; children: ReactElement }>;
	experimental_Tooltip: ComponentType<{
		content: ReactNode;
		children: ReactElement;
		overflow?: boolean;
		side?: "top" | "right" | "bottom" | "left";
		align?: "start" | "center" | "end";
	}>;
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

export type experimental_MenuAction = {
	label: string;
	run(): void;
	disabled?: boolean;
	binding?: string;
	danger?: boolean;
	icon?: ComponentType<Omit<experimental_IconProps, "name">>;
};

export type experimental_ContextMenuItem =
	| experimental_MenuAction
	| "-"
	| {
			label: string;
			items: (experimental_MenuAction | "-")[];
			icon?: ComponentType<Omit<experimental_IconProps, "name">>;
	  };

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
	experimental_tokens(value: number): string;
	experimental_basename(path: string): string;
	experimental_samePath(a: string, b: string): boolean;
	experimental_messageTime(time: number): string;
	experimental_clockTime(time: number): string;
	experimental_duration(time: number): string;
	experimental_isControl(target: EventTarget | null): boolean;
	experimental_isEditable(target: EventTarget | null): boolean;
	experimental_useBinding(
		id: string,
		handler: (event: globalThis.KeyboardEvent) => void | false,
		enabled?: boolean,
	): void;
	experimental_useBindings(actions: readonly { binding?: string; run(): void }[], enabled?: boolean): void;
	experimental_isMac(): boolean;
	experimental_bindingLabel(binding: string): string;
	experimental_matches(event: KeyboardEvent | globalThis.KeyboardEvent, binding: string): boolean;
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

export declare function experimental_useNavigation(this: unknown): experimental_NavigationState;

export declare function experimental_useThreadList(this: unknown): experimental_ThreadListState;

export declare function experimental_useUpdate(this: unknown): experimental_Update;

export declare function experimental_controls(this: unknown): experimental_Controls;

export declare function experimental_shellServices(this: unknown): experimental_ShellServices;

export declare function experimental_icons(this: unknown): Record<experimental_IconName, ComponentType<Omit<experimental_IconProps, "name">>>;

export declare function experimental_SurfaceHost(this: unknown, props: {
		surface: "navigation" | "threadList" | "home" | "titleBar";
	}): ReactNode;

export declare function experimental_Content(this: unknown): ReactNode;

export declare function experimental_Slots(this: unknown, props: {
		surface: experimental_Surface;
		thread?: experimental_Thread;
		cwd?: string;
		context?: experimental_CommandContext;
	}): ReactNode;

export declare function experimental_ThreadRow(this: unknown, props: { threadId: string; inset?: boolean }): ReactNode;
