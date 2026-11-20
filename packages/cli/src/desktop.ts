/** Experimental desktop contributions. This entry is inert outside a desktop renderer and has no runtime imports. */
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
import type { experimental_BackendDataSelector } from "./desktop-backend.ts";

/** Transport loss never implies that an admitted write was rolled back. */
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
	file?: experimental_FileIntent;
	workspace?: experimental_Checkout;
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
	| "transcriptItem"
	| "terminal"
	| "code"
	| "diff"
	| "settings"
	| "settingsNav";

/** Only these surfaces accept selectable replacement providers. */
export type experimental_ProviderSurface =
	| "feedback"
	| "layout"
	| "navigation"
	| "threadList"
	| "home"
	| "titleBar"
	| "composer"
	| "threadHeader"
	| "requests"
	| "terminal"
	| "code"
	| "diff"
	| "settings"
	| "settingsNav";

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
	experimental_registerPanelTab(tab: experimental_Page): experimental_Disposable;
	experimental_registerFileOpener(opener: experimental_FileOpener): experimental_Disposable;
	experimental_hideNavigation(entry: experimental_NavigationVisibility): experimental_Disposable;
	experimental_registerSlot(slot: experimental_SurfaceContribution): experimental_Disposable;
	experimental_registerItemRenderer(
		renderer: Omit<experimental_SurfaceContribution, "surface">,
	): experimental_Disposable;
	experimental_registerMessageAction(
		action: Omit<experimental_SurfaceContribution, "surface">,
	): experimental_Disposable;
	experimental_registerProvider(provider: experimental_ProviderContribution): experimental_Disposable;
	experimental_registerSettingsSection(section: experimental_SettingsSection): experimental_Disposable;
	experimental_registerThemePreset(preset: experimental_ThemePreset): experimental_Disposable;
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

/** Explicit composer identity; a captured thread never follows later navigation. */
export type experimental_ComposerTarget = { threadId: string } | { cwd: string | undefined };

/** UTF-16 offsets in the adapter's normalized plain text. */
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

/** Adapter calls are synchronous; apply must not report a second editor transaction. */
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
	workspaceChoice?: {
		value: experimental_WorkspaceRequest;
		experimental_select(value: experimental_WorkspaceRequest): boolean;
	};
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

/** Renderer-installed bindings; not a raw bridge or a separate state container. */
export type experimental_Checkout = Domain.DesktopCheckout;
export type experimental_GitAction = Domain.DesktopWorkspaceAction;
export type experimental_Operation = Domain.DesktopOperation;
export type experimental_WorkspaceThread = Domain.Thread;
export type experimental_WorkspaceRequest = Domain.WorkspaceRequest;
export type experimental_GitBranches = Domain.GitBranches;
export type experimental_Environment = Domain.Environment;
export type experimental_Handoff = Extract<experimental_GitAction, { kind: "handoff" }>;
export type experimental_HandoffCheck =
	| { status: "checking" }
	| { status: "ready"; branch?: string }
	| { status: "refused" | "transport-error"; problem: Domain.DesktopOperationProblem };

export interface experimental_GitController {
	experimental_run(action: experimental_GitAction): Promise<experimental_Operation | undefined>;
	experimental_recover(
		id: string,
		action: "retry" | "cancel" | "acknowledge",
	): Promise<experimental_Operation | undefined>;
	experimental_openPullRequest(id: string): Promise<boolean>;
}

export interface experimental_GitRead {
	status?: Domain.GitStatus;
	totals?: { additions: number; deletions: number };
	branches?: Domain.GitBranches;
	operation?: experimental_Operation;
	operations: readonly experimental_Operation[];
}

export interface experimental_WorkspaceServices {
	experimental_git(target: experimental_Checkout): experimental_GitController;
	experimental_useGit(
		target: experimental_Checkout,
		reads?: { status?: boolean; totals?: boolean; branches?: boolean; once?: boolean },
	): experimental_GitRead;
	experimental_useBranchSuggestion(title: string): string;
	experimental_useHandoffCheck(target: experimental_Checkout, action: experimental_Handoff): experimental_HandoffCheck;
	experimental_useWorkspaceOptions(cwd?: string): {
		branches?: Domain.GitBranches;
		environments?: Domain.Environment[];
	};
}

export function experimental_workspaceServices(this: unknown): experimental_WorkspaceServices {
	return host(this).experimental_workspaceServices;
}

export interface experimental_FileIntent {
	target: experimental_Checkout;
	path: string;
	line?: number;
}

export interface experimental_FileOpener {
	id: string;
	label: string;
	order?: number;
	/** Local id of this owner's panel tab. It receives the intent as context.file. */
	tab: string;
	experimental_matches?(intent: experimental_FileIntent): boolean;
}

export type experimental_FileDraft = { text: string; mtimeMs: number };
export type experimental_PanelTab = (
	| { kind: "changes" | "files" }
	| { kind: "file"; path: string; preview: boolean; draft?: experimental_FileDraft }
	| { kind: "preview"; id: string; url: string }
	| { kind: "mcpApp"; itemId: string }
	| { kind: "backgroundShell"; id: string }
) & { id: string };

export interface experimental_PanelController {
	experimental_openFile(path: string, line?: number, opener?: string): boolean;
	experimental_openPreview(url?: string): boolean;
	experimental_openApp(itemId: string): boolean;
	experimental_select(id: string): boolean;
	experimental_close(id: string): boolean;
	experimental_setVisible(open: boolean): boolean;
	experimental_readFile(path: string): Promise<Domain.FileRead | undefined>;
	experimental_listFiles(path?: string): Promise<Domain.FileList | undefined>;
	experimental_readDiff(scope: Domain.DiffScope): Promise<Domain.DiffRead | undefined>;
	experimental_setFileDraft(path: string, draft?: experimental_FileDraft): boolean;
	experimental_saveFile(path: string): Promise<experimental_FileDraft | undefined>;
	experimental_openExternally(path: string, application: string, line?: number): boolean;
	experimental_fileOpeners(path: string): { id: string; label: string }[];
	experimental_newTerminal(shell?: string): Promise<void>;
	experimental_terminalShells(): Promise<{ id: string; name: string }[]>;
	experimental_showTerminal(open: boolean): boolean;
	experimental_selectTerminal(id: string): boolean;
	experimental_closeTerminal(id: string): boolean;
	experimental_stopBackgroundShell(id: string): Promise<boolean>;
}

export interface experimental_PanelServices {
	experimental_panel(target: experimental_Checkout): experimental_PanelController;
	experimental_usePanel(target: experimental_Checkout): {
		open: boolean;
		active: string;
		tabs: experimental_PanelTab[];
		contributions: { id: string; label: string }[];
	};
	experimental_useTerminals(target: experimental_Checkout): {
		open: boolean;
		active?: string;
		terminals: { terminalId: string; shellId: string; shellName: string; cwd: string; exitCode?: number }[];
	};
	/** The host engine for the current code/diff surface, including drafts and annotations. */
	experimental_EditorHost: ComponentType;
	experimental_TerminalHost: ComponentType<{ target: experimental_Checkout }>;
	experimental_PreviewHost: ComponentType<{ target: experimental_Checkout; id: string; active: boolean }>;
	experimental_McpAppHost: ComponentType<{ target: experimental_Checkout; itemId: string }>;
}

export function experimental_panelServices(this: unknown): experimental_PanelServices {
	return host(this).experimental_panelServices;
}

export interface experimental_DesktopHost {
	experimental_panelServices: experimental_PanelServices;
	experimental_workspaceServices: experimental_WorkspaceServices;
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
	experimental_settingsServices: experimental_SettingsServices;
	experimental_settingsControls: experimental_SettingsControls;
	experimental_appearance: experimental_Appearance;
	experimental_SettingsSections(props: { page: experimental_SettingsPage }): ReactNode;
	experimental_ThemeScope(props: {
		theme: experimental_ThemeName;
		customization?: experimental_ThemeCustomization;
		className?: string;
		children: ReactNode;
	}): ReactNode;
	experimental_useZoom(): experimental_Zoom;
}

declare global {
	var __knightcodeDesktop: experimental_DesktopHost | undefined;
}

const activationHost = Symbol.for("knightcode.desktop.activationHost");

function host(context: unknown): experimental_DesktopHost {
	// In-process scope marker is supplied by the host facade, not an isolation boundary between trusted renderers.
	const scoped = context && typeof context === "object" && Reflect.get(context, activationHost) === true;
	const value = scoped ? (context as experimental_DesktopHost) : globalThis.__knightcodeDesktop;
	if (!value) throw new Error("The desktop SDK requires a KnightCode desktop renderer host.");
	return value;
}

/** Get this activation's backend; built-in/window imports have no extension backend authority. */
export function experimental_backend(this: unknown): experimental_BackendClient | undefined {
	return host(this).experimental_backend;
}

/** Reactively expose the backend only after the coordinated ready decision. */
export function experimental_useBackend(this: unknown): experimental_BackendClient | undefined {
	return host(this).experimental_useBackend?.();
}

/** Get stable controllers backed by the window's existing store. */
export function experimental_controllers(this: unknown): experimental_Controllers {
	return host(this).experimental_controllers;
}

/** Get a revisioned controller for an explicit composer identity. */
export function experimental_composer(
	this: unknown,
	target: experimental_ComposerTarget,
): experimental_ComposerController {
	return host(this).experimental_composer(target);
}

/** Attach an editor for one mount; dispose it on unmount and handle composition-time refusal. */
export function experimental_attachComposerEditor(
	this: unknown,
	target: experimental_ComposerTarget,
	adapter: experimental_EditorAdapter,
): experimental_EditorAttachment {
	return host(this).experimental_attachComposerEditor(target, adapter);
}

/** Subscribe to the canonical draft without exposing the private renderer store. */
export function experimental_useComposerDraft(
	this: unknown,
	target: experimental_ComposerTarget,
): experimental_ComposerDraft {
	return host(this).experimental_useComposerDraft(target);
}

/** Mount shared composer behavior and the user-selected presentation for an explicit target. */
export function experimental_ComposerRoot(this: unknown, props: experimental_ComposerProps): ReactNode {
	return host(this).experimental_ComposerRoot(props);
}

/** Reuse the standard composer layout with a different editor implementation. */
export function experimental_ComposerFrame(this: unknown, props: { editor?: ReactNode }): ReactNode {
	return host(this).experimental_ComposerFrame(props);
}

/** Render the built-in textarea using the same editor-adapter contract as external editors. */
export function experimental_TextareaEditor(this: unknown): ReactNode {
	return host(this).experimental_TextareaEditor();
}

/** Read root-owned state and services; a replacement does not own the draft or submit rules. */
export function experimental_useComposer(this: unknown): experimental_ComposerState {
	return host(this).experimental_useComposer();
}

/** Bind one adapter to this root and synchronize canonical revisions without echo transactions. */
export function experimental_useComposerEditor(
	this: unknown,
	adapter: experimental_EditorAdapter | undefined,
): experimental_EditorMount | undefined {
	return host(this).experimental_useComposerEditor(adapter);
}

/** Mount a required contribution location once, preserving each contribution's ownership. */
export function experimental_ComposerContributions(
	this: unknown,
	props: { host: experimental_ComposerHost },
): ReactNode {
	return host(this).experimental_ComposerContributions(props);
}

/** Read an attached image thumbnail through the mediated host image service. */
export function experimental_imageThumbnail(this: unknown, path: string): Promise<string | undefined> {
	return host(this).experimental_imageThumbnail(path);
}

/** Read the supported picker data without exposing store selectors. */
export function experimental_pickerServices(this: unknown): experimental_PickerServices {
	return host(this).experimental_pickerServices;
}

/** Read thread domain state and invoke finite, explicitly targeted conversation intents. */
export function experimental_conversationServices(this: unknown): experimental_ConversationServices {
	return host(this).experimental_conversationServices;
}

/** Render the first matching external item renderer, with the built-in body as recovery fallback. */
export function experimental_ItemRenderer(
	this: unknown,
	props: {
		threadId?: string;
		item: experimental_ViewItem;
		children: ReactNode;
	},
): ReactNode {
	return host(this).experimental_ItemRenderer(props);
}

/** Mount message actions with the exact thread and item that rendered them. */
export function experimental_MessageActions(
	this: unknown,
	props: { threadId: string; item: experimental_ViewItem },
): ReactNode {
	return host(this).experimental_MessageActions(props);
}

/** Subscribe to host-owned notifications; remounting a presenter does not reset them. */
export function experimental_useToasts(this: unknown): readonly experimental_Toast[] {
	return host(this).experimental_useToasts();
}

/** Draw a host icon by its public name. */
export function experimental_Icon(this: unknown, props: experimental_IconProps): ReactElement {
	return host(this).experimental_Icon(props);
}

/** Draw the shared themed button without importing renderer components. */
export function experimental_Button(this: unknown, props: experimental_ButtonProps): ReactElement {
	return host(this).experimental_Button(props);
}

/** Render an owned portal with the contribution\'s revision, theme and disposal lifetime. */
export function experimental_Portal(this: unknown, props: { children: ReactNode }): ReactNode {
	return host(this).experimental_Portal(props);
}

/** Draw the user\'s configured keys for a command. */
export function experimental_KeybindingKeys(
	this: unknown,
	props: { binding: experimental_KeybindingId },
): ReactElement {
	return host(this).experimental_KeybindingKeys(props);
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
	experimental_Dialog: ComponentType<{
		open?: boolean;
		onClose(): void;
		title: ReactNode;
		description?: ReactNode;
		icon?: ReactNode;
		variant?: "dialog" | "card";
		placement?: "center" | "top";
		width?: number;
		children: ReactNode;
	}>;
	experimental_Switch: ComponentType<{
		checked: boolean;
		onChange(value: boolean): void;
		label: string;
		size?: "sm" | "md";
		disabled?: boolean;
	}>;
	experimental_ListCaption: ComponentType<{ children: ReactNode }>;
	experimental_GitTotals: ComponentType<{ additions: number; deletions: number; className?: string }>;
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
	experimental_DeleteThreadDialog: ComponentType<{
		thread: { id: string; name: string };
		onClose(): void;
		onDeleted?(): void;
	}>;
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
	| { state: "idle"; checkedAt?: number; error?: string }
	| { state: "checking" }
	| { state: "downloading" }
	| { state: "ready"; version?: string }
	| { state: "available"; version: string; url: string };

/** Read the current navigation and history without exposing store selectors. */
export function experimental_useNavigation(this: unknown): experimental_NavigationState {
	return host(this).experimental_useNavigation();
}

/** Read projects, threads, unread and sidebar presentation preferences. */
export function experimental_useThreadList(this: unknown): experimental_ThreadListState {
	return host(this).experimental_useThreadList();
}

/** Read the update indicator state; update installation remains host-mediated. */
export function experimental_useUpdate(this: unknown): experimental_Update {
	return host(this).experimental_useUpdate();
}

/** Get shared accessible themed controls for structural providers. */
export function experimental_controls(this: unknown): experimental_Controls {
	return host(this).experimental_controls;
}

/** Get finite structural presenter services, never the raw host bridge. */
export function experimental_shellServices(this: unknown): experimental_ShellServices {
	return host(this).experimental_shellServices;
}

/** Get shared icons without a private renderer import. */
export function experimental_icons(
	this: unknown,
): Record<experimental_IconName, ComponentType<Omit<experimental_IconProps, "name">>> {
	return host(this).experimental_icons;
}

/** Mount a structural host; recursive replacement of the same surface is refused. */
export function experimental_SurfaceHost(
	this: unknown,
	props: {
		surface: "navigation" | "threadList" | "home" | "titleBar";
	},
): ReactNode {
	return host(this).experimental_SurfaceHost(props);
}

/** Mount the host-owned current-view region, including recovery settings. */
export function experimental_Content(this: unknown): ReactNode {
	return host(this).experimental_Content();
}

/** Mount ordered contributions at their original ownership roots. */
export function experimental_Slots(
	this: unknown,
	props: {
		surface: experimental_Surface;
		thread?: experimental_Thread;
		cwd?: string;
		context?: experimental_CommandContext;
	},
): ReactNode {
	return host(this).experimental_Slots(props);
}

/** Mount a shared thread row with its context menu, dialogs, status and keyboard activation. */
export function experimental_ThreadRow(this: unknown, props: { threadId: string; inset?: boolean }): ReactNode {
	return host(this).experimental_ThreadRow(props);
}

/** One theme's customization: hex colours, fonts and their faces, contrast and the sidebar material. */
export interface experimental_ThemeCustomization {
	accent?: string;
	background?: string;
	foreground?: string;
	font?: string;
	fontStyle?: string;
	contentFont?: string;
	contentFontStyle?: string;
	codeFont?: string;
	codeFontStyle?: string;
	contrast?: number;
	translucentSidebar?: boolean;
}

export type experimental_ThemeName = "light" | "dark";
export type experimental_ThemeMode = "system" | experimental_ThemeName;

/** A named customization users can apply; registering one never changes the current theme. */
export interface experimental_ThemePreset {
	id: string;
	label: string;
	theme: experimental_ThemeName;
	customization: experimental_ThemeCustomization;
	order?: number;
}

/** A registered preset; `id` is `<owner>/<local id>`. */
export interface experimental_ThemePresetEntry extends experimental_ThemePreset {
	owner: string;
}

export interface experimental_AppearanceState {
	mode: experimental_ThemeMode;
	theme: experimental_ThemeName;
	customization: Readonly<Partial<Record<experimental_ThemeName, experimental_ThemeCustomization>>>;
	uiFontSize?: number;
	codeFontSize?: number;
	diffMarkers?: "color" | "plusMinus";
	pointerCursors?: boolean;
}

/** The single, explicit path for application-wide theme changes. */
export interface experimental_Appearance {
	experimental_useState(): experimental_AppearanceState;
	experimental_usePresets(): readonly experimental_ThemePresetEntry[];
	/** The built-in palette's base colours before any customization. */
	experimental_base(theme: experimental_ThemeName): { background: string; foreground: string; accent: string };
	experimental_accents: readonly { name: string; hex: string }[];
	experimental_defaultContrast: number;
	experimental_setMode(mode: experimental_ThemeMode): boolean;
	/** Merge a patch, or with `replace` start over from it; undefined restores the built-in palette. */
	experimental_customize(
		theme: experimental_ThemeName,
		patch: experimental_ThemeCustomization | undefined,
		replace?: boolean,
	): boolean;
	experimental_applyPreset(id: string): boolean;
	/** Undefined restores a size's default. */
	experimental_setSize(key: "uiFontSize" | "codeFontSize", px: number | undefined): boolean;
	experimental_setDiffMarkers(markers: "color" | "plusMinus"): boolean;
	experimental_setPointerCursors(on: boolean): boolean;
	experimental_themeString(customization: experimental_ThemeCustomization): string;
	experimental_parseThemeString(text: string): experimental_ThemeCustomization | undefined;
	/** Installed fonts, or undefined when the query was refused (it may need a user gesture). */
	experimental_localFonts(): Promise<{ family: string; style: string; postscriptName: string }[] | undefined>;
}

/** A scope a declarative settings section can write. */
export type experimental_SettingsScope = "app" | "project" | "thread";

/** A schema field bound to one setting key. */
export type experimental_SettingsField = {
	key: string;
	title: string;
	detail?: string;
	/** Read from the user's settings only, so a project's page leaves it out. */
	userOnly?: boolean;
	/** What an unset key means where the store's defaults do not say. */
	fallback?: unknown;
} & (
	| { kind: "switch" }
	| { kind: "select"; options: readonly (readonly [value: unknown, label: string])[] }
	| { kind: "number"; min: number; max: number; unit: string }
);

/**
 * A settings section: a declarative schema over the owner's epoch-bound backend settings (the usual case), or a custom
 * React body. `scopes` (default `["app"]`) lists where a schema section's values may be set; with more than one, the
 * host shows a scope picker of the app, the sidebar's projects and their threads, and reads and writes the chosen
 * scope only. Reads still inherit thread > project > app > default.
 */
export type experimental_SettingsSection = {
	id: string;
	page: experimental_SettingsPage;
	order?: number;
	experimental_available?(context: experimental_CommandContext): boolean;
} & (
	| { title: string; fields: readonly experimental_SettingsField[]; scopes?: readonly experimental_SettingsScope[] }
	| {
			title?: string;
			experimental_render(props: { context: experimental_CommandContext; signal: AbortSignal }): ReactNode;
	  }
);

export type experimental_SettingsRequests = Domain.SettingsRequests;

/** Mediated settings reads and writes; the host refuses methods outside its settings allowlist. */
export interface experimental_SettingsServices {
	experimental_request<M extends keyof Domain.SettingsRequests>(
		method: M,
		params: Domain.SettingsRequests[M]["params"],
	): Promise<Domain.SettingsRequests[M]["result"]>;
	experimental_usePreferences(): experimental_DesktopPreferences;
	experimental_setPreference<K extends keyof experimental_DesktopPreferences>(
		key: K,
		value: experimental_DesktopPreferences[K],
	): boolean;
	experimental_keybindings(): readonly { id: string; description: string; defaultKeys: readonly string[] }[];
	experimental_setKeybinding(id: string, keys: string[] | undefined): boolean;
	experimental_comboFromEvent(event: KeyboardEvent | globalThis.KeyboardEvent): string | undefined;
	experimental_keyLabel(keys: string): string;
	experimental_useAccounts(): Domain.SettingsRequests["account/list"]["result"] | undefined;
	experimental_refreshAccounts(): Promise<void>;
	experimental_useLogin(id: string): experimental_LoginState | undefined;
	experimental_startLogin(provider: string, type: "oauth" | "api_key"): Promise<string | undefined>;
	experimental_answerLogin(id: string, value: string): Promise<void>;
	experimental_cancelLogin(id: string): Promise<void>;
	experimental_logout(provider: string): Promise<void>;
	experimental_useDefaultModel(): string | null;
	experimental_setDefaultModel(model: Domain.ModelInfo): Promise<void>;
	experimental_listArchived(): Promise<Domain.SettingsRequests["thread/list"]["result"]["threads"]>;
	experimental_unarchive(threadId: string): Promise<void>;
	experimental_deleteThread(threadId: string): Promise<void>;
	/** Changes when a thread enters or leaves the live list. */
	experimental_useLiveThreadIds(): string;
	experimental_appInfo(): Promise<{ appVersion: string; serverVersion: string; platform: string; logsDir: string }>;
	experimental_openExternal(url: string): Promise<boolean>;
	experimental_openPath(path: string): Promise<boolean>;
	experimental_copyText(text: string): Promise<boolean>;
	experimental_errorText(error: unknown): string;
	experimental_filterArchived(
		threads: Domain.SettingsRequests["thread/list"]["result"]["threads"],
		filter: experimental_ArchiveFilter,
		projects: experimental_Project[],
	): [name: string, threads: Domain.SettingsRequests["thread/list"]["result"]["threads"]][];
	experimental_noProject: string;
	/** Host-owned native desktop extension management and its recovery controls. */
	experimental_NativeExtensions: ComponentType<{ cwd?: string }>;
}

export interface experimental_ArchiveFilter {
	query: string;
	kind: "all" | "local" | "worktree";
	sort: "updated" | "created" | "name";
	/** A project's folder, every project, or threads outside any project. */
	project: "all" | "none" | (string & {});
}

export type experimental_LoginState = {
	status: "pending" | "complete" | "failed";
	events: unknown[];
	error?: string;
	pendingPrompt?: {
		prompt: {
			type?: string;
			message: string;
			placeholder?: string;
			options?: { id: string; label: string; description?: string }[];
		};
	};
};

/** Desktop preferences stored in desktop-state.json; agent behaviour stays in settings.json. */
export interface experimental_DesktopPreferences {
	theme: experimental_ThemeMode;
	sendKey: "enter" | "modEnter";
	whileRunning: "queue" | "steer";
	allowFullAccess: boolean;
	appearance?: Partial<Record<experimental_ThemeName, experimental_ThemeCustomization>>;
	showContextUsage?: boolean;
	confirmClose?: "never" | "shortcut" | "always";
	turnNotifications?: "never" | "unfocused" | "always";
	autoArchiveDays?: number;
	uiFontSize?: number;
	codeFontSize?: number;
	diffMarkers?: "color" | "plusMinus";
	pointerCursors?: boolean;
	keybindings?: Record<string, string[]>;
}

export interface experimental_ConfigFile {
	read: Domain.SettingsRequests["config/read"]["result"];
	/** The project whose settings.json this edits; the user's when unset. */
	cwd: string | undefined;
	write(key: string, value: unknown): Promise<void>;
}

/** Settings page layout and the declarative field renderer, shared by built-in and extension sections. */
export interface experimental_SettingsControls {
	experimental_Row: ComponentType<{
		title: ReactNode;
		detail?: ReactNode;
		compact?: boolean;
		below?: ReactNode;
		children?: ReactNode;
	}>;
	experimental_Section: ComponentType<{ title?: ReactNode; aside?: ReactNode; children: ReactNode }>;
	experimental_Box: ComponentType<{ children: ReactNode }>;
	experimental_Card: ComponentType<{ title?: ReactNode; aside?: ReactNode; children: ReactNode }>;
	experimental_PageHeader: ComponentType<{ title: string; actions?: ReactNode }>;
	experimental_PageBody: ComponentType<{ children: ReactNode }>;
	experimental_PageBar: ComponentType<{ children: ReactNode }>;
	experimental_SearchField: ComponentType<{
		value: string;
		onChange(value: string): void;
		placeholder: string;
		page?: boolean;
	}>;
	experimental_SizeField: ComponentType<{
		label: string;
		value: number;
		min: number;
		max: number;
		unit?: string;
		onChange(value: number): void;
	}>;
	experimental_SelectMenu: ComponentType<{
		label: string;
		value: string | undefined;
		options: { value: string; label: string; description?: string }[];
		onChange(value: string): void;
	}>;
	experimental_Segmented: ComponentType<{
		label: string;
		value: string;
		options: { value: string; label: string }[];
		onChange(value: string): void;
	}>;
	experimental_DialogActions: ComponentType<{ children: ReactNode }>;
	experimental_SidebarFrame: ComponentType<{ label: string; children: ReactNode }>;
	experimental_ModelList: ComponentType<{
		model: Domain.ModelInfo | undefined;
		onModel(model: Domain.ModelInfo): void;
		className?: string;
	}>;
	/** Render config fields against a settings.json read; built-in pages use this same renderer. */
	experimental_ConfigFields: ComponentType<{
		sections: readonly (readonly [title: string, fields: readonly experimental_SettingsField[]])[];
		file: experimental_ConfigFile;
	}>;
	experimental_useConfigFile(cwd: string | undefined, trusted?: boolean): experimental_ConfigFile | undefined;
}

export interface experimental_Zoom {
	factor: number;
	/** Increments on every zoom change, including a repeat of the same factor. */
	changes: number;
}

/** Get mediated settings reads/writes and preferences. */
export function experimental_settingsServices(this: unknown): experimental_SettingsServices {
	return host(this).experimental_settingsServices;
}

/** Get the shared settings layout controls and schema renderer. */
export function experimental_settingsControls(this: unknown): experimental_SettingsControls {
	return host(this).experimental_settingsControls;
}

/** Get the explicit appearance API; extension CSS cannot redefine host tokens. */
export function experimental_appearance(this: unknown): experimental_Appearance {
	return host(this).experimental_appearance;
}

/** Mount a page's admitted sections in order, each at its own ownership root. */
export function experimental_SettingsSections(this: unknown, props: { page: experimental_SettingsPage }): ReactNode {
	return host(this).experimental_SettingsSections(props);
}

/** Preview a theme in a subtree; owned portals opened inside follow the previewed theme. */
export function experimental_ThemeScope(
	this: unknown,
	props: {
		theme: experimental_ThemeName;
		customization?: experimental_ThemeCustomization;
		className?: string;
		children: ReactNode;
	},
): ReactNode {
	return host(this).experimental_ThemeScope(props);
}

/** Read the window zoom level for feedback presentation; zoom intents stay window commands. */
export function experimental_useZoom(this: unknown): experimental_Zoom {
	return host(this).experimental_useZoom();
}
