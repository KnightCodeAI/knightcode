/**
 * The host side of an MCP App (desktop-shell.md section 12.3; MCP Apps, Stable 2026-01-26): JSON-RPC 2.0 over
 * `postMessage` with one app frame. Only messages from the frame's own window and origin count, and nothing goes to the
 * app before its `ui/notifications/initialized` (the spec's MUST). What it answers is v1-completion-plan.md's "MCP Apps
 * coverage" table; anything else answers -32601.
 */

import type { McpApp } from "@knightcode/app-server-protocol";
import type { ToolItem } from "./activity.ts";
import { client, RequestError } from "./client.ts";

export const MCP_APP_PROTOCOL = "2026-01-26";
/** What a request from an app may carry, serialized, before anything is sent on: main writes to the server unchecked. */
const PARAMS_MAX_BYTES = 1024 * 1024;
export const MIN_HEIGHT = 48;
export const MAX_HEIGHT = 720;

export type DisplayMode = "inline" | "fullscreen";

/** The spec's style variables from the window's tokens. */
const COLORS: Record<string, string> = {
	"--color-background-primary": "--kc-bg-surface",
	"--color-background-secondary": "--kc-bg-surface-secondary",
	"--color-background-tertiary": "--kc-bg-surface-tertiary",
	"--color-background-inverse": "--kc-text",
	"--color-background-info": "--kc-info-bg",
	"--color-background-danger": "--kc-danger-soft",
	"--color-background-disabled": "--kc-soft",
	"--color-text-primary": "--kc-text",
	"--color-text-secondary": "--kc-text-secondary",
	"--color-text-tertiary": "--kc-text-tertiary",
	"--color-text-inverse": "--kc-text-inverse",
	"--color-text-ghost": "--kc-text-tertiary",
	"--color-text-info": "--kc-info",
	"--color-text-danger": "--kc-danger-text",
	"--color-text-success": "--kc-success",
	"--color-text-warning": "--kc-warning",
	"--color-text-disabled": "--kc-text-tertiary",
	"--color-border-primary": "--kc-border-strong",
	"--color-border-secondary": "--kc-border",
	"--color-border-tertiary": "--kc-border-subtle",
	"--color-border-inverse": "--kc-text",
	"--color-border-info": "--kc-focus",
	"--color-border-danger": "--kc-danger-text",
	"--color-border-success": "--kc-success",
	"--color-border-warning": "--kc-warning",
	"--color-border-disabled": "--kc-border",
	"--color-ring-primary": "--kc-focus",
	"--color-ring-secondary": "--kc-focus",
	"--color-ring-inverse": "--kc-focus",
	"--color-ring-info": "--kc-focus",
	"--color-ring-danger": "--kc-danger-text",
	"--color-ring-success": "--kc-success",
	"--color-ring-warning": "--kc-warning",
};
const SIZES: Record<string, string> = {
	"--font-text-xs-size": "--text-xs",
	"--font-text-sm-size": "--text-sm",
	"--font-text-md-size": "--text-base",
	"--font-text-lg-size": "--text-lg",
	"--font-heading-xs-size": "--text-base",
	"--font-heading-sm-size": "--text-lg",
	"--font-heading-md-size": "--text-lg",
	"--font-heading-lg-size": "--text-xl",
};
const RADII: Record<string, string> = {
	"--border-radius-xs": "--radius-xs",
	"--border-radius-sm": "--radius-sm",
	"--border-radius-md": "--radius-md",
	"--border-radius-lg": "--radius-lg",
};

/** The window's tokens resolved to values the app's document can use (it shares none of our variables). */
export function hostStyles(): Record<string, string> {
	const root = getComputedStyle(document.documentElement);
	const probe = document.createElement("div");
	probe.style.display = "none";
	document.body.appendChild(probe);
	const resolve = (token: string, property: "color" | "fontSize" | "borderRadius") => {
		probe.style[property] = `var(${token})`;
		return getComputedStyle(probe)[property];
	};
	try {
		const out: Record<string, string> = {
			"--color-background-ghost": "transparent",
			"--color-border-ghost": "transparent",
			"--font-sans": root.getPropertyValue("--kc-font-ui").trim(),
			"--font-mono": root.getPropertyValue("--kc-font-code").trim(),
			"--font-weight-normal": "400",
			"--font-weight-medium": "500",
			"--font-weight-semibold": "600",
			"--font-weight-bold": "700",
			"--border-radius-full": "9999px",
			"--border-width-regular": "1px",
			"--shadow-md": root.getPropertyValue("--kc-menu-shadow").trim(),
		};
		for (const [name, token] of Object.entries(COLORS)) out[name] = resolve(token, "color");
		const tint = (token: string) =>
			`color-mix(in srgb, ${resolve(token, "color")} 12%, ${resolve("--kc-bg-surface-tertiary", "color")})`;
		out["--color-background-success"] = tint("--kc-success");
		out["--color-background-warning"] = tint("--kc-warning");
		for (const [name, token] of Object.entries(SIZES)) out[name] = resolve(token, "fontSize");
		for (const [name, token] of Object.entries(RADII)) out[name] = resolve(token, "borderRadius");
		return Object.fromEntries(Object.entries(out).filter(([, value]) => value));
	} finally {
		probe.remove();
	}
}

type Json = Record<string, unknown>;
type Message = { jsonrpc: "2.0"; id?: number | string; method?: string; params?: Json; result?: unknown; error?: Json };

const failure = (code: number, message: string) => ({ code, message });

export interface BridgeHost {
	threadId: string;
	appVersion: string;
	theme: () => "light" | "dark";
	displayMode: () => DisplayMode;
	/** The policy the document was served with, which the app hears in `hostCapabilities.sandbox.csp`. */
	csp: Json;
	onSize: (height: number) => void;
	onDisplayMode: (mode: DisplayMode) => void;
	/** Asks the user; true to go ahead. */
	confirmTool: (server: string, tool: string) => Promise<boolean>;
	confirmMessage: (text: string) => Promise<boolean>;
	sendMessage: (text: string) => Promise<void>;
	openLink: (url: string) => Promise<void>;
}

export class McpAppBridge {
	private readonly frame: HTMLIFrameElement;
	private readonly origin: string;
	private readonly host: BridgeHost;
	private item: ToolItem & { mcpApp: McpApp };
	private initialized = false;
	private sentInput = false;
	private sentEnd = false;
	private modes: DisplayMode[] = ["inline"];
	private next = 0;
	private readonly waiting = new Map<number, (message: Message) => void>();
	private readonly listener = (event: MessageEvent) => this.receive(event);

	constructor(frame: HTMLIFrameElement, origin: string, item: ToolItem & { mcpApp: McpApp }, host: BridgeHost) {
		this.frame = frame;
		this.origin = origin;
		this.item = item;
		this.host = host;
		window.addEventListener("message", this.listener);
	}

	dispose(): void {
		window.removeEventListener("message", this.listener);
		for (const resolve of this.waiting.values()) resolve({ jsonrpc: "2.0", error: failure(-32000, "the app closed") });
		this.waiting.clear();
	}

	/** The call moved on (its result arrived, or it ended without one). */
	update(item: ToolItem & { mcpApp: McpApp }): void {
		this.item = item;
		this.flush();
	}

	/** Theme, display mode or container size changed. */
	contextChanged(): void {
		if (this.initialized) this.notify("ui/notifications/host-context-changed", this.context());
	}

	/** Before the frame goes (the spec's MUST): the app's answer, or a second at most. */
	async teardown(): Promise<void> {
		if (!this.initialized) return;
		await Promise.race([this.request("ui/resource-teardown", {}), new Promise((r) => setTimeout(r, 1000))]);
	}

	private post(message: Message): void {
		this.frame.contentWindow?.postMessage(message, this.origin);
	}

	private notify(method: string, params: Json): void {
		this.post({ jsonrpc: "2.0", method, params });
	}

	private request(method: string, params: Json): Promise<Message> {
		const id = ++this.next;
		return new Promise((resolve) => {
			this.waiting.set(id, resolve);
			this.post({ jsonrpc: "2.0", id, method, params });
		});
	}

	private context(): Json {
		const fullscreen = this.host.displayMode() === "fullscreen";
		return {
			theme: this.host.theme(),
			styles: { variables: hostStyles() },
			displayMode: this.host.displayMode(),
			availableDisplayModes: ["inline", "fullscreen"],
			containerDimensions: fullscreen
				? { width: this.frame.clientWidth, height: this.frame.clientHeight }
				: { maxHeight: MAX_HEIGHT },
			locale: navigator.language,
			timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
			platform: "desktop",
			// An MCP Tool needs an input schema; the server's own is not at hand here, so the spec's minimal one.
			toolInfo: { id: this.item.id, tool: { name: this.item.tool, inputSchema: { type: "object" } } },
		};
	}

	/** Tool input, then the result once the call completed, or its cancellation: each once, after initialized. */
	private flush(): void {
		if (!this.initialized) return;
		if (!this.sentInput) {
			this.sentInput = true;
			this.notify("ui/notifications/tool-input", { arguments: this.item.input ?? {} });
		}
		if (this.sentEnd) return;
		const { status } = this.item;
		if (status === "completed" || status === "failed") {
			this.sentEnd = true;
			const text = this.item.output.flatMap((o) => (o.type === "text" ? [{ type: "text", text: o.text }] : []));
			const result = this.item.mcpApp.result ?? { content: text, ...(status === "failed" ? { isError: true } : {}) };
			this.notify("ui/notifications/tool-result", result as Json);
		} else if (status === "declined") {
			this.sentEnd = true;
			this.notify("ui/notifications/tool-cancelled", { reason: "The user declined the call" });
		}
	}

	private receive(event: MessageEvent): void {
		if (event.source !== this.frame.contentWindow || event.origin !== this.origin) return;
		const message = event.data as Message;
		if (typeof message !== "object" || message === null || message.jsonrpc !== "2.0") return;
		if (message.method === undefined) {
			if (typeof message.id !== "number") return;
			const resolve = this.waiting.get(message.id);
			this.waiting.delete(message.id);
			resolve?.(message);
			return;
		}
		const params = (typeof message.params === "object" && message.params !== null ? message.params : {}) as Json;
		if (message.id === undefined) return this.notification(message.method, params);
		const id = message.id;
		void this.answer(message.method, params).then(
			(result) => this.post({ jsonrpc: "2.0", id, result }),
			(error: unknown) =>
				this.post({
					jsonrpc: "2.0",
					id,
					error:
						typeof error === "object" && error !== null && "code" in error && typeof error.code === "number"
							? (error as Json)
							: failure(-32000, error instanceof Error ? error.message : String(error)),
				}),
		);
	}

	private notification(method: string, params: Json): void {
		if (method === "ui/notifications/initialized") {
			this.initialized = true;
			this.flush();
		} else if (method === "ui/notifications/size-changed" && typeof params.height === "number") {
			this.host.onSize(Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(params.height))));
		} else if (method === "notifications/message") {
			console.info(`[mcp app ${this.item.mcpApp.server}]`, params.data ?? params);
		}
	}

	private async answer(method: string, params: Json): Promise<unknown> {
		const { server } = this.item.mcpApp;
		const { threadId } = this.host;
		const forwarded = method === "tools/call" || method === "resources/read" || method === "ui/message";
		if (forwarded && new TextEncoder().encode(JSON.stringify(params)).length > PARAMS_MAX_BYTES)
			throw failure(-32602, "params too large: over 1 MiB serialized");
		switch (method) {
			case "ui/initialize": {
				const modes = (params.appCapabilities as Json | undefined)?.availableDisplayModes;
				if (Array.isArray(modes))
					this.modes = modes.filter((m): m is DisplayMode => m === "inline" || m === "fullscreen");
				return {
					protocolVersion: MCP_APP_PROTOCOL,
					hostInfo: { name: "knightcode-desktop", version: this.host.appVersion },
					hostCapabilities: {
						openLinks: {},
						serverTools: {},
						serverResources: {},
						logging: {},
						sandbox: { permissions: {}, csp: this.host.csp },
					},
					hostContext: this.context(),
				};
			}
			case "ping":
				return {};
			case "tools/call": {
				const name = String(params.name ?? "");
				const args = (params.arguments ?? {}) as Record<string, unknown>;
				const call = (confirmed: boolean) =>
					client.request("mcp/app/callTool", {
						threadId,
						server,
						name,
						arguments: args,
						...(confirmed ? { confirmed } : {}),
					});
				try {
					return await call(false);
				} catch (error) {
					if (!(error instanceof RequestError) || error.code !== "approvalRequired") throw error;
					if (!(await this.host.confirmTool(server, name))) throw failure(-32000, "The user declined the call");
					return call(true);
				}
			}
			case "resources/read":
				return client.request("mcp/app/readResource", { threadId, server, uri: String(params.uri ?? "") });
			case "ui/open-link": {
				const url = String(params.url ?? "");
				if (!/^https?:\/\//i.test(url)) throw failure(-32000, "only http and https links open");
				await this.host.openLink(url);
				return {};
			}
			case "ui/message": {
				const content = Array.isArray(params.content) ? params.content : [];
				const text = content
					.flatMap((c) =>
						typeof c === "object" && c !== null && (c as Json).type === "text" ? [String((c as Json).text ?? "")] : [],
					)
					.join("\n")
					.trim();
				if (!text) throw failure(-32602, "the message has no text");
				if (!(await this.host.confirmMessage(text))) throw failure(-32000, "The user declined to send it");
				await this.host.sendMessage(text);
				return {};
			}
			case "ui/request-display-mode": {
				const wanted = params.mode;
				if ((wanted === "inline" || wanted === "fullscreen") && this.modes.includes(wanted)) {
					this.host.onDisplayMode(wanted);
					return { mode: wanted };
				}
				return { mode: this.host.displayMode() };
			}
			default:
				throw failure(-32601, `method not found: ${method}`);
		}
	}
}
