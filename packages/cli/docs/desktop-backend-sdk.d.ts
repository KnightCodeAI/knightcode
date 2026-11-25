// Generated from src/desktop-backend.ts. Run bun packages/cli/scripts/generate-desktop-api.ts.


import type { Static, TSchema } from "typebox";

export type experimental_BackendDataSelector =
	{ scope: "app" } | { scope: "project"; cwd: string } | { scope: "thread"; cwd: string; threadId: string };

declare const backendDataContext: unique symbol;

export interface experimental_BackendDataContext {
	readonly scope: experimental_BackendDataSelector["scope"];
	readonly [backendDataContext]: true;
}

export interface experimental_BackendValue<T> {
	/** Read thread > project > app > declared default; an omitted context means app. */
	experimental_get(context?: experimental_BackendDataContext): T;
	experimental_set(value: T, context?: experimental_BackendDataContext): void;
}

export interface experimental_BackendStorage<T> {
	/** Data reads only the specified scope, without settings inheritance. */
	experimental_get(context?: experimental_BackendDataContext): T | undefined;
	experimental_set(value: T, context?: experimental_BackendDataContext): void;
}

export interface experimental_BackendContext {
	experimental_signal: AbortSignal;
	experimental_onDispose(cleanup: () => void | Promise<void>): void;
	experimental_onPause(pause: () => void | Promise<void>): void;
	experimental_onResume(resume: () => void | Promise<void>): void;
}

export interface experimental_DesktopBackendApp {
	/** Validate an explicit identity and cancellation lifetime; never infer a selected window/thread. */
	experimental_context(
		selector: experimental_BackendDataSelector,
		signal: AbortSignal,
	): Promise<experimental_BackendDataContext>;
	experimental_registerRpc<P extends TSchema, R extends TSchema>(declaration: {
		id: string;
		kind: "read" | "write";
		params: P;
		result: R;
		experimental_handle(params: Static<P>, signal: AbortSignal): Static<R> | Promise<Static<R>>;
	}): void;
	experimental_setting<S extends TSchema>(declaration: {
		id: string;
		schema: S;
		default: Static<S>;
		secret?: boolean;
	}): experimental_BackendValue<Static<S>>;
	experimental_storage<S extends TSchema>(declaration: {
		id: string;
		schema: S;
	}): experimental_BackendStorage<Static<S>>;
	experimental_event<S extends TSchema>(declaration: {
		id: string;
		schema: S;
	}): {
		experimental_emit(value: Static<S>): boolean;
	};
	experimental_onActivate(
		activate: (
			context: experimental_BackendContext,
		) => void | (() => void | Promise<void>) | Promise<void | (() => void | Promise<void>)>,
	): void;
}

export interface experimental_DesktopBackend {
	apiVersion: number;
	experimental_setup(app: experimental_DesktopBackendApp): void;
}

export declare function experimental_defineDesktopBackend(setup: experimental_DesktopBackend["experimental_setup"]): experimental_DesktopBackend;
