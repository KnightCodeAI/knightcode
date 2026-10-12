/**
 * Process-wide state every app server connection shares (§5.2).
 *
 * Credentials are shared with the terminal CLI: both use the same AuthStorage
 * over auth.json, which holds a cross-process lock. Anthropic rotates refresh
 * tokens, so two stores kept in step would leave one holding a dead token.
 */

import type { Api, CredentialStore, Model } from "@knightcode/ai";
import type { NotificationMethod, NotificationParams } from "@knightcode/app-server-protocol";
import { join } from "node:path";
import { getAgentDir } from "../config.ts";
import { AuthStorage } from "../core/auth-storage.ts";
import { ModelRuntime } from "../core/model-runtime.ts";
import { SettingsManager } from "../core/settings-manager.ts";
import type { Subscriber } from "./server.ts";

export interface AppServerContext {
	models: ModelRuntime;
	credentials: CredentialStore;
	/** Global scope only: the app server's own cwd is not a project anyone trusted. */
	settings: SettingsManager;
	agentDir: string;
	/** An explicit session dir (flag, env, settings), or undefined for the per-project default layout. */
	sessionDir: string | undefined;
	/** Tests pin threads to the faux model; production leaves this unset. */
	defaultModel?: Model<Api>;
	connections: Set<Subscriber>;
	onDispose(cleanup: () => void): void;
	dispose(): void;
	broadcast<M extends NotificationMethod>(method: M, params: NotificationParams<M>): void;
}

export interface CreateAppServerContextOptions {
	agentDir?: string;
	sessionDir?: string;
	credentials?: CredentialStore;
	/** `null` keeps the model catalog in memory. Tests pass null. */
	modelsPath?: string | null;
	settings?: SettingsManager;
	defaultModel?: Model<Api>;
}

export async function createAppServerContext(options: CreateAppServerContextOptions = {}): Promise<AppServerContext> {
	const agentDir = options.agentDir ?? getAgentDir();
	const credentials = options.credentials ?? AuthStorage.create(join(agentDir, "auth.json"));
	const models = await ModelRuntime.create({
		credentials,
		modelsPath: options.modelsPath === undefined ? join(agentDir, "models.json") : options.modelsPath,
		allowModelNetwork: false,
	});
	const connections = new Set<Subscriber>();
	const cleanups = new Set<() => void>();
	let disposed = false;
	return {
		models,
		credentials,
		settings: options.settings ?? SettingsManager.create(process.cwd(), agentDir, { projectTrusted: false }),
		agentDir,
		sessionDir: options.sessionDir,
		defaultModel: options.defaultModel,
		connections,
		onDispose(cleanup) {
			if (disposed) cleanup();
			else cleanups.add(cleanup);
		},
		dispose() {
			if (disposed) return;
			disposed = true;
			for (const cleanup of cleanups) cleanup();
			cleanups.clear();
		},
		broadcast(method, params) {
			for (const connection of connections) connection.notify(method, params);
		},
	};
}
