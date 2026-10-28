/**
 * Plugin MCP servers: what the trust prompt shows about them, and their translation into KnightCode server configs.
 */

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

const PLUGIN_TOKENS = new Set(["CLAUDE_PLUGIN_ROOT", "CLAUDE_PLUGIN_DATA", "GROK_PLUGIN_ROOT", "GROK_PLUGIN_DATA"]);
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
				if (!PLUGIN_TOKENS.has(match[1]!)) names.add(match[1]!);
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
