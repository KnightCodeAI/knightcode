// scripts/pack-test.ts — validate the published install end-to-end, locally.
// Packs knightcode with real `npm pack`, installs the tarball into a
// throwaway project the way users get it, and runs the installed command.
import { $ } from "bun";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:https";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { zstdCompressSync } from "node:zlib";
import pkg from "../packages/cli/package.json";

const ROOT = join(import.meta.dir, "..");
const expectedVersion = pkg.version;
const mainDir = join(ROOT, "packages", "cli");

if (!existsSync(join(mainDir, pkg.bin.knightcode))) {
	console.log("Bundle missing — building it...");
	await $`bun run ${join(ROOT, "scripts", "build-bundle.ts")}`.cwd(ROOT);
}

const work = mkdtempSync(join(tmpdir(), "kc-packtest-"));
const proj = join(work, "proj");
mkdirSync(proj);

try {
	// npm prints the tarball filename.
	const tarball = (await $`npm pack --silent --pack-destination ${work}`.cwd(mainDir).text()).trim();

	await $`npm init -y`.cwd(proj).quiet();
	// --ignore-scripts and --omit=dev match the installer and the documented commands.
	await $`npm install --no-audit --no-fund --ignore-scripts --omit=dev ${join(work, tarball)}`.cwd(proj);

	// Run the bin through npm's own shim, so a wrong `bin` path or a missing
	// runtime dependency fails here.
	const run = (...args: string[]) => $`npm exec --offline --no -- knightcode ${args}`.cwd(proj).nothrow().quiet();

	// --version must print exactly the package version. Check the exit code first:
	// a bin that crashes on startup prints nothing, and "got ''" hides why.
	const versionRun = await run("--version");
	if (versionRun.exitCode !== 0) {
		throw new Error(`--version exited ${versionRun.exitCode}: ${versionRun.stderr.toString()}`);
	}
	const version = versionRun.stdout.toString().trim();
	if (version !== expectedVersion) {
		throw new Error(`--version mismatch: got "${version}", expected "${expectedVersion}"`);
	}
	console.log(`✓ --version → ${version}`);

	// --help must exit 0 and print the usage banner. It is the only command that
	// exercises the bin → bundle → arg-parsing path without needing an API key:
	// anything unrecognised is treated as a prompt and sent to the provider, so an
	// invented subcommand "passes" by talking to a model instead of failing.
	const help = await run("--help");
	if (help.exitCode !== 0) {
		throw new Error(`--help exited ${help.exitCode}: ${help.stderr.toString()}`);
	}
	if (!help.stdout.toString().includes("Usage:")) {
		throw new Error("--help printed no usage banner");
	}
	console.log("✓ --help exit 0");

	const entry = join(proj, "node_modules", "knightcode", pkg.bin.knightcode);

	// One real turn on this Node, against a local OpenAI-compatible server. --version and --help
	// send no request. It is HTTPS and sends zstd only when asked, as Cloudflare does, because
	// fetch asks for zstd only over HTTPS: on a Node that cannot decode zstd, 0.18.0 asked anyway
	// and crashed on the reply. The throwaway certificate needs openssl on PATH.
	const key = join(work, "key.pem");
	const cert = join(work, "cert.pem");
	await $`openssl req -x509 -newkey rsa:2048 -nodes -keyout ${key} -out ${cert} -days 1 -subj /CN=127.0.0.1 -addext subjectAltName=IP:127.0.0.1`.quiet();
	let responseEncoding = "none";
	const server = createServer({ key: readFileSync(key), cert: readFileSync(cert) }, (request, response) => {
		const chunk = (delta: object, finish_reason: string | null) =>
			`data: ${JSON.stringify({ id: "pack-test", object: "chat.completion.chunk", created: 0, model: "mock-model", choices: [{ index: 0, delta, finish_reason }] })}\n\n`;
		const body = `${chunk({ role: "assistant", content: "pack-test-turn" }, null)}${chunk({}, "stop")}data: [DONE]\n\n`;
		responseEncoding = /\bzstd\b/.test(request.headers["accept-encoding"] ?? "") ? "zstd" : "identity";
		if (responseEncoding === "zstd") {
			response.writeHead(200, { "content-type": "text/event-stream", "content-encoding": "zstd" });
			response.end(zstdCompressSync(body));
		} else {
			response.writeHead(200, { "content-type": "text/event-stream" });
			response.end(body);
		}
	});
	await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
	try {
		const agentDir = join(work, "agent");
		mkdirSync(agentDir);
		const baseUrl = `https://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
		const provider = { baseUrl, api: "openai-completions", apiKey: "pack-test", models: [{ id: "mock-model" }] };
		writeFileSync(join(agentDir, "models.json"), JSON.stringify({ providers: { mock: provider } }));
		// Bun.spawn, not $: print mode reads piped stdin to EOF, and a $ redirect never closes it.
		const turn = Bun.spawn(["node", entry, "--offline", "--model", "mock/mock-model", "-p", "ping"], {
			cwd: proj,
			env: { ...process.env, KNIGHTCODE_CODING_AGENT_DIR: agentDir, NODE_EXTRA_CA_CERTS: cert },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			timeout: 120_000,
		});
		const [exitCode, stdout, stderr] = await Promise.all([
			turn.exited,
			new Response(turn.stdout).text(),
			new Response(turn.stderr).text(),
		]);
		if (exitCode !== 0 || !stdout.includes("pack-test-turn")) {
			throw new Error(`print-mode turn exited ${exitCode}: ${stderr}${stdout}`);
		}
		console.log(`✓ print-mode turn over HTTPS (${responseEncoding} response)`);
	} finally {
		server.close();
	}

	// npm installs the package on any Node with only a warning. An unsupported one must get the
	// launcher's version message, not a crash from inside the runtime. CI sets this.
	const oldNode = process.env.KNIGHTCODE_PACK_TEST_OLD_NODE;
	if (oldNode) {
		const old = await $`${oldNode} ${entry} --version`.nothrow().quiet();
		const message = old.stderr.toString();
		if (old.exitCode !== 1 || !message.includes(`requires Node.js ${pkg.engines.node.slice(2)} or newer`)) {
			throw new Error(`${oldNode} --version exited ${old.exitCode}: ${message}${old.stdout.toString()}`);
		}
		console.log(`✓ unsupported Node refused: ${message.split("\n")[0]}`);
	}

	// The TUI's native helpers ship inside the bundle for every platform. Check the
	// <platform>-<arch> directory loadNativePlatformHelper reads, not just the OS.
	const target = `${process.platform}-${process.arch}`;
	const prebuilds = join(process.platform, "prebuilds", target);
	const shipped = join(proj, "node_modules", "knightcode", "dist", "bundle", "native", prebuilds);
	if (existsSync(join(ROOT, "packages", "tui", "native", prebuilds)) && !existsSync(shipped)) {
		throw new Error(`Package has no native helpers for ${target}`);
	}
	console.log("✓ native helpers present");

	console.log(`pack-test passed on ${process.platform}-${process.arch}`);
} finally {
	try {
		rmSync(work, { recursive: true, force: true });
	} catch {
		// Windows may hold a handle on the temp sqlite db — OS reaps it.
	}
}
