import { chmod, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { homedir, hostname } from "node:os";
import { dirname, join } from "node:path";

export const DEFAULT_RELAY_ORIGIN = "https://remote.knightcode.dev";
export const ENV_RELAY = "KNIGHTCODE_REMOTE_RELAY";
/** Overrides where the credential is stored. Exists so tests never write to a real home directory. */
export const ENV_CONFIG_DIR = "KNIGHTCODE_REMOTE_CONFIG_DIR";

const MINIMUM_INTERVAL_MS = 1_000;
const SLOW_DOWN_INCREMENT_MS = 5_000;

export function relayOrigin(): string {
	const configured = process.env[ENV_RELAY]?.trim();
	return configured && configured.length > 0 ? configured.replace(/\/+$/, "") : DEFAULT_RELAY_ORIGIN;
}

function tokenPath(): string {
	return join(process.env[ENV_CONFIG_DIR] ?? join(homedir(), ".knightcode"), "remote-auth.json");
}

export async function readToken(): Promise<string | undefined> {
	try {
		const parsed = JSON.parse(await readFile(tokenPath(), "utf8")) as { token?: unknown };
		return typeof parsed.token === "string" && parsed.token.length > 0 ? parsed.token : undefined;
	} catch {
		return undefined;
	}
}

export async function writeToken(token: string): Promise<void> {
	const path = tokenPath();
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify({ token }, null, 2)}\n`, "utf8");
	// Windows has no POSIX mode bits; the coordinator guards chmod the same way.
	if (process.platform !== "win32") await chmod(path, 0o600);
}

export async function deleteToken(): Promise<void> {
	await rm(tokenPath(), { force: true });
}

function sleep(milliseconds: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(new Error("Login cancelled"));
			return;
		}
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new Error("Login cancelled"));
		};
		const timer = setTimeout(() => {
			signal.removeEventListener("abort", onAbort);
			resolve();
		}, milliseconds);
		signal.addEventListener("abort", onAbort, { once: true });
	});
}

/**
 * RFC 8628 device flow against the relay. Reimplemented rather than imported from
 * packages/ai, whose export map does not reach auth/oauth/device-code. The slow_down
 * handling must stay: without it, clock drift under WSL polls early forever.
 */
export async function login(
	origin: string,
	onCode: (userCode: string, verificationUri: string) => void,
	signal: AbortSignal,
): Promise<string> {
	const startResponse = await fetch(`${origin}/auth/device`, {
		method: "POST",
		headers: { "x-knightcode-label": hostname() },
		signal,
	});
	if (!startResponse.ok) throw new Error(`Could not start login: ${startResponse.status}`);
	const start = (await startResponse.json()) as {
		device_code: string;
		user_code: string;
		verification_uri: string;
		interval?: number;
		expires_in?: number;
	};
	onCode(start.user_code, start.verification_uri);

	let intervalMs = Math.max(MINIMUM_INTERVAL_MS, (start.interval ?? 5) * 1000);
	const deadline = Date.now() + (start.expires_in ?? 600) * 1000;

	while (Date.now() < deadline) {
		if (signal.aborted) throw new Error("Login cancelled");
		const response = await fetch(`${origin}/auth/device/token`, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ device_code: start.device_code }),
			signal,
		});
		const body = (await response.json()) as { token?: string; error?: string; interval?: number };
		if (body.token) return body.token;
		if (body.error === "slow_down") {
			intervalMs =
				typeof body.interval === "number" && body.interval > 0
					? Math.max(MINIMUM_INTERVAL_MS, body.interval * 1000)
					: intervalMs + SLOW_DOWN_INCREMENT_MS;
		} else if (body.error !== "authorization_pending") {
			throw new Error(body.error ?? `Login failed: ${response.status}`);
		}
		await sleep(intervalMs, signal);
	}
	throw new Error("Login timed out");
}

/** Revoke the credential server-side, then remove the local copy. */
export async function logout(origin: string): Promise<void> {
	const token = await readToken();
	if (token) {
		await fetch(`${origin}/auth/revoke`, {
			method: "POST",
			headers: { authorization: `Bearer ${token}` },
		}).catch(() => {
			// A relay that cannot be reached still leaves the local file to remove; the
			// token keeps working until its row is revoked from another device.
		});
	}
	await deleteToken();
}
