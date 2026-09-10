/**
 * Shared state every engine route receives.
 *
 * The engine owns credentials and inference; it holds no editor state. Routes
 * read this and nothing else, so a route can be tested by constructing a
 * context with an in-memory secret backend and no filesystem paths.
 */

import type { CredentialStore } from "@knightcode/ai";
import { ModelRuntime } from "../core/model-runtime.ts";
import { createEventBus, type EventBus } from "./events.ts";
import { createEngineCredentialStore } from "./keychain-store.ts";
import type { AccountIndex, SecretBackend } from "./secrets.ts";

export interface EngineContext {
	models: ModelRuntime;
	credentials: CredentialStore;
	events: EventBus;
	/** False when no OS keychain was available and the file store is in use. */
	keychainAvailable: boolean;
}

export interface CreateEngineContextOptions {
	credentials?: CredentialStore;
	backend?: SecretBackend;
	index?: AccountIndex;
	indexPath?: string;
	fallbackAuthPath?: string;
	events?: EventBus;
	/** `null` keeps the model catalog and store entirely in memory. Tests pass null. */
	modelsPath?: string | null;
	allowModelNetwork?: boolean;
}

export async function createEngineContext(options: CreateEngineContextOptions = {}): Promise<EngineContext> {
	const credentials =
		options.credentials ??
		createEngineCredentialStore({
			backend: options.backend,
			index: options.index,
			indexPath: options.indexPath,
			fallbackAuthPath: options.fallbackAuthPath,
		});
	const models = await ModelRuntime.create({
		credentials,
		modelsPath: options.modelsPath,
		allowModelNetwork: options.allowModelNetwork ?? false,
	});
	return {
		models,
		credentials,
		events: options.events ?? createEventBus(),
		keychainAvailable: options.backend !== undefined,
	};
}
