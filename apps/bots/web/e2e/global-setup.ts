// The real backend for the browser tests (BOTS_BACKEND=real): wrangler dev with local D1, R2, queues and Durable
// Objects on a fixed port (Vite proxies the Worker's paths to it), the emulated third-party services, and the fake model
// server, which the Worker offers as the provider "fake". Nothing deployed is touched. Returns the teardown.
import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { appendFileSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createEmulator } from "emulate";
import { TEST_OAUTH } from "../../emulate.config.ts";
import { emulatorBindings, stopEmulators } from "../../test/emulators.ts";
import { FAKE_MODELS, startFakeModelServer } from "../../test/fake-model-server.ts";

export const WEB_ORIGIN = "http://localhost:5190";
export const WORKER_PORT = 8799;
export const WORKER_URL = `http://127.0.0.1:${WORKER_PORT}`;

const app = fileURLToPath(new URL("../..", import.meta.url));
const at = (path: string) => resolve(app, path).replace(/\\/g, "/");

export default async function globalSetup(): Promise<() => Promise<void>> {
	const bindings = await emulatorBindings();
	// GitHub sign-in in the browser comes back to the web app's own origin.
	const github = await createEmulator({
		service: "github",
		port: 0,
		seed: {
			github: {
				users: [{ login: "ada-test", name: "Ada Test", email: "ada@example.com" }],
				oauth_apps: [
					{
						client_id: TEST_OAUTH.github.clientId,
						client_secret: TEST_OAUTH.github.clientSecret,
						name: "KnightCode Bots",
						redirect_uris: [`${WEB_ORIGIN}/auth/github/callback`],
					},
				],
			},
		},
	});
	const models = await startFakeModelServer();
	const state = at(".wrangler/e2e");
	rmSync(state, { recursive: true, force: true });
	mkdirSync(state, { recursive: true });
	const config = `${state}/wrangler.json`;
	writeFileSync(
		config,
		JSON.stringify(
			{
				name: "knightcode-bots-e2e",
				main: at("src/worker.ts"),
				compatibility_date: "2026-08-22",
				compatibility_flags: ["nodejs_compat"],
				rules: [{ type: "Text", globs: ["**/*.md"], fallthrough: true }],
				assets: { directory: at("test/fixtures/assets"), binding: "ASSETS", run_worker_first: true, html_handling: "none" },
				durable_objects: {
					bindings: [
						{ name: "BOT", class_name: "BotObject" },
						{ name: "USER", class_name: "UserObject" },
						{ name: "COMPUTER", class_name: "ComputerObject" },
					],
				},
				migrations: [{ tag: "v1", new_sqlite_classes: ["BotObject", "UserObject", "ComputerObject"] }],
				d1_databases: [{ binding: "DB", database_name: "knightcode-bots", database_id: "00000000-0000-0000-0000-000000000000", migrations_dir: at("migrations") }],
				r2_buckets: [{ binding: "FILES", bucket_name: "knightcode-bots-files" }],
				queues: { producers: [{ binding: "OUTBOUND", queue: "bots-outbound" }], consumers: [{ queue: "bots-outbound" }] },
				vars: {
					...bindings,
					EMULATE_GITHUB_URL: github.url,
					APP_ORIGIN: WEB_ORIGIN,
					SESSION_SECRET: "e2e-session-secret",
					TEST_KEK: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
					BOTS_COMPUTER_PROVIDER: "fake",
					BOTS_DEV_SEED: "1",
					BOTS_DEV_MODEL_URL: models.url,
					BOTS_DEV_MODEL_IDS: FAKE_MODELS.join(","),
					STRIPE_WEBHOOK_SECRET: "e2e-stripe-webhook-secret",
				},
			},
			null,
			"\t",
		),
	);
	const wrangler = ["bunx", "wrangler"];
	const migrate = spawnSync(wrangler[0]!, [...wrangler.slice(1), "d1", "migrations", "apply", "DB", "--local", "--config", config, "--persist-to", state], {
		cwd: app,
		shell: true,
		encoding: "utf8",
		env: { ...process.env, CI: "1" },
	});
	if (migrate.status !== 0) throw new Error(`D1 migrations failed:\n${migrate.stdout}\n${migrate.stderr}`);
	let log = "";
	// Kept for reading after a run: the Worker's own errors land here.
	const logFile = `${state}/dev.log`;
	const keep = (chunk: Buffer) => {
		log += chunk;
		appendFileSync(logFile, chunk);
	};
	let stopping = false;
	let dev: ChildProcess;
	// ponytail: wrangler dev has been seen to exit on its own mid-run (an empty "ERROR" line); it is started again on
	// the same local state, and the next test's fixture waits for it. A real failure still fails the test that hit it.
	const start = () => {
		dev = spawn(wrangler[0]!, [...wrangler.slice(1), "dev", "--config", config, "--persist-to", state, "--port", String(WORKER_PORT), "--ip", "127.0.0.1", "--local"], {
			cwd: app,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
			env: { ...process.env, CI: "1" },
		});
		dev.stdout?.on("data", keep);
		dev.stderr?.on("data", keep);
		dev.on("exit", () => {
			if (stopping) return;
			appendFileSync(logFile, "\n[e2e] wrangler dev exited; starting it again\n");
			start();
		});
	};
	start();
	const deadline = Date.now() + 120_000;
	for (;;) {
		const ready = await fetch(`${WORKER_URL}/api/account`).then(
			(response) => response.status === 401,
			() => false,
		);
		if (ready) break;
		if (Date.now() > deadline) throw new Error(`wrangler dev did not start:\n${log.slice(-4000)}`);
		await new Promise((done) => setTimeout(done, 500));
	}
	process.env.BOTS_FAKE_MODEL_URL = models.url;
	return async () => {
		stopping = true;
		// The whole tree: wrangler starts workerd under it.
		if (dev.pid && process.platform === "win32") spawnSync("taskkill", ["/T", "/F", "/PID", String(dev.pid)]);
		else dev.kill("SIGTERM");
		await Promise.all([models.close(), github.close(), stopEmulators()]);
	};
}
