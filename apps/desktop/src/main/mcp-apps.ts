/**
 * MCP Apps' documents (desktop-shell.md section 12): each app instance is served from its own origin,
 * `kc-mcp-app://<uuid>/index.html`, so `allow-same-origin` in its sandboxed iframe reaches neither the window nor
 * another app. Its Content-Security-Policy starts from the spec's default for an app that declares nothing and adds
 * only the domains the app's resource declared, each checked and rewritten from its parsed parts: a declared entry
 * never reaches the header as the server wrote it. Nothing undeclared is allowed (the spec's MUST).
 */

import { randomUUID } from "node:crypto";
import { InvalidParams } from "./open-in.ts";

export const MCP_APP_SCHEME = "kc-mcp-app";

/** What an app's resource declares in `_meta.ui.csp` (MCP Apps). */
export interface DeclaredCsp {
	connectDomains?: string[];
	resourceDomains?: string[];
	frameDomains?: string[];
	baseUriDomains?: string[];
}

const MAX_ENTRIES = 32;
const MAX_ENTRY_LENGTH = 256;
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);
const HOST = /^(\*\.)?[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;

/**
 * One declared source as the header gets it: `https:`, or `wss:`, to any host; `http:` and `ws:` only to localhost and
 * 127.0.0.1; an optional `*.` subdomain wildcard and port; no path beyond `/`. Anything else is refused.
 */
export function cspSource(entry: unknown): string {
	if (typeof entry !== "string" || entry.length === 0 || entry.length > MAX_ENTRY_LENGTH)
		throw new InvalidParams("a declared domain is empty or too long");
	const match = /^(https|http|wss|ws):\/\/([^/:]+)(?::(\d{1,5}))?\/?$/i.exec(entry.trim() === entry ? entry : "");
	if (!match) throw new InvalidParams(`not a host source: ${JSON.stringify(entry)}`);
	const scheme = match[1]!.toLowerCase();
	const host = match[2]!.toLowerCase();
	const port = match[3];
	if (!HOST.test(host)) throw new InvalidParams(`not a host: ${JSON.stringify(entry)}`);
	if ((scheme === "http" || scheme === "ws") && !LOCAL_HOSTS.has(host))
		throw new InvalidParams(`${scheme}: is only for localhost: ${JSON.stringify(entry)}`);
	if (port !== undefined && (Number(port) < 1 || Number(port) > 65535))
		throw new InvalidParams(`not a port: ${JSON.stringify(entry)}`);
	return `${scheme}://${host}${port ? `:${Number(port)}` : ""}`;
}

function sources(list: unknown): string[] {
	if (list === undefined) return [];
	if (!Array.isArray(list) || list.length > MAX_ENTRIES)
		throw new InvalidParams(`a declared domain list has more than ${MAX_ENTRIES} entries`);
	return [...new Set(list.map(cspSource))];
}

/** The app's policy: the spec's default, the declared domains in their directives, framed only by `ancestor`. */
export function appCsp(declared: DeclaredCsp | undefined, ancestor: string): string {
	const resources = sources(declared?.resourceDomains);
	const connect = sources(declared?.connectDomains);
	const frames = sources(declared?.frameDomains);
	const bases = sources(declared?.baseUriDomains);
	const join = (...parts: string[]) => parts.filter(Boolean).join(" ");
	return [
		"default-src 'none'",
		`script-src ${join("'self' 'unsafe-inline'", ...resources)}`,
		`style-src ${join("'self' 'unsafe-inline'", ...resources)}`,
		`img-src ${join("'self' data:", ...resources)}`,
		`font-src ${join("'self'", ...resources)}`,
		`media-src ${join("'self' data:", ...resources)}`,
		`connect-src ${connect.length > 0 ? connect.join(" ") : "'none'"}`,
		`frame-src ${frames.length > 0 ? frames.join(" ") : "'none'"}`,
		`base-uri ${bases.length > 0 ? bases.join(" ") : "'self'"}`,
		`frame-ancestors ${ancestor}`,
	].join("; ");
}

interface Served {
	html: string;
	csp: string;
	windowId: number;
}

/** The documents being shown, by their origin's host; released with their frame or their window. */
export class McpApps {
	private readonly served = new Map<string, Served>();
	private readonly ancestor: string;

	constructor(ancestor: string) {
		this.ancestor = ancestor;
	}

	serve(html: string, declared: DeclaredCsp | undefined, windowId: number): { id: string; url: string } {
		const csp = appCsp(declared, this.ancestor);
		const id = randomUUID();
		this.served.set(id, { html, csp, windowId });
		return { id, url: `${MCP_APP_SCHEME}://${id}/index.html` };
	}

	release(id: string): void {
		this.served.delete(id);
	}

	releaseWindow(windowId: number): void {
		for (const [id, served] of this.served) if (served.windowId === windowId) this.served.delete(id);
	}

	/** The scheme's handler: an app's own document, nothing else under its origin. */
	handle(request: Request): Response {
		const url = new URL(request.url);
		const served = url.pathname === "/index.html" ? this.served.get(url.host) : undefined;
		if (!served) return new Response(null, { status: 404 });
		return new Response(served.html, {
			headers: {
				"Content-Type": "text/html; charset=utf-8",
				"Content-Security-Policy": served.csp,
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	}
}
