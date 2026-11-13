/** The app://ext protocol serves registered immutable artifacts, never arbitrary filesystem paths. */
import { readFileSync, realpathSync } from "node:fs";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { DesktopArtifact } from "@knightcode/app-server-protocol";
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
		{ root: string; files: ReadonlySet<string>; windows: Map<number, Set<string>> }
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
		for (const path of artifact.files)
			if (
				!MIME[extname(path)] ||
				path.includes("\\") ||
				path.split("/").some((part) => !part || part === "." || part === "..") ||
				isAbsolute(path)
			)
				throw new Error(`Unsupported staged artifact path: ${path}`);
		const key = `${artifact.owner}/${artifact.revision}`;
		const existing = this.artifacts.get(key);
		if (existing) {
			const leases = existing.windows.get(windowId);
			if (leases) leases.add(lease);
			else existing.windows.set(windowId, new Set([lease]));
		} else
			this.artifacts.set(key, {
				root: realpathSync(artifact.root),
				files: new Set(artifact.files),
				windows: new Map([[windowId, new Set([lease])]]),
			});
	}

	runtime(exports: Record<string, string[]>): void {
		// Renderer runtime descriptions contain names only, never executable shim source.
		for (const [name, keys] of Object.entries(exports)) {
			if (!experimental_RUNTIME_IMPORTS.some((entry) => entry === name))
				throw new Error(`Unsupported shared runtime: ${name}`);
			if (keys.length > 2048 || keys.some((key) => !/^[$a-zA-Z_][$a-zA-Z0-9_]*$/.test(key)))
				throw new Error("Invalid runtime export name.");
			const declarations = keys
				.map((key, index) => `const value${index}=runtime[${JSON.stringify(key)}]; export {value${index} as ${key}};`)
				.join("\n");
			this.shims.set(
				name,
				`const runtime=globalThis.__knightcodeDesktopRuntime[${JSON.stringify(name)}];\n${declarations}`,
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
		if (entry.windows.size === 0) this.artifacts.delete(key);
	}

	releaseWindow(windowId: number): void {
		for (const [key, entry] of this.artifacts) {
			entry.windows.delete(windowId);
			if (entry.windows.size === 0) this.artifacts.delete(key);
		}
	}

	clear(): void {
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
			const shim = this.shims.get(parts[1]!.slice(0, -3));
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
			if (inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
				return new Response(null, { status: 403, headers });
			return new Response(new Uint8Array(readFileSync(file)), {
				headers: { ...headers, "Content-Type": MIME[extname(name)]! },
			});
		} catch {
			return new Response(null, { status: 404, headers });
		}
	}
}
