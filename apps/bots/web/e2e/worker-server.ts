// The real backend's Worker for the browser tests, served straight from Miniflare: the bundle a `wrangler deploy
// --dry-run` built, with the bindings wrangler reads from the same config and the same local state `wrangler dev`
// keeps. `wrangler dev` puts a proxy in front of the Worker that ends the whole dev server when one proxied connection
// drops; without it, a lost connection fails only its own request.
//
//   node e2e/worker-server.ts <wrangler config> <bundle dir> <state dir> <port>
import { readdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { unstable_getMiniflareWorkerOptions } from "wrangler";

// The Miniflare wrangler itself runs, so the options it builds below match it.
const { Log, LogLevel, Miniflare, convertV4MiniflareOptions } = createRequire(import.meta.resolve("wrangler"))("miniflare") as typeof import("miniflare");

const [config, bundle, state, port] = process.argv.slice(2) as [string, string, string, string];
// Module rules only find modules for the older options; the bundle's are listed instead: the Worker, and the help
// pages it imports as text (the config's one rule).
const { modulesRules: _rules, ...workerOptions } = unstable_getMiniflareWorkerOptions(config).workerOptions;
const modules = [
	{ type: "ESModule" as const, path: join(bundle, "worker.js") },
	...readdirSync(bundle)
		.filter((name) => name.endsWith(".md"))
		.map((name) => ({ type: "Text" as const, path: join(bundle, name) })),
];
const worker = new Miniflare(
	convertV4MiniflareOptions({
		host: "127.0.0.1",
		port: Number(port),
		log: new Log(LogLevel.INFO),
		// The tests deliver inbound mail through /cdn-cgi/local/email, as wrangler dev serves it.
		unsafeTriggerHandlers: true,
		// Request traces kept under the state (v3/observability), for reading after a failed run.
		unsafeObservability: true,
		// Where `wrangler dev --persist-to <state>` keeps it, so `wrangler d1 migrations apply` writes the same database.
		resourcePersistencePath: join(state, "v3"),
		resourceTmpPath: join(dirname(config), ".wrangler", "tmp"),
		workers: [{ name: "knightcode-bots-e2e", ...workerOptions, modulesRoot: bundle, modules }],
	} as Parameters<typeof convertV4MiniflareOptions>[0]),
);
console.log(`[e2e] Worker ready on ${await worker.ready}`);
