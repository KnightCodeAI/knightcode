/**
 * Window-to-main messages that are not app server envelopes (desktop-shell.md section 4.4).
 * Main validates every request's params against these schemas.
 */

import { type Static, type TSchema, Type } from "typebox";

function Obj<P extends Record<string, TSchema>>(properties: P) {
	return Type.Object(properties, { additionalProperties: false });
}

export const Project = Obj({ path: Type.String(), name: Type.Optional(Type.String()), collapsed: Type.Boolean() });
export type Project = Static<typeof Project>;

const Str = Type.String();
const Customization = Obj({
	accent: Type.Optional(Str),
	background: Type.Optional(Str),
	foreground: Type.Optional(Str),
	/** Font families; a style is the PostScript name of one of the family's faces (Appearance › Advanced). */
	font: Type.Optional(Str),
	fontStyle: Type.Optional(Str),
	contentFont: Type.Optional(Str),
	contentFontStyle: Type.Optional(Str),
	codeFont: Type.Optional(Str),
	codeFontStyle: Type.Optional(Str),
	/** 0-100, Codex's 60 by default: how far surfaces step from the background. */
	contrast: Type.Optional(Type.Number()),
	/** The sidebar over the system's material (acrylic on Windows, vibrancy on macOS). */
	translucentSidebar: Type.Optional(Type.Boolean()),
});

/** Desktop preferences (section 9.10). Agent behaviour stays in settings.json. */
export const Preferences = Obj({
	theme: Type.Union([Type.Literal("system"), Type.Literal("light"), Type.Literal("dark")]),
	/** "enter": Enter sends, Shift+Enter is a new line; "modEnter": the reverse. */
	sendKey: Type.Union([Type.Literal("enter"), Type.Literal("modEnter")]),
	/** What Send does while a turn runs; the other is on Mod+Enter. */
	whileRunning: Type.Union([Type.Literal("queue"), Type.Literal("steer")]),
	allowFullAccess: Type.Boolean(),
	/** Settings › Appearance per theme: hex accent, background and foreground, and a UI font (renderer/appearance.ts). */
	appearance: Type.Optional(Obj({ dark: Type.Optional(Customization), light: Type.Optional(Customization) })),
	/** General › Composer: the context window usage beside the model (on unless false). */
	showContextUsage: Type.Optional(Type.Boolean()),
	/** General: confirm closing a window: never, only on the close shortcut (the default), or always. */
	confirmClose: Type.Optional(Type.Union([Type.Literal("never"), Type.Literal("shortcut"), Type.Literal("always")])),
	/** General: an OS notification when a turn ends: never, only while the window is unfocused (the default), always. */
	turnNotifications: Type.Optional(
		Type.Union([Type.Literal("never"), Type.Literal("unfocused"), Type.Literal("always")]),
	),
	/** General: archive threads idle this many days; absent or 0 never. */
	autoArchiveDays: Type.Optional(Type.Number()),
	/** Appearance › Advanced: base sizes in px (UI 14 and code 12 by default), diff markers, pointer cursors. */
	uiFontSize: Type.Optional(Type.Number()),
	codeFontSize: Type.Optional(Type.Number()),
	diffMarkers: Type.Optional(Type.Union([Type.Literal("color"), Type.Literal("plusMinus")])),
	pointerCursors: Type.Optional(Type.Boolean()),
	/** Rebound shortcuts (Settings › Keyboard shortcuts): a binding id's keys, replacing its defaults; [] unassigns it. */
	keybindings: Type.Optional(Type.Record(Type.String(), Type.Array(Type.String()))),
	/** The "Open" button's app: the last one picked, and per project folder. */
	openIn: Type.Optional(
		Obj({ global: Type.Optional(Type.String()), perPath: Type.Optional(Type.Record(Type.String(), Type.String())) }),
	),
	/** The shell a new terminal runs (section 9.7): the last one picked from the terminal's + menu. */
	terminalShell: Type.Optional(Type.String()),
});
export type Preferences = Static<typeof Preferences>;

export const DEFAULT_PREFERENCES: Preferences = {
	theme: "system",
	sendKey: "enter",
	whileRunning: "queue",
	allowFullAccess: true,
};

/** Desktop-only state (section 7.3). Agent settings live in settings.json, never here. */
export const DesktopState = Obj({
	version: Type.Literal(1),
	projects: Type.Array(Project),
	pinnedThreads: Type.Array(Type.String()),
	lastSeen: Type.Record(Type.String(), Type.String()),
	/** Threads with an unseen outcome (a turn that ended elsewhere) or marked unread (Codex's "Mark as unread"). */
	unread: Type.Optional(Type.Array(Type.String())),
	sidebar: Obj({
		width: Type.Number(),
		/** The sidebar is hidden (the title bar's toggle). */
		collapsed: Type.Boolean(),
		/** Folded sections ("projects", "recents", "pinned", "attention"). */
		collapsedSections: Type.Optional(Type.Array(Type.String())),
		/** Codex's "Organize sidebar": threads under their projects (the default), or every thread in one list. */
		organize: Type.Optional(Type.Union([Type.Literal("project"), Type.Literal("list")])),
		/** Codex's "Sort chats by": newest activity first (the default), or newest thread first. */
		sort: Type.Optional(Type.Union([Type.Literal("updated"), Type.Literal("created")])),
	}),
	// Optional so a file written before preferences existed still loads.
	preferences: Type.Optional(Preferences),
});
export type DesktopState = Static<typeof DesktopState>;

/**
 * The sidebar's width: Codex's default, and the range dragging its edge keeps it in. The minimum is Codex's 290 less
 * the 52px rail, which Codex counts as part of its sidebar.
 */
export const SIDEBAR_WIDTH = { default: 276, min: 238, max: 480 } as const;

export const DEFAULT_STATE: DesktopState = {
	version: 1,
	projects: [],
	pinnedThreads: [],
	lastSeen: {},
	// Codex's sidebar width.
	sidebar: { width: SIDEBAR_WIDTH.default, collapsed: false },
	preferences: DEFAULT_PREFERENCES,
};

export const Profile = Type.Union([
	Obj({ signedIn: Type.Literal(false) }),
	Obj({ signedIn: Type.Literal(true), login: Type.Optional(Type.String()), avatarUrl: Type.Optional(Type.String()) }),
]);
export type Profile = Static<typeof Profile>;

/**
 * The window chrome both processes draw (desktop-shell.md section 9.1): Codex's 36px title bar, the colour of the
 * native caption buttons' symbols, and the shell colour the window shows before the page paints.
 */
export const WINDOW_CHROME = {
	titleBarHeight: 36,
	dark: { symbol: "#ffffff", background: "#202020" },
	light: { symbol: "#1a1c1f", background: "#f3f3f3" },
} as const;

/** Menu and window commands main runs on the sender's webContents. */
export const APP_COMMANDS = [
	"undo",
	"redo",
	"cut",
	"copy",
	"paste",
	"delete",
	"selectAll",
	"reload",
	"toggleDevTools",
	"zoomIn",
	"zoomOut",
	"resetZoom",
	"quit",
	"minimize",
	"toggleMaximize",
	"toggleFullScreen",
	"close",
	/** Bring the window forward (a clicked notification). */
	"focus",
] as const;
export type AppCommandName = (typeof APP_COMMANDS)[number];
export const AppCommand = Type.Unsafe<AppCommandName>(Type.Union(APP_COMMANDS.map((c) => Type.Literal(c))));

/** A native context menu's entries (host/menu/popup), one level of submenus deep, as Codex's row menus are. */
const MenuAction = Obj({
	id: Type.String(),
	label: Type.String(),
	/** Shown at the row's end, in Electron's accelerator syntax ("CmdOrCtrl+Shift+A"); never registered. */
	accelerator: Type.Optional(Type.String()),
	enabled: Type.Optional(Type.Boolean()),
});
const MenuRule = Obj({ separator: Type.Literal(true) });
export const NativeMenuItem = Type.Union([
	MenuAction,
	MenuRule,
	Obj({ label: Type.String(), submenu: Type.Array(Type.Union([MenuAction, MenuRule])) }),
]);
export type NativeMenuItem = Static<typeof NativeMenuItem>;

const TerminalSize = Type.Integer({ minimum: 1, maximum: 1000 });
const TerminalInfo = Obj({
	terminalId: Type.String(),
	threadId: Type.String(),
	cwd: Type.String(),
	shellId: Type.String(),
	shellName: Type.String(),
	/** Present once its shell has ended. */
	exitCode: Type.Optional(Type.Integer()),
});
export type TerminalInfo = Static<typeof TerminalInfo>;

/** Where updating stands, for Settings › About and the title bar (desktop-shell.md section 15). */
export const UpdateState = Type.Union([
	/** Not for this build: an unpackaged one, or Linux, whose package manager updates it. */
	Obj({ state: Type.Literal("unavailable") }),
	/** Not checked yet, or up to date as of `checkedAt`; `error` when that check failed. */
	Obj({ state: Type.Literal("idle"), checkedAt: Type.Optional(Type.Number()), error: Type.Optional(Str) }),
	Obj({ state: Type.Literal("checking") }),
	/** Windows: Squirrel is downloading a newer version. */
	Obj({ state: Type.Literal("downloading") }),
	/** Windows: downloaded; quitting installs it. */
	Obj({ state: Type.Literal("ready"), version: Type.Optional(Str) }),
	/** macOS: a newer release, downloaded from its page. */
	Obj({ state: Type.Literal("available"), version: Str, url: Str }),
]);
export type UpdateState = Static<typeof UpdateState>;

export const HostMethods = {
	/** Show a native context menu at the pointer; resolves with the chosen item's id once it closes. */
	"host/menu/popup": {
		params: Obj({ items: Type.Array(NativeMenuItem) }),
		result: Obj({ id: Type.Optional(Type.String()) }),
	},
	"host/dialog/openFolder": {
		params: Obj({ title: Type.Optional(Type.String()) }),
		result: Obj({ path: Type.Optional(Type.String()) }),
	},
	"host/shell/openExternal": { params: Obj({ url: Type.String() }), result: Obj({}) },
	"host/shell/showInFolder": { params: Obj({ path: Type.String() }), result: Obj({}) },
	/** Open a file in the system's default app ("Open in editor"); program and script files are refused. */
	"host/shell/openPath": { params: Obj({ path: Type.String() }), result: Obj({}) },
	/** The rail's profile: the GitHub account of the KnightCode Remote sign-in the CLI shares. */
	"host/profile/read": { params: Obj({}), result: Profile },
	/** GitHub's device flow in the browser; resolves once the sign-in is approved. */
	"host/profile/signIn": { params: Obj({}), result: Profile },
	"host/profile/signOut": { params: Obj({}), result: Obj({}) },
	/**
	 * The apps a file or folder opens in (section 9.9): editors and terminals found on this machine, then the file
	 * manager and the default app, in the menu's order. `icon` is a data URL of the app's own icon, when it has one.
	 */
	"host/openIn/list": {
		params: Obj({}),
		result: Obj({
			targets: Type.Array(
				Obj({
					id: Type.String(),
					name: Type.String(),
					kind: Type.Union([
						Type.Literal("editor"),
						Type.Literal("terminal"),
						Type.Literal("fileManager"),
						Type.Literal("systemDefault"),
					]),
					icon: Type.Optional(Type.String()),
				}),
			),
		}),
	},
	/** Open an absolute path in a listed app, at a line when the app takes one. */
	"host/openIn/open": {
		params: Obj({
			targetId: Type.String(),
			path: Type.String(),
			line: Type.Optional(Type.Integer({ minimum: 1 })),
			column: Type.Optional(Type.Integer({ minimum: 1 })),
		}),
		result: Obj({}),
	},
	/** The shells a terminal can run (section 9.7), the default first. */
	"host/terminal/shells": {
		params: Obj({}),
		result: Obj({ shells: Type.Array(Obj({ id: Type.String(), name: Type.String() })) }),
	},
	/** A terminal for a thread in a folder; its output arrives as `terminal/data` events in the asking window. */
	"host/terminal/create": {
		params: Obj({
			threadId: Type.String(),
			cwd: Type.String(),
			shellId: Type.Optional(Type.String()),
			cols: TerminalSize,
			rows: TerminalSize,
		}),
		result: TerminalInfo,
	},
	"host/terminal/list": {
		params: Obj({ threadId: Type.String() }),
		result: Obj({ terminals: Type.Array(TerminalInfo) }),
	},
	/** Show a running (or ended) terminal in this window: its last 64 KiB of output, then its events. */
	"host/terminal/attach": {
		params: Obj({ terminalId: Type.String() }),
		result: Obj({ scrollback: Type.String(), exitCode: Type.Optional(Type.Integer()) }),
	},
	/** Keystrokes and pastes, at most 1 MiB at a time. */
	"host/terminal/write": {
		params: Obj({ terminalId: Type.String(), data: Type.String({ maxLength: 1024 * 1024 }) }),
		result: Obj({}),
	},
	"host/terminal/resize": {
		params: Obj({ terminalId: Type.String(), cols: TerminalSize, rows: TerminalSize }),
		result: Obj({}),
	},
	"host/terminal/kill": { params: Obj({ terminalId: Type.String() }), result: Obj({}) },
	/** "Save as…": a copy of an absolute path where the user picks; `path` is where it went, none if cancelled. */
	"host/file/saveCopy": { params: Obj({ path: Type.String() }), result: Obj({ path: Type.Optional(Type.String()) }) },
	"host/clipboard/writeText": { params: Obj({ text: Type.String() }), result: Obj({}) },
	/**
	 * Annotate (section 9.8): a region of a preview's page, in its CSS pixels, saved as a PNG beside pasted images. Only
	 * a guest of the asking window is captured.
	 */
	"host/preview/capture": {
		params: Obj({
			webContentsId: Type.Integer(),
			rect: Obj({
				x: Type.Integer({ minimum: 0 }),
				y: Type.Integer({ minimum: 0 }),
				width: Type.Integer({ minimum: 1 }),
				height: Type.Integer({ minimum: 1 }),
			}),
		}),
		result: Obj({ path: Type.String() }),
	},
	/**
	 * An MCP App's document (section 12.2), served on its own `kc-mcp-app://` origin with a policy from the domains its
	 * resource declared; a declaration that is not a list of host sources answers `invalidParams`.
	 */
	"host/mcpApp/serve": {
		params: Obj({
			html: Type.String({ maxLength: 4 * 1024 * 1024 }),
			csp: Type.Optional(
				Obj({
					connectDomains: Type.Optional(Type.Unknown()),
					resourceDomains: Type.Optional(Type.Unknown()),
					frameDomains: Type.Optional(Type.Unknown()),
					baseUriDomains: Type.Optional(Type.Unknown()),
				}),
			),
		}),
		result: Obj({ id: Type.String(), url: Type.String() }),
	},
	"host/mcpApp/release": { params: Obj({ id: Type.String() }), result: Obj({}) },
	/** The user's rebindings, so main knows which keys a focused preview hands to the app (section 9.8). */
	"host/keys/set": {
		params: Obj({ overrides: Type.Record(Type.String(), Type.Array(Type.String())) }),
		result: Obj({}),
	},
	/** The clipboard's text, for a paste into a terminal (a page cannot read the clipboard). */
	"host/clipboard/readText": { params: Obj({}), result: Obj({ text: Type.String() }) },
	"host/window/setTitle": { params: Obj({ title: Type.String() }), result: Obj({}) },
	/** Another window, showing a thread when one is named (Codex's "Open in new window"). */
	"host/window/open": { params: Obj({ threadId: Type.Optional(Type.String()) }), result: Obj({}) },
	/**
	 * This window's part in what every window hears about: `primary` (the focused window, else the one focused last)
	 * is the one that notifies, marks unread and auto-archives; `heldElsewhere` are the threads other windows hold.
	 */
	"host/window/role": {
		params: Obj({}),
		result: Obj({ primary: Type.Boolean(), heldElsewhere: Type.Array(Type.String()) }),
	},
	"host/state/read": { params: Obj({}), result: DesktopState },
	"host/state/write": { params: Obj({ state: DesktopState }), result: Obj({}) },
	"host/dialog/openFiles": {
		params: Obj({ images: Type.Optional(Type.Boolean()) }),
		result: Obj({ paths: Type.Array(Type.String()) }),
	},
	"host/clipboard/readImage": { params: Obj({}), result: Obj({ path: Type.Optional(Type.String()) }) },
	"host/image/thumbnail": {
		params: Obj({ path: Type.String() }),
		result: Obj({ dataUrl: Type.Optional(Type.String()) }),
	},
	/**
	 * The caption buttons' colours, and the sidebar's material when `translucent` (Appearance › Translucent sidebar):
	 * acrylic on Windows 11 22H2 and later, vibrancy on macOS. `translucent` in the result says whether it took.
	 */
	"host/window/setTheme": {
		params: Obj({ dark: Type.Boolean(), translucent: Type.Optional(Type.Boolean()) }),
		result: Obj({ translucent: Type.Boolean() }),
	},
	"host/app/command": { params: Obj({ command: AppCommand }), result: Obj({}) },
	"host/server/restart": { params: Obj({}), result: Obj({}) },
	"host/app/info": {
		params: Obj({}),
		result: Obj({
			appVersion: Type.String(),
			serverVersion: Type.String(),
			platform: Type.String(),
			logsDir: Type.String(),
		}),
	},
	"host/update/state": { params: Obj({}), result: UpdateState },
	/** Starts a check unless one is under way, and answers where updating stands then. */
	"host/update/check": { params: Obj({}), result: UpdateState },
	/** Windows, once ready: quit and install, after asking when threads are running. */
	"host/update/install": { params: Obj({}), result: Obj({}) },
} as const;

export type HostMethod = keyof typeof HostMethods;
export type OpenInTargetInfo = Static<(typeof HostMethods)["host/openIn/list"]["result"]>["targets"][number];
export type HostParams<M extends HostMethod> = Static<(typeof HostMethods)[M]["params"]>;
export type HostResult<M extends HostMethod> = Static<(typeof HostMethods)[M]["result"]>;

export interface HostRequest {
	id: number;
	host: HostMethod;
	params: unknown;
}
export type HostResponse = { id: number; result: unknown } | { id: number; error: { code: string; message: string } };

/** Main-originated events that are not protocol notifications. */
export type HostEvent =
	| { event: "server/state"; state: "starting" | "ready" | "restarting" | "failed"; message?: string }
	/** A `knightcode://` link to show (section 6.1). */
	| { event: "navigate"; route: string }
	/** The window's zoom changed (View › Zoom In, Zoom Out, Actual Size); 1 is 100%. */
	| { event: "zoom"; factor: number }
	/** A terminal's output since the last, at most every 16 ms (section 9.7). */
	| { event: "terminal/data"; terminalId: string; data: string }
	| { event: "terminal/exit"; terminalId: string; exitCode: number }
	/** An app binding pressed while a preview's page had focus, to run as if pressed in the window (section 9.8). */
	| { event: "key"; binding: string }
	| { event: "update"; update: UpdateState };

export interface WindowGlobals {
	platform: NodeJS.Platform;
	windowId: number;
	/** A dropped file's path on disk; empty for one that has none (dragged out of another app's memory). */
	pathForFile: (file: File) => string;
}
