/**
 * Real npm packages through the package manager and the real app server: an update retires the old revision's epoch
 * and activates the new one; a version whose declared desktop range excludes the app is refused whole. Packages come
 * from local tarballs, so no network or registry is needed.
 */
import { InMemoryCredentialStore } from "@knightcode/ai/auth/credential-store";
import { DesktopExtensionPhase, type DesktopActivationBinding } from "@knightcode/app-server-protocol";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Compile } from "typebox/compile";
import { afterEach, expect, it, vi } from "vitest";
import { createAppServerContext } from "../../src/app-server/context.ts";
import { DesktopExtensionManager } from "../../src/app-server/desktop-extensions/manager.ts";
import { desktopExtensionHandlers } from "../../src/app-server/desktop-extensions/handlers.ts";
import { createInProcessClient } from "../../src/app-server/in-process.ts";
import { DefaultPackageManager } from "../../src/core/package-manager.ts";
import { SettingsManager } from "../../src/core/settings-manager.ts";

const cleanups: (() => void)[] = [];
afterEach(() => {
	vi.unstubAllEnvs();
	for (const cleanup of cleanups.splice(0).reverse()) cleanup();
});
const checkPhase = Compile(DesktopExtensionPhase);

/** Pack one version of a frontend+backend package whose backend logs each start with its version. */
function pack(root: string, version: string, desktop: Record<string, unknown> = {}): string {
	const dir = join(root, `src-${version}`);
	mkdirSync(dir, { recursive: true });
	writeFileSync(
		join(dir, "package.json"),
		JSON.stringify({
			name: "kc-desktop-update-probe",
			version,
			type: "module",
			knightcode: { desktop: { frontend: "./app.js", backend: "./server.js", ...desktop } },
		}),
	);
	writeFileSync(join(dir, "app.js"), "export default {apiVersion:1,experimental_setup(){}};");
	writeFileSync(
		join(dir, "server.js"),
		`import { experimental_defineDesktopBackend } from "@knightcodeai/cli/desktop-backend";
import { Type } from "typebox";
import { appendFileSync } from "node:fs";
export default experimental_defineDesktopBackend(app => {
 app.experimental_onActivate(() => { appendFileSync(${JSON.stringify(join(root, "starts.txt"))}, "start:${version}\\n"); return () => appendFileSync(${JSON.stringify(join(root, "starts.txt"))}, "stop:${version}\\n"); });
 app.experimental_registerRpc({ id:"version", kind:"read", params:Type.Null(), result:Type.String(), experimental_handle: () => ${JSON.stringify(version)} });
});`,
	);
	execFileSync(process.platform === "win32" ? "npm.cmd" : "npm", ["pack", "--silent", "--pack-destination", root], {
		cwd: dir,
		shell: process.platform === "win32",
	});
	return join(root, `kc-desktop-update-probe-${version}.tgz`).replaceAll("\\", "/");
}

async function server(appVersion: string) {
	const root = mkdtempSync(join(tmpdir(), "kc-desktop-update-"));
	cleanups.push(() => rmSync(root, { recursive: true, force: true }));
	const agentDir = join(root, "agent");
	mkdirSync(agentDir);
	vi.stubEnv("KNIGHTCODE_DESKTOP_VERSION", appVersion);
	new DesktopExtensionManager(agentDir).setPreview(true);
	const settings = SettingsManager.create(root, agentDir);
	const packages = new DefaultPackageManager({
		cwd: root,
		agentDir,
		settingsManager: settings,
		commandOutput: "capture",
	});
	const install = async (tarball: string) => {
		await packages.installAndPersist(`npm:kc-desktop-update-probe@file:${tarball}`);
		await settings.flush();
	};
	return { root, install, ...(await connect(root, agentDir)) };
}

/** One app server process over the agent directory, with two simulated windows that acknowledge every phase. */
async function connect(root: string, agentDir: string) {
	const ctx = await createAppServerContext({ agentDir, credentials: new InMemoryCredentialStore(), modelsPath: null });
	cleanups.push(() => ctx.dispose());
	const client = createInProcessClient({ handlers: desktopExtensionHandlers(ctx), version: "test", mode: "desktop" });
	cleanups.push(() => client.close());
	await client.initialize();
	const bindings = new Map<number, DesktopActivationBinding>();
	client.onNotification((method, params) => {
		if (method !== "desktopExtension/phase" || !checkPhase.Check(params)) return;
		if (params.phase === "ready") bindings.set(params.windowId, params.binding);
		else if (params.phase === "revoke") bindings.delete(params.windowId);
		else
			void client
				.request("desktopExtension/ack", {
					windowId: params.windowId,
					lifetime: params.lifetime,
					id: params.id,
					binding: params.binding,
				})
				.catch(() => {});
	});
	for (const windowId of [1, 2])
		await client.request("desktopExtension/window/connect", { windowId, lifetime: `window-${windowId}` });
	let requestId = 0;
	const call = (windowId: number, binding: DesktopActivationBinding) =>
		client.request("desktopExtension/call", {
			windowId,
			lifetime: `window-${windowId}`,
			binding,
			requestId: ++requestId,
			method: "version",
			args: null,
		});
	const entry = async (review?: string) => (await client.request("desktopExtension/list", { review })).extensions[0]!;
	const starts = () => (existsSync(join(root, "starts.txt")) ? readFileSync(join(root, "starts.txt"), "utf8") : "");
	const restart = async () => {
		await ctx.dispose();
		client.close();
		return connect(root, agentDir);
	};
	return { client, bindings, call, entry, starts, restart };
}

it("an npm update retires the old revision in every window and activates the new one once", async () => {
	const app = await server("0.1.2");
	await app.install(pack(app.root, "1.0.0"));
	const first = await app.entry();
	await app.client.request("desktopExtension/set", {
		owner: first.owner,
		source: first.source,
		approve: true,
		revision: (await app.entry(first.owner)).revision,
		kinds: ["frontend", "backend"],
		enabled: true,
	});
	await app.client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	await vi.waitFor(() => expect(app.bindings.size).toBe(2));
	const old = app.bindings.get(1)!;
	expect(await app.call(1, old)).toEqual({ status: "ok", value: "1.0.0" });

	// A pinned revision approval does not follow an update; the user reviews the new revision.
	await app.install(pack(app.root, "2.0.0"));
	const updated = await app.entry();
	expect(updated.owner).toBe(first.owner);
	expect(updated.error).toMatch(/Source changed/);
	await app.client.request("desktopExtension/set", {
		owner: updated.owner,
		source: updated.source,
		approve: true,
		revision: (await app.entry(updated.owner)).revision,
		kinds: ["frontend", "backend"],
	});
	await vi.waitFor(() => expect(app.bindings.get(1)?.revision).not.toBe(old.revision));
	await vi.waitFor(() => expect(app.bindings.get(2)?.revision).toBe(app.bindings.get(1)!.revision));
	const next = app.bindings.get(1)!;
	expect(next.epoch).not.toBe(old.epoch);
	// Epoch-bound handles of the retired revision go inert; the new one answers.
	expect(await app.call(1, old)).toEqual({ status: "disconnected" });
	expect(await app.call(1, next)).toEqual({ status: "ok", value: "2.0.0" });
	expect(await app.call(2, app.bindings.get(2)!)).toEqual({ status: "ok", value: "2.0.0" });
	expect(app.starts()).toBe("start:1.0.0\nstop:1.0.0\nstart:2.0.0\n");
});

it("an installed version whose desktop range excludes the app is refused whole, never partly loaded", async () => {
	const app = await server("0.1.2");
	await app.install(pack(app.root, "1.0.0"));
	const first = await app.entry();
	await app.client.request("desktopExtension/set", {
		owner: first.owner,
		source: first.source,
		approve: true,
		revision: (await app.entry(first.owner)).revision,
		kinds: ["frontend", "backend"],
		dev: true,
		enabled: true,
	});
	await app.client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	await vi.waitFor(() => expect(app.bindings.size).toBe(2));
	const old = app.bindings.get(1)!;

	// Even development consent, which follows edits, does not admit a version for a newer app.
	await app.install(pack(app.root, "3.0.0", { app: ">=0.2.0" }));
	const refused = await app.entry();
	expect(refused.error).toBe(
		"Requires KnightCode desktop >=0.2.0; this is 0.1.2. Update the app or install a compatible version.",
	);
	expect(refused.artifact).toBeUndefined();
	await app.client.request("desktopExtension/reload", {});
	// As for any failed candidate (spec 8.1), the running revision stays live; the refused one never starts.
	expect(app.bindings.get(1)).toEqual(old);
	expect(await app.call(1, old)).toEqual({ status: "ok", value: "1.0.0" });
	expect(app.starts()).toBe("start:1.0.0\n");
	await expect(
		app.client.request("desktopExtension/set", {
			owner: refused.owner,
			source: refused.source,
			approve: true,
			kinds: ["frontend", "backend"],
		}),
	).rejects.toThrow(/Requires KnightCode desktop/);
	// After a restart there is no live pair to keep, and the refused version still does not load.
	const restarted = await app.restart();
	await restarted.client.request("desktopExtension/reconcile", { windowId: 1, lifetime: "window-1" });
	expect(restarted.bindings.size).toBe(0);
	expect((await restarted.entry()).error).toMatch(/Requires KnightCode desktop >=0.2.0/);
	expect(app.starts()).toBe("start:1.0.0\nstop:1.0.0\n");
});
