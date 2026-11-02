// "Connect to KnightCode Bots" (spec section 4): for each provider the user picks, run that provider's own sign-in
// again into an in-memory credential sink, upload the result against a one-time enrollment the cloud issued for that
// account and provider, and drop the sink. The desktop's local credential store is never read for tokens and never
// written: only API keys are copied as they are. A provider that fails midway leaves the others connected.
import type { Credential, CredentialStore } from "@knightcode/ai";
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";

export type ProviderKind = "oauth" | "api_key";

export interface ProviderRule {
	id: string;
	label: string;
	kind: ProviderKind;
	/** Off until its human task (terms or a sign-in program) is settled. */
	enabled: boolean;
	/** One line shown on the provider's row. */
	note?: string;
}

/** Provider rules of spec section 4. API keys always work; subscription sign-ins wait for their terms. */
export function providerRules(flags: { chatgpt?: boolean; copilot?: boolean; xai?: boolean } = {}): ProviderRule[] {
	return [
		{
			id: "anthropic",
			label: "Claude",
			kind: "oauth",
			enabled: true,
			note: "Bots' usage bills to your Claude extra usage, not your plan's included limits.",
		},
		{ id: "openai-codex", label: "ChatGPT", kind: "oauth", enabled: flags.chatgpt === true },
		{ id: "github-copilot", label: "GitHub Copilot", kind: "oauth", enabled: flags.copilot === true },
		{ id: "xai", label: "xAI", kind: "oauth", enabled: flags.xai === true },
	];
}

export interface ConnectDeps {
	/** A provider login that writes only to `sink` (the app passes `builtinModels({ credentials: sink }).login`). */
	login(sink: CredentialStore, providerId: string): Promise<Credential>;
	/** A one-time enrollment from the cloud for this provider (ten minutes, one use). */
	enroll(providerId: string): Promise<{ token: string }>;
	/** Hands the credential to the cloud against the enrollment. */
	upload(token: string, credential: Credential): Promise<void>;
	/** The locally saved API key for a provider, if any: API keys are copied as they are. */
	localApiKey(providerId: string): Promise<string | undefined>;
}

export type ConnectResult = { provider: string; status: "connected" | "failed" | "disabled"; error?: string };

/** Connects each provider in turn; one failing does not stop the others. */
export async function connectProviders(
	providers: { id: string; kind: ProviderKind }[],
	rules: ProviderRule[],
	deps: ConnectDeps,
): Promise<ConnectResult[]> {
	const results: ConnectResult[] = [];
	for (const provider of providers) {
		const rule = rules.find((candidate) => candidate.id === provider.id);
		if (provider.kind === "oauth" && rule && !rule.enabled) {
			results.push({ provider: provider.id, status: "disabled" });
			continue;
		}
		try {
			let credential: Credential;
			if (provider.kind === "api_key") {
				const key = await deps.localApiKey(provider.id);
				if (!key) throw new Error("no API key saved on this computer");
				credential = { type: "api_key", key } as Credential;
			} else {
				// A fresh login into a sink nobody else sees; dropped when this block ends.
				const sink = new InMemoryCredentialStore();
				credential = await deps.login(sink, provider.id);
			}
			const { token } = await deps.enroll(provider.id);
			await deps.upload(token, credential);
			results.push({ provider: provider.id, status: "connected" });
		} catch (error) {
			results.push({
				provider: provider.id,
				status: "failed",
				error: error instanceof Error ? error.message : String(error),
			});
		}
	}
	return results;
}
