/**
 * Shared state every engine route receives.
 *
 * The engine owns inference; it holds no editor state. Credentials are shared
 * with the CLI: both read and write `auth.json` through the same `AuthStorage`,
 * which holds a cross-process lock. That is deliberate — one machine, one
 * account, two front doors — and `ModelRuntime` already defaults to that store,
 * so the engine passes nothing and inherits both the file and the lock.
 *
 * Sharing has to be exactly one store rather than two kept in step: Anthropic
 * rotates refresh tokens on every refresh, so two copies of one credential mean
 * whichever process refreshes second is holding a dead token.
 */

import type { CredentialStore } from "@knightcode/ai";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import { createEventBus, type EventBus } from "./events.ts";

export interface EngineContext {
	models: ModelRuntime;
	credentials: CredentialStore;
	events: EventBus;
}

export interface CreateEngineContextOptions {
	/** Overrides the shared store. Tests pass an in-memory one. */
	credentials?: CredentialStore;
	/** Path to the shared auth.json. Defaults to the CLI's. */
	authPath?: string;
	events?: EventBus;
	/** `null` keeps the model catalog and store entirely in memory. Tests pass null. */
	modelsPath?: string | null;
	allowModelNetwork?: boolean;
}

export async function createEngineContext(options: CreateEngineContextOptions = {}): Promise<EngineContext> {
	// One instance, shared by the runtime and the account routes. Two instances
	// over the same file would each hold their own in-process serialization and
	// only coordinate through the file lock.
	const credentials = options.credentials ?? AuthStorage.create(options.authPath);
	const models = await ModelRuntime.create({
		credentials,
		modelsPath: options.modelsPath,
		allowModelNetwork: options.allowModelNetwork ?? false,
	});
	return {
		models,
		credentials,
		events: options.events ?? createEventBus(),
	};
}
