/** Run with `node test/profiler/streaming.mts` from apps/desktop; compare S4/current React commit counts. */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import type { AddressInfo } from "node:net";
import { join, resolve } from "node:path";
import react from "@vitejs/plugin-react";
import { _electron } from "@playwright/test";
import { createServer, normalizePath } from "vite";
import type { ProfileMetrics } from "./fixture.tsx";

declare global {
	interface Window {
		__streamingProfile: Promise<ProfileMetrics>;
	}
}
const desktop = fileURLToPath(new URL("../..", import.meta.url));
const repo = resolve(desktop, "../..");
const root = mkdtempSync(join(tmpdir(), "kc-stream-profile-"));
const env: Record<string, string> = {};
for (const key of [
	"PATH",
	"Path",
	"SystemRoot",
	"SYSTEMROOT",
	"WINDIR",
	"SystemDrive",
	"COMSPEC",
	"PATHEXT",
	"TEMP",
	"TMP",
	"TMPDIR",
	"DISPLAY",
	"WAYLAND_DISPLAY",
	"XAUTHORITY",
	"XDG_RUNTIME_DIR",
	"DBUS_SESSION_BUS_ADDRESS",
]) {
	const value = process.env[key];
	if (value !== undefined) env[key] = value;
}
for (const key of [
	"HOME",
	"USERPROFILE",
	"APPDATA",
	"LOCALAPPDATA",
	"XDG_CONFIG_HOME",
	"XDG_CACHE_HOME",
	"XDG_DATA_HOME",
]) {
	env[key] = join(root, key);
	mkdirSync(env[key], { recursive: true });
}
const fixture = { root, userData: join(root, "userdata"), env: { ...env, TZ: "UTC", LANG: "en_US.UTF-8" } };
mkdirSync(fixture.userData, { recursive: true });
const baseline = "4c77893e1";
const sources = ["items", "composer"].map((name) => ({
	name,
	path: join(desktop, `src/renderer/components/.profile-${process.pid}-${name}.tsx`),
}));
const clientPath = normalizePath(join(desktop, "test/profiler/client.ts"));
const fixturePath = normalizePath(join(desktop, "test/profiler/fixture.tsx"));
const main = join(fixture.root, "profiler.cjs");
let app: Awaited<ReturnType<typeof _electron.launch>> | undefined;
const server = await createServer({
	configFile: false,
	root: desktop,
	plugins: [
		{
			name: "streaming-profile-fixture",
			enforce: "pre",
			configureServer(server) {
				server.middlewares.use("/profile.html", (request, response, next) => {
					void server
						.transformIndexHtml(
							request.url ?? "/profile.html",
							`<div id="root"></div><script>window.knightcode={platform:${JSON.stringify(process.platform)},windowId:0,safeMode:true};</script><script type="module" src="/@id/__x00__streaming-profile.tsx"></script>`,
						)
						.then((html) => {
							response.setHeader("Content-Type", "text/html");
							response.end(html);
						}, next);
				});
			},
			resolveId(source, importer) {
				if (importer && normalizePath(importer).includes("/src/renderer/") && /(?:^|\/)client\.ts$/.test(source))
					return clientPath;
				if (source === "virtual:streaming-profile") return "\0streaming-profile.tsx";
			},
			load(id) {
				if (id !== "\0streaming-profile.tsx") return;
				return `import {profile} from ${JSON.stringify(fixturePath)};
import {TurnView} from ${JSON.stringify(normalizePath(sources[0]!.path))};
import {Composer} from ${JSON.stringify(normalizePath(sources[1]!.path))};
window.__streamingProfile=profile(...(new URLSearchParams(location.search).get("revision")==="baseline"?[TurnView,Composer]:[]));`;
			},
		},
		react(),
	],
	resolve: { dedupe: ["react", "react-dom"] },
	server: {
		host: "127.0.0.1",
		port: 0,
		fs: { allow: [repo] },
		watch: { ignored: ["**/out/**", "**/.vite/**", "**/resources/**"] },
	},
});
try {
	for (const source of sources)
		writeFileSync(
			source.path,
			execFileSync("git", ["show", `${baseline}:apps/desktop/src/renderer/components/${source.name}.tsx`], {
				cwd: repo,
				encoding: "utf8",
			}),
		);
	writeFileSync(
		main,
		'const {app,BrowserWindow}=require("electron");app.setPath("userData",process.env.PROFILE_USER_DATA);let window;app.whenReady().then(()=>{window=new BrowserWindow({width:1280,height:820,show:false,webPreferences:{backgroundThrottling:false}});window.loadURL(process.argv[2]);});',
	);
	await server.listen();
	// listen() above always binds a TCP address, never a pipe.
	const address = server.httpServer!.address() as AddressInfo;
	const url = `http://127.0.0.1:${address.port}/profile.html`;
	app = await _electron.launch({
		args: [main, url + "?revision=baseline", ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
		env: { ...fixture.env, PROFILE_USER_DATA: fixture.userData },
	});
	const page = await app.firstWindow();
	page.on("pageerror", (error) => console.error(error));
	page.on("console", (message) => {
		if (message.type() === "error") console.error(message.text());
	});
	await page.waitForURL(url + "?revision=baseline", { waitUntil: "load" });
	await page.waitForFunction(() => !!window.__streamingProfile, undefined, { timeout: 120_000 });
	const before = await page.evaluate(() => window.__streamingProfile);
	await page.goto(url + "?revision=current");
	await page.waitForFunction(() => !!window.__streamingProfile, undefined, { timeout: 120_000 });
	const after = await page.evaluate(() => window.__streamingProfile);
	console.log(JSON.stringify({ baseline, before, after }, null, 2));
	assert.equal(after.chunks, before.chunks);
	assert.equal(Object.keys(after.commits).length, before.history + 2, "Every turn and the composer must be profiled");
	for (const [id, count] of Object.entries(before.commits)) {
		assert.ok(count > 0, `${id} did not receive streaming commits`);
		assert.equal(after.commits[id], count, `${id} gained streaming React commits`);
	}
	console.log("Streaming React Profiler: no additional transcript/composer commits.");
} finally {
	await app?.close();
	await server.close();
	for (const source of sources) rmSync(source.path, { force: true });
	rmSync(fixture.root, { recursive: true, force: true });
}
