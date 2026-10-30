/**
 * Plugin MCP servers: what the trust prompt shows about them, and their translation into KnightCode server configs.
 */

import { type McpServerConfig, mcpNamespace, validateMcpServerConfig } from "../core/mcp-servers.ts";
import { isRecord } from "./manifest.ts";
import { pluginServerName } from "./render.ts";

/** Variables naming the plugin's own folders: filled in here, never read from the environment. */
const PATH_TOKENS: readonly string[] = [
	"CLAUDE_PLUGIN_ROOT",
	"GROK_PLUGIN_ROOT",
	"CLAUDE_PLUGIN_DATA",
	"GROK_PLUGIN_DATA",
];
/** Grok fields whose value is the name of an environment variable. */
const ENV_NAME_FIELDS = ["bearer_token_env_var", "oauth_client_secret_env_var", "clientSecretEnvVar"];

/** What a server runs or connects to, in one line. */
export function describeMcpServer(config: unknown): string {
	if (!isRecord(config)) return "invalid config";
	if (typeof config.command === "string") {
		const args = Array.isArray(config.args) ? config.args.filter((arg) => typeof arg === "string") : [];
		return [config.command, ...args].join(" ");
	}
	const url = config.url ?? config.urlTemplate ?? config.url_template;
	return typeof url === "string" ? url : "no command or url";
}

/** Names of the environment variables the servers' configs read. */
export function mcpEnvironmentNames(servers: Record<string, unknown>): string[] {
	const names = new Set<string>();
	const visit = (value: unknown, key?: string) => {
		if (typeof value === "string") {
			if (key && ENV_NAME_FIELDS.includes(key) && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) names.add(value);
			for (const match of value.matchAll(/\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-[^}]*)?\}/g)) {
				if (!PATH_TOKENS.includes(match[1]!)) names.add(match[1]!);
			}
		} else if (Array.isArray(value)) {
			for (const item of value) visit(item);
		} else if (isRecord(value)) {
			for (const [entryKey, entry] of Object.entries(value)) visit(entry, entryKey);
		}
	};
	visit(servers);
	return [...names].sort();
}

const KNOWN_FIELDS = new Set([
	"type",
	"command",
	"args",
	"env",
	"cwd",
	"url",
	"urlTemplate",
	"url_template",
	"headers",
	"oauth",
	"bearer_token_env_var",
	"oauth_client_id",
	"oauth_client_secret_env_var",
	"oauth_scopes",
	"description",
	"enabled",
	"timeout",
	"exposure",
	"toolExposure",
]);
/** Authentication KnightCode does not implement. A server using it is never registered. */
const BLOCKED_FIELDS = ["bearer_token_file", "setup", "headersHelper"];
const PLACEHOLDER = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export interface PluginServerSource {
	identity: string;
	namespace: string;
	root: string;
	dataDir: string;
	inventory: { mcpServers: Record<string, unknown> };
}

export interface TranslatedServer {
	/** `plugin_<plugin>_<server>`. */
	name: string;
	config: McpServerConfig;
	identity: string;
}

class MissingVariable extends Error {}

/**
 * Translation for one plugin. KnightCode's resolver runs `!`-prefixed values as commands and expands bare `$NAME`
 * (`core/resolve-config-value.ts`); plugin values must never do either.
 */
class Translator {
	private readonly paths: Record<string, string>;
	private readonly env: Record<string, string | undefined>;

	constructor(plugin: PluginServerSource, env: Record<string, string | undefined>) {
		const root = plugin.root.replace(/\\/g, "/");
		const data = plugin.dataDir.replace(/\\/g, "/");
		this.paths = Object.fromEntries(PATH_TOKENS.map((token) => [token, token.endsWith("ROOT") ? root : data]));
		this.env = env;
	}

	/** Fully expanded, for fields nothing resolves later: `command`, `args`, `cwd`, `url` and most of `oauth`. */
	expand(value: string): string {
		return value.replace(PLACEHOLDER, (_, name: string, fallback: string | undefined) => {
			const path = this.paths[name];
			if (path !== undefined) return path;
			const resolved = this.env[name] || fallback;
			if (resolved === undefined) throw new MissingVariable(name);
			return resolved;
		});
	}

	/**
	 * For fields KnightCode resolves when it connects (`env`, `headers`, `oauth.clientSecret`): `${VAR}` is kept, so
	 * secrets stay out of the registered config; `${VAR:-default}` and plugin paths are resolved now; every other `$`
	 * becomes `$$` and a leading `!` becomes `$!`.
	 */
	deferred(value: string): string {
		let result = "";
		let last = 0;
		for (const match of value.matchAll(PLACEHOLDER)) {
			const [whole, name, fallback] = match;
			result += escapeDollars(value.slice(last, match.index));
			const path = this.paths[name!];
			if (path !== undefined) result += escapeDollars(path);
			else if (fallback !== undefined) result += escapeDollars(this.env[name!] || fallback);
			else result += whole;
			last = match.index + whole.length;
		}
		result += escapeDollars(value.slice(last));
		return result.startsWith("!") ? `$${result}` : result;
	}

	/** The plugin path variables every stdio server gets. */
	pathVariables(): Record<string, string> {
		return Object.fromEntries(Object.entries(this.paths).map(([name, value]) => [name, escapeDollars(value)]));
	}
}

function escapeDollars(text: string): string {
	return text.replace(/\$/g, "$$$$");
}

function stringMap(value: unknown, field: string, translate: (entry: string) => string): Record<string, string> {
	if (!isRecord(value)) throw new Error(`${field} must map names to strings`);
	return Object.fromEntries(
		Object.entries(value).map(([key, entry]) => {
			if (typeof entry !== "string") throw new Error(`${field}.${key} must be a string`);
			return [key, translate(entry)];
		}),
	);
}

function joinScopes(value: unknown): string | undefined {
	if (typeof value === "string") return value;
	if (Array.isArray(value)) return value.filter((entry) => typeof entry === "string").join(" ");
	return undefined;
}

function envReference(name: string): string {
	return "${" + name + "}";
}

/** One server's KnightCode config, or why it is not registered. Unknown fields are reported in `warnings`. */
function translateServer(
	raw: unknown,
	translator: Translator,
	warnings: string[],
): { config: Record<string, unknown> } | { error: string } {
	if (!isRecord(raw)) return { error: "is not an object" };
	for (const field of BLOCKED_FIELDS) {
		if (raw[field] !== undefined) return { error: `uses ${field}, which KnightCode does not implement` };
	}
	if (isRecord(raw.oauth) && raw.oauth.xaa !== undefined) {
		return { error: "uses oauth.xaa, which KnightCode does not implement" };
	}
	if (raw.auth !== undefined) return { error: "uses auth.provider, which would send KnightCode provider credentials" };
	if (raw.type === "sse" || raw.type === "ws")
		return { error: `uses the ${raw.type} transport, which is not supported` };
	for (const field of Object.keys(raw)) {
		if (!KNOWN_FIELDS.has(field)) warnings.push(`ignores the unknown field ${field}`);
	}
	try {
		const config: Record<string, unknown> = {};
		for (const field of ["type", "description", "enabled", "timeout", "exposure", "toolExposure"]) {
			if (raw[field] !== undefined) config[field] = raw[field];
		}
		if (typeof raw.command === "string") {
			config.command = translator.expand(raw.command);
			if (raw.args !== undefined) {
				if (!Array.isArray(raw.args) || !raw.args.every((arg) => typeof arg === "string")) {
					return { error: "has args that are not an array of strings" };
				}
				config.args = raw.args.map((arg: string) => translator.expand(arg));
			}
			if (typeof raw.cwd === "string") config.cwd = translator.expand(raw.cwd);
			config.env = {
				...(raw.env !== undefined ? stringMap(raw.env, "env", (value) => translator.deferred(value)) : {}),
				...translator.pathVariables(),
			};
			return { config };
		}
		const url = raw.url ?? raw.urlTemplate ?? raw.url_template;
		if (typeof url !== "string") return { error: 'needs either "command" or "url"' };
		config.url = translator.expand(url);
		const headers =
			raw.headers !== undefined ? stringMap(raw.headers, "headers", (value) => translator.deferred(value)) : {};
		if (typeof raw.bearer_token_env_var === "string") {
			headers.Authorization = `Bearer ${envReference(raw.bearer_token_env_var)}`;
		}
		if (Object.keys(headers).length) config.headers = headers;
		const oauth: Record<string, unknown> = {};
		for (const [key, value] of Object.entries(isRecord(raw.oauth) ? raw.oauth : {})) {
			if (key === "clientSecret" && typeof value === "string") oauth.clientSecret = translator.deferred(value);
			else if (key === "clientSecretEnvVar" && typeof value === "string") oauth.clientSecret = envReference(value);
			else if (key === "scopes") oauth.scope = joinScopes(value);
			else oauth[key] = typeof value === "string" ? translator.expand(value) : value;
		}
		if (typeof raw.oauth_client_id === "string") oauth.clientId = translator.expand(raw.oauth_client_id);
		if (typeof raw.oauth_client_secret_env_var === "string") {
			oauth.clientSecret = envReference(raw.oauth_client_secret_env_var);
		}
		if (raw.oauth_scopes !== undefined) oauth.scope = joinScopes(raw.oauth_scopes);
		if (Object.keys(oauth).length) config.oauth = oauth;
		return { config };
	} catch (error) {
		if (error instanceof MissingVariable) return { error: `needs the environment variable ${error.message}` };
		return { error: error instanceof Error ? error.message : String(error) };
	}
}

/**
 * The MCP servers of the active plugins, translated for `registerMcpServer()`. Every plugin server registers under
 * one owner, where a repeated name would silently replace the earlier server, so names that are identical or share an
 * MCP namespace (`-` and `_` are one character in tool names) leave every server involved unregistered, with a
 * diagnostic naming both plugins.
 */
export function translatePluginServers(
	plugins: readonly PluginServerSource[],
	env: Record<string, string | undefined> = process.env,
): { servers: TranslatedServer[]; diagnostics: string[] } {
	const diagnostics: string[] = [];
	const candidates: TranslatedServer[] = [];
	for (const plugin of plugins) {
		const translator = new Translator(plugin, env);
		for (const [server, raw] of Object.entries(plugin.inventory.mcpServers)) {
			const name = pluginServerName(plugin.namespace, server);
			const warnings: string[] = [];
			const translated = translateServer(raw, translator, warnings);
			for (const warning of warnings) diagnostics.push(`MCP server "${server}" of ${plugin.identity} ${warning}`);
			if ("error" in translated) {
				diagnostics.push(`MCP server "${server}" of ${plugin.identity} is not registered: it ${translated.error}`);
				continue;
			}
			const validated = validateMcpServerConfig(name, translated.config);
			if (typeof validated === "string") {
				diagnostics.push(`MCP server "${server}" of ${plugin.identity} is not registered: ${validated}`);
				continue;
			}
			candidates.push({ name, config: validated, identity: plugin.identity });
		}
	}
	const servers = candidates.filter((candidate) => {
		const clash = candidates.find(
			(other) => other !== candidate && mcpNamespace(other.name) === mcpNamespace(candidate.name),
		);
		if (!clash) return true;
		diagnostics.push(
			`MCP server "${candidate.name}" of ${candidate.identity} is not registered: it collides with "${clash.name}" of ${clash.identity}`,
		);
		return false;
	});
	return { servers, diagnostics };
}
