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

/** Desktop preferences (section 9.10). Agent behaviour stays in settings.json. */
export const Preferences = Obj({
	theme: Type.Union([Type.Literal("system"), Type.Literal("light"), Type.Literal("dark")]),
	/** "enter": Enter sends, Shift+Enter is a new line; "modEnter": the reverse. */
	sendKey: Type.Union([Type.Literal("enter"), Type.Literal("modEnter")]),
	/** What Send does while a turn runs; the other is on Mod+Enter. */
	whileRunning: Type.Union([Type.Literal("queue"), Type.Literal("steer")]),
	allowFullAccess: Type.Boolean(),
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
	sidebar: Obj({ width: Type.Number(), collapsed: Type.Boolean() }),
	// Optional so a file written before preferences existed still loads.
	preferences: Type.Optional(Preferences),
});
export type DesktopState = Static<typeof DesktopState>;

export const DEFAULT_STATE: DesktopState = {
	version: 1,
	projects: [],
	pinnedThreads: [],
	lastSeen: {},
	sidebar: { width: 300, collapsed: false },
	preferences: DEFAULT_PREFERENCES,
};

export const Profile = Type.Union([
	Obj({ signedIn: Type.Literal(false) }),
	Obj({ signedIn: Type.Literal(true), login: Type.Optional(Type.String()), avatarUrl: Type.Optional(Type.String()) }),
]);
export type Profile = Static<typeof Profile>;

/** Menu and window commands main runs on the sender's webContents. */
export const APP_COMMANDS = [
	"undo",
	"redo",
	"cut",
	"copy",
	"paste",
	"selectAll",
	"reload",
	"toggleDevTools",
	"zoomIn",
	"zoomOut",
	"resetZoom",
	"quit",
	"minimize",
	"toggleMaximize",
	"close",
] as const;
export type AppCommandName = (typeof APP_COMMANDS)[number];
export const AppCommand = Type.Unsafe<AppCommandName>(Type.Union(APP_COMMANDS.map((c) => Type.Literal(c))));

export const HostMethods = {
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
	"host/clipboard/writeText": { params: Obj({ text: Type.String() }), result: Obj({}) },
	"host/window/setTitle": { params: Obj({ title: Type.String() }), result: Obj({}) },
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
	"host/window/setTheme": { params: Obj({ dark: Type.Boolean() }), result: Obj({}) },
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
} as const;

export type HostMethod = keyof typeof HostMethods;
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
	| { event: "navigate"; route: string };

export interface WindowGlobals {
	platform: NodeJS.Platform;
	windowId: number;
}
