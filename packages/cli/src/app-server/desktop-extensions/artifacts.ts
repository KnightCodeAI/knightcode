/** Validate immutable frontend/backend artifacts without evaluating either entry during staging. */
import { createHash, randomUUID } from "node:crypto";
import {
	existsSync,
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { isBuiltin } from "node:module";
import { DESKTOP_ACTIVATION_MARKER } from "@knightcode/app-server-protocol";
import { parse } from "@babel/parser";
import { traverseFast, type StringLiteral } from "@babel/types";
import postcss from "postcss";
import { satisfies, validRange } from "semver";
import { experimental_RUNTIME_IMPORTS as DESKTOP_RUNTIME_IMPORTS } from "../../desktop.ts";
import { scopeDesktopCss } from "./css.ts";
import { getPathComparisonKey } from "../../utils/paths.ts";

export interface DesktopArtifact {
	owner: string;
	kinds: ("frontend" | "backend")[];
	revision: string;
	root: string;
	frontend: string;
	backend?: string;
	styles: string[];
	files: string[];
}
export interface DesktopManifest {
	frontend?: string;
	backend?: string;
	styles: string[];
	/** The desktop extension API the package was written for; absent means 1. */
	apiVersion?: number;
	/** A semver range of desktop app versions the package supports. */
	app?: string;
}

/** The desktop extension API this build serves. */
export const DESKTOP_EXTENSION_API_VERSION = 1;

/**
 * Why a declared manifest cannot run on this app, or undefined when it can. Checked before staging, so an
 * out-of-range package is refused whole: neither half is staged, approved or loaded.
 */
export function desktopIncompatibility(manifest: DesktopManifest, appVersion: string | undefined): string | undefined {
	const api = manifest.apiVersion ?? 1;
	if (api !== DESKTOP_EXTENSION_API_VERSION)
		return `Requires desktop extension API ${api}; this app supports API ${DESKTOP_EXTENSION_API_VERSION}.`;
	if (manifest.app && appVersion && !satisfies(appVersion, manifest.app, { includePrerelease: true }))
		return `Requires KnightCode desktop ${manifest.app}; this is ${appVersion}. Update the app or install a compatible version.`;
	return undefined;
}

/** Read explicit native entries; session/plugin trust does not imply permission to execute them. */
export function readDesktopManifest(root: string): DesktopManifest | undefined {
	// Filesystem manifest is an untrusted declaration boundary, separate from the session-resource manifest.
	const pkg: unknown = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	if (!pkg || typeof pkg !== "object" || !("knightcode" in pkg)) return;
	const knightcode = pkg.knightcode;
	if (!knightcode || typeof knightcode !== "object" || !("desktop" in knightcode)) return;
	const desktop = knightcode.desktop;
	if (!desktop || typeof desktop !== "object" || Array.isArray(desktop))
		throw new Error("knightcode.desktop must be an object.");
	if ("frontend" in desktop && (typeof desktop.frontend !== "string" || desktop.frontend.length === 0))
		throw new Error("desktop.frontend must be a non-empty local module path.");
	if ("backend" in desktop && (typeof desktop.backend !== "string" || desktop.backend.length === 0))
		throw new Error("desktop.backend must be a non-empty local module path.");
	if (!("frontend" in desktop) && !("backend" in desktop))
		throw new Error("Declare desktop.frontend or desktop.backend explicitly.");
	const styles = "styles" in desktop ? desktop.styles : [];
	if (!Array.isArray(styles) || !styles.every((file): file is string => typeof file === "string"))
		throw new Error("desktop.styles must be an array of local CSS paths.");
	if ("apiVersion" in desktop && !Number.isInteger(desktop.apiVersion))
		throw new Error("desktop.apiVersion must be an integer.");
	if ("app" in desktop && (typeof desktop.app !== "string" || validRange(desktop.app) === null))
		throw new Error('desktop.app must be a semver range such as ">=0.2.0".');
	if (Object.keys(desktop).some((key) => !["frontend", "backend", "styles", "apiVersion", "app"].includes(key)))
		throw new Error("Unsupported desktop entry kind.");
	return {
		...("frontend" in desktop ? { frontend: desktop.frontend as string } : {}),
		...("backend" in desktop ? { backend: desktop.backend as string } : {}),
		styles,
		...("apiVersion" in desktop ? { apiVersion: desktop.apiVersion as number } : {}),
		...("app" in desktop ? { app: desktop.app as string } : {}),
	};
}

/** Every path is both lexically and physically inside its source root; symlink escapes never become artifacts. */
export function containedDesktopFile(root: string, name: string): string {
	if (!name || name.includes("\\") || name.includes("\0") || isAbsolute(name) || /^[a-z]+:/i.test(name))
		throw new Error(`Invalid local artifact path: ${name}`);
	const file = resolve(root, name);
	const inside = relative(root, file);
	if (!inside || inside === ".." || inside.startsWith(`..${sep}`) || isAbsolute(inside))
		throw new Error(`Artifact outside extension: ${name}`);
	const physical = relative(realpathSync(root), realpathSync(file));
	if (physical === ".." || physical.startsWith(`..${sep}`) || isAbsolute(physical) || !lstatSync(file).isFile())
		throw new Error(`Artifact outside extension or not a regular file: ${name}`);
	return file;
}

/** Validate the complete package for coordinated activation; staging never evaluates an entry. */
export async function stageDesktopExtension(
	sourceRoot: string,
	cache: string,
	owner: string,
): Promise<DesktopArtifact> {
	return stageDesktopRevision(sourceRoot, cache, owner);
}

/** Stage a complete candidate revision for consent/preparation, without granting an execution or serving lease. */
export async function stageDesktopRevision(sourceRoot: string, cache: string, owner: string): Promise<DesktopArtifact> {
	if (!/^[a-zA-Z0-9._-]+$/.test(owner) || owner === "." || owner === ".." || owner === "runtime")
		throw new Error("Invalid desktop extension owner.");
	const source = realpathSync(sourceRoot);
	const manifest = readDesktopManifest(source);
	if (!manifest) throw new Error("No explicit knightcode.desktop manifest.");
	// The app range is checked by discovery, which knows the running app; staging alone refuses only the API.
	const unsupported = desktopIncompatibility(manifest, undefined);
	if (unsupported) throw new Error(unsupported);
	const sourceText = new Map<string, string>();
	const readModule = (file: string): string => {
		const identity = getPathComparisonKey(realpathSync(file));
		const known = sourceText.get(identity);
		if (known !== undefined) return known;
		const code = readFileSync(file, "utf8");
		sourceText.set(identity, code);
		return code;
	};
	// Both halves must compile the same captured bytes, even if an editor saves a shared schema mid-stage.
	const backend = manifest.backend ? readBackendGraph(source, manifest.backend, readModule) : undefined;
	const backendSource = manifest.backend ? realpathSync(containedDesktopFile(source, manifest.backend)) : undefined;
	const files = new Map<string, string | Buffer>();
	const modules = new Map<string, string>();
	let bytes = backend ? [...backend.files.values()].reduce((sum, code) => sum + Buffer.byteLength(code), 0) : 0;
	const put = (name: string, content: string | Buffer) => {
		if (
			name
				.split("/")[0]!
				.replace(/[. ]+$/g, "")
				.toLowerCase() === "__backend"
		)
			throw new Error("The __backend artifact directory is reserved for private backend source.");
		if (files.has(name)) throw new Error(`Artifact output collision: ${name}`);
		bytes += Buffer.byteLength(content);
		if (files.size + (backend?.files.size ?? 0) >= 512 || bytes > 16 * 1024 * 1024)
			throw new Error("Desktop extension exceeds the 512-file / 16 MiB limit.");
		files.set(name, content);
	};
	const moduleFile = (name: string): string => {
		const file = containedDesktopFile(source, name);
		if (backendSource && getPathComparisonKey(realpathSync(file)) === getPathComparisonKey(backendSource))
			throw new Error("A frontend module cannot import the backend entry.");
		const known = modules.get(file);
		if (known) return known;
		if (!/\.(?:[cm]?js|tsx?|jsx)$/.test(file)) throw new Error(`Unsupported module import: ${name}`);
		const out = relative(source, file)
			.split(sep)
			.join("/")
			.replace(/\.(?:[cm]?js|tsx?|jsx)$/, ".js");
		modules.set(file, out);
		let code = readModule(file);
		if (code.includes(DESKTOP_ACTIVATION_MARKER) || out.includes(DESKTOP_ACTIVATION_MARKER))
			throw new Error("Reserved desktop activation marker in author source.");
		validateLoading(code, file, source);
		if (/\.(?:tsx?|jsx)$/.test(file)) code = transpile(code, file);
		code = rewriteImports(code, (specifier) => {
			if (DESKTOP_RUNTIME_IMPORTS.some((name) => name === specifier))
				return `app://ext/runtime/${encodeURIComponent(specifier)}.js${specifier === "@knightcodeai/cli/desktop" ? `?activation=${DESKTOP_ACTIVATION_MARKER}` : ""}`;
			if (!specifier.startsWith("./") && !specifier.startsWith("../"))
				throw new Error(
					`Unsupported import ${JSON.stringify(specifier)}; use the desktop SDK or a local module (desktop-extensions §Imports).`,
				);
			const imported = moduleFile(
				relative(source, resolve(dirname(file), specifier))
					.split(sep)
					.join("/"),
			);
			let path = relative(dirname(out), imported).split(sep).join("/");
			if (!path.startsWith(".")) path = `./${path}`;
			return `${path}?activation=${DESKTOP_ACTIVATION_MARKER}`;
		});
		put(out, code);
		return out;
	};
	const entry = manifest.frontend ? moduleFile(manifest.frontend) : undefined;
	const frontend = "__entry.js";
	put(
		frontend,
		`${entry ? `import extension from ${JSON.stringify(`./${entry}?activation=${DESKTOP_ACTIVATION_MARKER}`)};` : "const extension = {apiVersion:1,experimental_setup(){}};"}\nglobalThis.__knightcodeDesktopLoaded(new URL(import.meta.url).searchParams.get("activation"), extension);\n`,
	);
	const readCss = (name: string, ancestors: ReadonlySet<string>): string => {
		const file = containedDesktopFile(source, name);
		if (extname(file) !== ".css") throw new Error(`Styles must be CSS: ${name}`);
		if (ancestors.has(file)) throw new Error(`Cyclic CSS import: ${name}`);
		const next = new Set([...ancestors, file]);
		const css = postcss.parse(readFileSync(file, "utf8"));
		css.walkDecls((decl) => {
			decl.value = decl.value.replace(
				/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^\s()"']+))\s*\)/gi,
				(_all, double: string | undefined, single: string | undefined, plain: string | undefined) => {
					const path = double ?? single ?? plain!;
					if (/^(?:[a-z][a-z\d+.-]*:|\/|#)/i.test(path) || /[?#\\]/.test(path))
						throw new Error(`CSS URL must be local: ${path}`);
					return `url("${relative(source, resolve(dirname(file), path))
						.split(sep)
						.join("/")}")`;
				},
			);
		});
		css.walkAtRules("import", (rule) => {
			const path = /^["']([^"']+)["']$/.exec(rule.params.trim())?.[1];
			if (!path) throw new Error("CSS @import must name a local stylesheet.");
			const imported = readCss(
				relative(source, resolve(dirname(file), path))
					.split(sep)
					.join("/"),
				next,
			);
			rule.replaceWith(postcss.parse(imported).nodes);
		});
		return css.toString();
	};
	const cssSource = manifest.styles.map((name) => readCss(name, new Set())).join("\n");
	const compileCss = (revision: string) =>
		scopeDesktopCss(cssSource, {
			owner,
			revision,
			asset: (path) => {
				const asset = containedDesktopFile(source, path);
				if (!/\.(?:png|jpe?g|gif|webp|woff2?)$/i.test(asset)) throw new Error(`Unsupported CSS asset: ${path}`);
				const output = relative(source, asset).split(sep).join("/");
				if (!files.has(output)) put(output, readFileSync(asset));
				return `app://ext/${owner}/${revision}/${output.split("/").map(encodeURIComponent).join("/")}`;
			},
		});
	// Validate and collect assets before hashing; compile original CSS again with the decided revision, never replace literal text.
	const provisionalCss = manifest.styles.length ? compileCss("pending") : "";
	const hash = createHash("sha256")
		.update("desktop-artifact-v3\0")
		.update(owner)
		.update(backend?.entry ?? "");
	for (const [name, code] of [...files, ...(backend?.files ?? [])].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
		hash.update(JSON.stringify([name, Buffer.byteLength(code)])).update(code);
	hash.update(provisionalCss);
	const revision = hash.digest("hex");
	const styles = manifest.styles.length ? ["__styles/0.css"] : [];
	if (styles.length) put(styles[0]!, compileCss(revision));
	const root = join(cache, owner, revision);
	if (!existsSync(root)) {
		const temporary = join(cache, owner, `.${randomUUID()}`);
		try {
			for (const [name, code] of [...files, ...(backend?.files ?? [])]) {
				mkdirSync(dirname(join(temporary, name)), { recursive: true });
				writeFileSync(join(temporary, name), code, { mode: 0o600 });
			}
			renameSync(temporary, root);
		} finally {
			rmSync(temporary, { recursive: true, force: true });
		}
	}
	return {
		owner,
		kinds: [...(manifest.frontend ? ["frontend" as const] : []), ...(backend ? ["backend" as const] : [])],
		revision,
		root,
		frontend,
		...(backend ? { backend: backend.entry } : {}),
		styles,
		files: [...files.keys()],
	};
}

function readBackendGraph(
	source: string,
	entry: string,
	readModule: (file: string) => string,
): { entry: string; files: Map<string, string> } {
	const files = new Map<string, string>();
	const visited = new Map<string, string>();
	let bytes = 0;
	const visit = (name: string): string => {
		const file = containedDesktopFile(source, name);
		const identity = getPathComparisonKey(file);
		const known = visited.get(identity);
		if (known) return known;
		if (!/\.(?:[cm]?js|[cm]?ts|tsx|jsx)$/.test(file)) throw new Error(`Unsupported backend module: ${name}`);
		const output = `__backend/${relative(source, file).split(sep).join("/")}`;
		const code = readModule(file);
		bytes += Buffer.byteLength(code);
		if (files.size >= 512 || bytes > 16 * 1024 * 1024)
			throw new Error("Desktop backend exceeds the 512-file / 16 MiB limit.");
		visited.set(identity, output);
		files.set(output, code);
		const ast = parse(code, { sourceType: "module", plugins: ["typescript", "jsx"], createImportExpressions: true });
		traverseFast(ast, (node) => {
			if (
				node.type === "ImportExpression" ||
				node.type === "TSImportType" ||
				node.type === "TSImportEqualsDeclaration" ||
				(node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require")
			)
				throw new Error(`${file}: inline imports and require loading are unsupported; use top-level imports.`);
			if (
				(node.type !== "ImportDeclaration" &&
					node.type !== "ExportNamedDeclaration" &&
					node.type !== "ExportAllDeclaration") ||
				!node.source
			)
				return;
			const specifier = node.source.value;
			if (
				isBuiltin(specifier) ||
				["@knightcodeai/cli/desktop-backend", "typebox", "typebox/compile", "typebox/value"].includes(specifier)
			)
				return;
			if (!specifier.startsWith("./") && !specifier.startsWith("../"))
				throw new Error(
					`Unsupported backend import: ${specifier}; use local modules, Node built-ins, the backend SDK or TypeBox.`,
				);
			visit(
				relative(source, resolve(dirname(file), specifier))
					.split(sep)
					.join("/"),
			);
		});
		return output;
	};
	return { entry: visit(entry), files };
}

const retiredMembers: Readonly<Record<string, string>> = {
	experimental_notify: "experimental_controllers().experimental_notify",
	registerCommand: "experimental_registerCommand",
	registerSlot: "experimental_registerSlot",
	registerProvider: "experimental_registerProvider",
	onDispose: "experimental_onDispose",
};

function validateLoading(code: string, filename: string, root: string): void {
	const ast = parse(code, {
		sourceType: "module",
		sourceFilename: filename,
		plugins: ["typescript", "jsx"],
		createImportExpressions: true,
	});
	const sdkNamespaces = new Set<string>();
	for (const statement of ast.program.body) {
		if (statement.type !== "ImportDeclaration" || statement.source.value !== "@knightcodeai/cli/desktop") continue;
		for (const specifier of statement.specifiers) {
			if (specifier.type === "ImportNamespaceSpecifier") sdkNamespaces.add(specifier.local.name);
			if (specifier.type === "ImportSpecifier") {
				const name = specifier.imported.type === "Identifier" ? specifier.imported.name : specifier.imported.value;
				if (retiredMembers[name])
					throw new Error(
						`${filename}: retired or unsupported SDK member ${name}; use ${retiredMembers[name]} (desktop-extensions §API).`,
					);
			}
		}
	}
	traverseFast(ast, (node) => {
		if (node.type === "MemberExpression" && node.object.type === "Identifier" && sdkNamespaces.has(node.object.name)) {
			const name =
				!node.computed && node.property.type === "Identifier"
					? node.property.name
					: node.property.type === "StringLiteral"
						? node.property.value
						: undefined;
			if (name && retiredMembers[name])
				throw new Error(
					`${filename}: retired or unsupported SDK member ${name}; use ${retiredMembers[name]} (desktop-extensions §API).`,
				);
		}
		if (
			node.type === "ImportExpression" ||
			node.type === "TSImportType" ||
			node.type === "TSImportEqualsDeclaration" ||
			(node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require")
		)
			throw new Error(`${filename}: inline imports and require loading are unsupported; use top-level imports.`);
		if (
			(node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration") &&
			node.source
		) {
			const specifier = node.source.value;
			if (DESKTOP_RUNTIME_IMPORTS.some((name) => name === specifier)) return;
			if (!specifier.startsWith("./") && !specifier.startsWith("../"))
				throw new Error(
					`Unsupported import ${JSON.stringify(specifier)}; use the desktop SDK or a local module (desktop-extensions §Imports).`,
				);
			containedDesktopFile(
				root,
				relative(root, resolve(dirname(filename), specifier))
					.split(sep)
					.join("/"),
			);
		}
	});
}

function rewriteImports(code: string, resolveImport: (path: string) => string): string {
	const ast = parse(code, { sourceType: "module" });
	const replacements: { node: StringLiteral; value: string }[] = [];
	for (const node of ast.program.body) {
		if (
			(node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration") &&
			node.source
		)
			replacements.push({ node: node.source, value: resolveImport(node.source.value) });
	}
	for (const { node, value } of replacements.reverse())
		code = code.slice(0, node.start!) + JSON.stringify(value) + code.slice(node.end!);
	return code;
}

function transpile(code: string, filename: string): string {
	// Runtime boundary: Node distributions may stage prebuilt JS; desktop's bundled Bun supplies the TSX compiler.
	const runtime = globalThis as typeof globalThis & {
		Bun?: {
			Transpiler: new (options: {
				loader: "tsx";
				tsconfig: { compilerOptions: { jsx: string; jsxFactory: string; jsxFragmentFactory: string } };
			}) => { transformSync(source: string): string };
		};
	};
	if (!runtime.Bun)
		throw new Error(
			`${filename}: TSX requires the desktop's bundled Bun compiler; Node clients can load prebuilt ESM.`,
		);
	const compiler = new runtime.Bun.Transpiler({
		loader: "tsx",
		tsconfig: {
			compilerOptions: { jsx: "react", jsxFactory: "__kcJSX.createElement", jsxFragmentFactory: "__kcJSX.Fragment" },
		},
	});
	return compiler.transformSync(`import * as __kcJSX from "react";\n${code}`);
}
