/**
 * OS keychain backend.
 *
 * `Bun.secrets` maps to Keychain Services on macOS, the Windows Credential
 * Manager, and the Secret Service on Linux. Bun-only: Vitest runs under Node,
 * where this module is never imported, which is why it lives under `src/bun/`
 * alongside the other Bun-only registrations.
 */

import type { SecretBackend } from "../engine/secrets.ts";

/**
 * `tsconfig.base.json` sets `types: ["node"]` and `@types/bun` is not a
 * dependency, so the `Bun` global is not declared. Declaring the one API this
 * module uses is cheaper than adding a global type package that would reshape
 * every file in the repository. Shapes verified against Bun 1.3.3: `get`
 * resolves the value or null, `delete` resolves whether an entry was removed.
 */
interface BunSecrets {
	get(options: { service: string; name: string }): Promise<string | null>;
	set(options: { service: string; name: string; value: string }): Promise<void>;
	delete(options: { service: string; name: string }): Promise<boolean>;
}

function bunSecrets(): BunSecrets {
	const runtime = (globalThis as { Bun?: { secrets?: BunSecrets } }).Bun;
	if (!runtime?.secrets) throw new Error("Bun.secrets is unavailable: the engine must run under Bun");
	return runtime.secrets;
}

export function createBunSecretBackend(service = "knightcode"): SecretBackend {
	const secrets = bunSecrets();
	return {
		get: (name) => secrets.get({ service, name }),
		set: (name, value) => secrets.set({ service, name, value }),
		delete: async (name) => {
			await secrets.delete({ service, name });
		},
	};
}
