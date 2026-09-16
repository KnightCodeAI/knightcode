import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

const MAX_URL_LENGTH = 2000;

export interface GuardOptions {
	/** Exact hostnames exempt from the private-host checks (tests use it for their fixture server). */
	allowHosts?: string[];
	/** DNS seam for tests. */
	lookup?: (hostname: string) => Promise<{ address: string }>;
}

// net.BlockList parses each literal itself, so an IPv4-mapped IPv6 address written in hex
// ([::ffff:7f00:1]) or an uncompressed ::1 is checked against the same ranges as its plain spelling.
const PRIVATE = new BlockList();
PRIVATE.addSubnet("0.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("10.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("100.64.0.0", 10, "ipv4");
PRIVATE.addSubnet("127.0.0.0", 8, "ipv4");
PRIVATE.addSubnet("169.254.0.0", 16, "ipv4");
PRIVATE.addSubnet("172.16.0.0", 12, "ipv4");
PRIVATE.addSubnet("192.168.0.0", 16, "ipv4");
PRIVATE.addAddress("::", "ipv6");
PRIVATE.addAddress("::1", "ipv6");
PRIVATE.addSubnet("fc00::", 7, "ipv6");
PRIVATE.addSubnet("fe80::", 10, "ipv6");

export function isPrivateAddress(ip: string): boolean {
	const family = isIP(ip);
	return family !== 0 && PRIVATE.check(ip, family === 4 ? "ipv4" : "ipv6");
}

function stripBrackets(hostname: string): string {
	return hostname.startsWith("[") && hostname.endsWith("]") ? hostname.slice(1, -1) : hostname;
}

export function isBlockedHostname(hostname: string): boolean {
	const host = hostname.toLowerCase().replace(/\.$/, "");
	if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) {
		return true;
	}
	const literal = stripBrackets(host);
	return isIP(literal) !== 0 && isPrivateAddress(literal);
}

export interface PublicUrl {
	/** As requested: names the page and resolves relative redirects. */
	url: URL;
	/**
	 * Where the connection goes: `url` with the hostname swapped for the address that passed the
	 * check, so the fetch cannot resolve the name a second time (rebinding, mixed answers). The
	 * same object as `url` for IP literals and allowHosts.
	 */
	connect: URL;
}

export async function assertPublicUrl(raw: string, options: GuardOptions = {}): Promise<PublicUrl> {
	if (raw.length > MAX_URL_LENGTH) throw new Error(`Blocked: URL longer than ${MAX_URL_LENGTH} characters`);
	let url: URL;
	try {
		url = new URL(raw);
	} catch {
		throw new Error(`Blocked: not a valid URL: ${raw}`);
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error(`Blocked: only http and https URLs are fetched (got ${url.protocol})`);
	}
	if (url.username || url.password) throw new Error("Blocked: URLs with credentials are not fetched");
	if (options.allowHosts?.includes(url.hostname)) return { url, connect: url };
	if (isBlockedHostname(url.hostname)) throw new Error(`Blocked: ${url.hostname} is a private or local host`);
	if (isIP(stripBrackets(url.hostname)) !== 0) return { url, connect: url };
	const lookup = options.lookup ?? ((hostname: string) => dns.lookup(hostname));
	let address: string;
	try {
		({ address } = await lookup(url.hostname));
	} catch {
		throw new Error(`Blocked: could not resolve ${url.hostname}`);
	}
	if (isPrivateAddress(address)) throw new Error(`Blocked: ${url.hostname} resolves to a private address`);
	const connect = new URL(url);
	connect.hostname = isIP(address) === 6 ? `[${address}]` : address;
	return { url, connect };
}
