/** Experimental desktop contributions. This entry is inert outside a desktop renderer and has no runtime imports. */
import type { ComponentProps, ReactElement, ReactNode, SVGProps } from "react";

export interface experimental_Disposable {
	dispose(): void;
}

/** A captured target, never an implicit read of whichever thread is selected later. */
export interface experimental_CommandContext {
	thread?: { id: string; cwd: string };
	cwd?: string;
	sidebarOpen: boolean;
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
	| "X";

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

/** S1 exposes feedback only; later slices extend this surface vocabulary. */
export type experimental_Surface = "feedback";

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
export interface experimental_Controllers {
	experimental_showNew(): void;
	experimental_addProject(): Promise<string | undefined>;
	experimental_setSidebarOpen(open: boolean): void;
	experimental_showSettings(page: "general" | "shortcuts"): void;
	experimental_toggleTerminal(thread: { id: string; cwd: string }): void;
	experimental_newTerminal(thread: { id: string; cwd: string }): Promise<void>;
	experimental_notify(text: string, kind?: experimental_Toast["kind"]): void;
	experimental_dismissToast(id: number): void;
}

export interface experimental_DesktopApp {
	experimental_signal: AbortSignal;
	experimental_registerCommand(command: experimental_Command): experimental_Disposable;
	experimental_registerSlot(slot: experimental_SurfaceContribution): experimental_Disposable;
	experimental_registerProvider(provider: experimental_SurfaceContribution): experimental_Disposable;
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
	experimental_controllers: experimental_Controllers;
	experimental_useToasts(): readonly experimental_Toast[];
	experimental_Icon(props: experimental_IconProps): ReactElement;
	experimental_Button(props: experimental_ButtonProps): ReactElement;
	experimental_KeybindingKeys(props: { binding: experimental_KeybindingId }): ReactElement;
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

/** Draw the user's configured keys for a command. */
export function experimental_KeybindingKeys(props: { binding: experimental_KeybindingId }): ReactElement {
	return host().experimental_KeybindingKeys(props);
}
