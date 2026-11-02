// Fetch for connectors (spec section 9): MCP servers, OAuth discovery and token endpoints are chosen by users and by
// third parties, so every hop is checked before it is made, redirects included. A host must resolve only to public
// addresses unless the user allowed it (a private service reached through their home connection). Credentials
// (Authorization, cookies, API key headers) go only to the origin they were issued for: a redirect to another origin
// drops them. Workers cannot pin a connection to the checked address, but their egress never reaches private
// networks, which closes the rebinding gap the check leaves.

/** Hosts a bot may not reach: loopback, private and link-local ranges, and local names. */
export function isPublicHost(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) return false;
	const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(host);
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return !(a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224);
	}
	if (host.includes(":")) return !(host === "::1" || host === "::" || /^f[cd]/.test(host) || /^fe[89ab]/.test(host) || host.startsWith("::ffff:"));
	return host.includes(".");
}

export interface FetchPolicy {
	/** Refuse redirects to another origin (calls that carry a credential). */
	sameOrigin?: boolean;
	/** host or host:port the user allowed to be private (none by default). */
	allowPrivate: string[];
	/** Resolves a name to its addresses; DNS over HTTPS by default. */
	resolve?: (hostname: string) => Promise<string[]>;
	maxRedirects?: number;
}

export class BlockedAddress extends Error {
	constructor(host: string) {
		super(`${host} is a private address; connectors may only reach public ones`);
		this.name = "BlockedAddress";
	}
}

/** Headers that carry credentials and never cross to another origin. */
const CREDENTIALS = ["authorization", "cookie", "proxy-authorization", "x-api-key", "api-key", "x-auth-token"];

const IP = /^(\d+\.\d+\.\d+\.\d+|\[?[0-9a-f:]+\]?)$/i;

/** A and AAAA records from Cloudflare's DNS-over-HTTPS resolver. */
export async function resolveOverHttps(hostname: string): Promise<string[]> {
	const answers = await Promise.all(
		["A", "AAAA"].map(async (type) => {
			const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`, {
				headers: { accept: "application/dns-json" },
			});
			if (!response.ok) throw new Error(`could not resolve ${hostname}`);
			const body = (await response.json()) as { Answer?: { type: number; data: string }[] };
			return (body.Answer ?? []).filter((answer) => answer.type === 1 || answer.type === 28).map((answer) => answer.data);
		}),
	);
	return answers.flat();
}

async function check(url: URL, policy: FetchPolicy): Promise<void> {
	if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`${url.protocol} addresses are not allowed`);
	const hostname = url.hostname.replace(/^\[|\]$/g, "");
	if (policy.allowPrivate.includes(url.host) || policy.allowPrivate.includes(hostname)) return;
	if (!isPublicHost(hostname)) throw new BlockedAddress(url.host);
	if (IP.test(hostname)) return;
	const addresses = await (policy.resolve ?? resolveOverHttps)(hostname);
	if (addresses.length === 0) throw new Error(`${hostname} does not resolve`);
	for (const address of addresses) if (!isPublicHost(address)) throw new BlockedAddress(`${url.host} (${address})`);
}

/** `fetch` with every hop checked and credentials kept to their issuing origin. */
export async function guardedFetch(input: RequestInfo | URL, init: RequestInit = {}, policy: FetchPolicy): Promise<Response> {
	const request = input instanceof Request ? input : undefined;
	let url = new URL(request ? request.url : String(input));
	const issuing = url.origin;
	let method = (init.method ?? request?.method ?? "GET").toUpperCase();
	let body = init.body ?? (request && !["GET", "HEAD"].includes(method) ? await request.arrayBuffer() : undefined);
	const headers = new Headers(init.headers ?? request?.headers);
	for (let hop = 0; hop <= (policy.maxRedirects ?? 5); hop++) {
		await check(url, policy);
		// A call carrying a vault credential (in any header) stays on its issuing origin.
		if (policy.sameOrigin && url.origin !== issuing) throw new Error(`redirected to another origin (${url.origin}); the credential is not sent there`);
		const hopHeaders = new Headers(headers);
		if (url.origin !== issuing) for (const name of CREDENTIALS) hopHeaders.delete(name);
		const response = await fetch(url, { ...init, method, headers: hopHeaders, body, redirect: "manual" });
		const location = response.headers.get("location");
		if (response.status < 300 || response.status >= 400 || !location) return response;
		await response.body?.cancel();
		url = new URL(location, url);
		// As browsers do: 303, and 301/302 after a POST, continue as GET without a body.
		if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === "POST")) {
			method = "GET";
			body = undefined;
			headers.delete("content-type");
		}
	}
	throw new Error("too many redirects");
}

/** A fetch with this policy bound, in the shape the MCP client and OAuth code take. */
export const guardedFetcher =
	(policy: FetchPolicy): typeof fetch =>
	(input, init) =>
		guardedFetch(input as RequestInfo | URL, init, policy);
