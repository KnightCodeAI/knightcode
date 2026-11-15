// Generated from src/desktop.ts. Run bun packages/cli/scripts/generate-desktop-api.ts.


import type { ComponentProps, ReactElement, ReactNode, SVGProps } from "react";

export declare const experimental_RUNTIME_IMPORTS: readonly ["@knightcodeai/cli/desktop", "react", "react-dom", "react/jsx-runtime", "radix-ui", "@pierre/diffs", "@pierre/trees", "typebox"];

export declare const experimental_THEME_TOKENS: readonly ["--kc-text", "--kc-text-secondary", "--kc-text-tertiary", "--kc-font-ui", "--kc-font-code", "--kc-font-content", "--kc-focus", "--kc-selection", "--kc-size-ui"];

export interface experimental_Disposable {
	dispose(): void;
}

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

export declare function defineDesktopExtension(setup: experimental_DesktopExtension["experimental_setup"], options?: { apiVersion: number }): experimental_DesktopExtension;

export interface experimental_DesktopHost {
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

export declare function experimental_controllers(): experimental_Controllers;

export declare function experimental_useToasts(): readonly experimental_Toast[];

export declare function experimental_Icon(props: experimental_IconProps): ReactElement;

export declare function experimental_Button(props: experimental_ButtonProps): ReactElement;

export declare function experimental_Portal(props: { children: ReactNode }): ReactNode;

export declare function experimental_KeybindingKeys(props: { binding: experimental_KeybindingId }): ReactElement;
