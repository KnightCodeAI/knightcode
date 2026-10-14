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

/** Desktop-only state (section 7.3). Agent settings live in settings.json, never here. */
export const DesktopState = Obj({
	version: Type.Literal(1),
	projects: Type.Array(Project),
	pinnedThreads: Type.Array(Type.String()),
	lastSeen: Type.Record(Type.String(), Type.String()),
	sidebar: Obj({ width: Type.Number(), collapsed: Type.Boolean() }),
});
export type DesktopState = Static<typeof DesktopState>;

export const DEFAULT_STATE: DesktopState = {
	version: 1,
	projects: [],
	pinnedThreads: [],
	lastSeen: {},
	sidebar: { width: 272, collapsed: false },
};

export const HostMethods = {
	"host/dialog/openFolder": {
		params: Obj({ title: Type.Optional(Type.String()) }),
		result: Obj({ path: Type.Optional(Type.String()) }),
	},
	"host/shell/openExternal": { params: Obj({ url: Type.String() }), result: Obj({}) },
	"host/shell/showInFolder": { params: Obj({ path: Type.String() }), result: Obj({}) },
	"host/clipboard/writeText": { params: Obj({ text: Type.String() }), result: Obj({}) },
	"host/window/setTitle": { params: Obj({ title: Type.String() }), result: Obj({}) },
	"host/state/read": { params: Obj({}), result: DesktopState },
	"host/state/write": { params: Obj({ state: DesktopState }), result: Obj({}) },
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
