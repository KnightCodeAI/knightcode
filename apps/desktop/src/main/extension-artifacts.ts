/** The app://ext protocol serves registered immutable artifacts, never arbitrary filesystem paths. */
import {
	retainDesktopArtifact,
	type ArtifactLease,
} from "@knightcodeai/cli/app-server/desktop-extensions/artifact-cache";
import { readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import { DESKTOP_ACTIVATION_MARKER, type DesktopArtifact } from "@knightcode/app-server-protocol";
import { experimental_RUNTIME_IMPORTS } from "@knightcodeai/cli/desktop";
import type { Static } from "typebox";

type Artifact = Static<typeof DesktopArtifact>;
const MIME: Record<string, string> = {
	".js": "text/javascript; charset=utf-8",
	".css": "text/css; charset=utf-8",
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".gif": "image/gif",
	".webp": "image/webp",
	".woff": "font/woff",
	".woff2": "font/woff2",
};

export class ExtensionArtifacts {
	private readonly origin: string;
	private readonly artifacts = new Map<
		string,
		{ root: string; files: ReadonlySet<string>; windows: Map<number, Set<string>>; retention: ArtifactLease }
	>();
	private readonly shims = new Map<string, string>();
	constructor(origin: string) {
		this.origin = origin;
	}

	register(artifact: Artifact, windowId: number, lease: string): void {
		// Server result is a wire boundary; registration never turns a root into an unrestricted file server.
		if (
			!/^[a-zA-Z0-9._-]+$/.test(artifact.owner) ||
			[".", "..", "runtime"].includes(artifact.owner) ||
			!/^[a-f0-9]{64}$/.test(artifact.revision)
		)
			throw new Error("Invalid desktop artifact identity.");
		for (const path of artifact.files) {
			if (/^__backend[. ]*$/i.test(path.split("/")[0]!))
				throw new Error("Private backend source cannot be served to a renderer.");
			if (
				!MIME[extname(path)] ||
				path.includes("\\") ||
				path.split("/").some((part) => !part || part === "." || part === "..") ||
				isAbsolute(path)
			)
				throw new Error(`Unsupported staged artifact path: ${path}`);
		}
		const key = `${artifact.owner}/${artifact.revision}`;
		const existing = this.artifacts.get(key);
		if (existing) {
			const leases = existing.windows.get(windowId);
			if (leases) leases.add(lease);
			else existing.windows.set(windowId, new Set([lease]));
		} else
			this.artifacts.set(key, {
				root: realpathSync(artifact.root),
				retention: retainDesktopArtifact(artifact.root),
				files: new Set(artifact.files),
				windows: new Map([[windowId, new Set([lease])]]),
			});
	}

	runtime(exports: Record<string, string[]>): void {
		// Renderer runtime descriptions contain names only, never executable shim source.
		for (const [name, keys] of Object.entries(exports)) {
			const moduleName = experimental_RUNTIME_IMPORTS.find((entry) => entry === name);
			if (!moduleName) throw new Error(`Unsupported shared runtime: ${name}`);
			if (keys.length > 2048) throw new Error("Too many runtime exports.");
			const scoped = moduleName === "@knightcodeai/cli/desktop";
			const declarations = keys
				.map((key, index) => {
					// Only ASCII IdentifierNames can enter the generated export declaration or string literal.
					if (!/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(key)) throw new Error("Invalid runtime export name.");
					const read = `runtime.${key}`;
					const value = scoped ? `typeof ${read} === "function" ? (...args) => invoke("${key}",args) : ${read}` : read;
					return `const value${index}=${value}; export {value${index} as ${key}};`;
				})
				.join("\n");
			const activation = scoped
				? `const activation="${DESKTOP_ACTIVATION_MARKER}"; const invoke=(key,args)=>{const scopes=globalThis.__knightcodeDesktopScopedRuntime;const target=scopes?.[activation]??scopes?.retired;if(!target)throw new Error("Desktop extension activation is retired.");return target[key](...args);};\n`
				: "";
			this.shims.set(
				moduleName,
				`const runtime=globalThis.__knightcodeDesktopRuntime["${moduleName}"];\n${activation}${declarations}`,
			);
		}
	}

	release(windowId: number, owner: string, revision: string, lease: string): void {
		const key = `${owner}/${revision}`;
		const entry = this.artifacts.get(key);
		if (!entry) return;
		const leases = entry.windows.get(windowId);
		leases?.delete(lease);
		if (leases?.size === 0) entry.windows.delete(windowId);
		if (entry.windows.size === 0) {
			this.artifacts.delete(key);
			entry.retention.release();
		}
	}

	releaseWindow(windowId: number): void {
		for (const [key, entry] of this.artifacts) {
			entry.windows.delete(windowId);
			if (entry.windows.size === 0) {
				this.artifacts.delete(key);
				entry.retention.release();
			}
		}
	}

	clear(): void {
		for (const entry of this.artifacts.values()) entry.retention.release();
		this.artifacts.clear();
	}

	async serve(request: Request): Promise<Response> {
		const url = new URL(request.url);
		const headers = {
			"Access-Control-Allow-Origin": this.origin,
			"Content-Security-Policy": "default-src 'none'",
			"X-Content-Type-Options": "nosniff",
			"Cache-Control": "no-store",
		};
		if (url.hostname !== "ext" || request.method !== "GET") return new Response(null, { status: 404, headers });
		let parts: string[];
		try {
			parts = url.pathname.slice(1).split("/").map(decodeURIComponent);
		} catch {
			return new Response(null, { status: 400, headers });
		}
		if (parts[0] === "runtime" && parts.length === 2 && parts[1]!.endsWith(".js")) {
			let shim = this.shims.get(parts[1]!.slice(0, -3));
			if (shim?.includes(DESKTOP_ACTIVATION_MARKER)) {
				const activation = url.searchParams.get("activation");
				if (
					!activation ||
					!/^[a-f0-9-]{36}$/.test(activation) ||
					![...this.artifacts.values()].some((artifact) =>
						[...artifact.windows.values()].some((leases) => leases.has(activation)),
					)
				)
					return new Response(null, { status: 403, headers });
				shim = shim.replaceAll(DESKTOP_ACTIVATION_MARKER, activation);
			}
			return new Response(shim ?? null, {
				status: shim ? 200 : 404,
				headers: { ...headers, "Content-Type": MIME[".js"]! },
			});
		}
		if (parts.length < 3 || parts.some((part) => !part || part === "." || part === ".." || /[\\/\0]/.test(part)))
			return new Response(null, { status: 403, headers });
		const [owner, revision, ...path] = parts;
		const artifact = this.artifacts.get(`${owner}/${revision}`);
		const name = path.join("/");
		if (!artifact?.files.has(name)) return new Response(null, { status: 404, headers });
		try {
			const file = realpathSync(resolve(artifact.root, ...path));
			const inside = relative(artifact.root, file);
			if (
				inside === ".." ||
				inside.startsWith(`..${sep}`) ||
				isAbsolute(inside) ||
				/^__backend[. ]*$/i.test(inside.split(sep)[0]!)
			)
				return new Response(null, { status: 403, headers });
			const bytes = readFileSync(file);
			let body: string | Uint8Array<ArrayBuffer> = new Uint8Array(bytes);
			if (extname(name) === ".js" && bytes.includes(DESKTOP_ACTIVATION_MARKER)) {
				const activation = url.searchParams.get("activation");
				if (
					!activation ||
					!/^[a-f0-9-]{36}$/.test(activation) ||
					![...artifact.windows.values()].some((leases) => leases.has(activation))
				)
					return new Response(null, { status: 403, headers });
				body = bytes.toString("utf8").replaceAll(DESKTOP_ACTIVATION_MARKER, activation);
			}
			return new Response(body, {
				headers: { ...headers, "Content-Type": MIME[extname(name)]! },
			});
		} catch {
			return new Response(null, { status: 404, headers });
		}
	}
}
