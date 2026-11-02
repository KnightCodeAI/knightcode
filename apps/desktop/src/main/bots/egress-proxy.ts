// Home routing (spec sections 7 and 14): with "Route through my connection" on, the bots' web traffic leaves through
// the user's own connection: the cloud sends proxy frames over the desktop link and this proxy makes the connections.
// It reaches public destinations only, checked by what each name resolves to, unless the user authorized a private host
// (a NAS on the home network, say). With fail-closed set, a dropped link stops the traffic instead of letting it go
// out from the cloud.
import { isIP } from "node:net";

/** Private, loopback, link-local and other non-public addresses, v4 and v6. */
export function isPrivateAddress(address: string): boolean {
	const v4 = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/.exec(address.replace(/^::ffff:/i, ""));
	if (v4) {
		const [a, b] = [Number(v4[1]), Number(v4[2])];
		return (
			a === 0 ||
			a === 10 ||
			a === 127 ||
			(a === 169 && b === 254) ||
			(a === 172 && b >= 16 && b <= 31) ||
			(a === 192 && b === 168) ||
			(a === 100 && b >= 64 && b <= 127) ||
			a >= 224
		);
	}
	const v6 = address.toLowerCase();
	return v6 === "::1" || v6 === "::" || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
}

export interface EgressPolicy {
	/** host or host:port the user allowed to be private ("none by default"). */
	authorizedHosts: string[];
}

/** Whether a connection to `host` (resolving to `addresses`) may go out. */
export function egressAllowed(host: string, port: number, addresses: string[], policy: EgressPolicy): boolean {
	const name = host.toLowerCase();
	if (
		policy.authorizedHosts.some(
			(allowed) => allowed.toLowerCase() === name || allowed.toLowerCase() === `${name}:${port}`,
		)
	)
		return true;
	if (name === "localhost" || name.endsWith(".localhost") || name.endsWith(".local") || name.endsWith(".internal"))
		return false;
	const all = isIP(name) ? [name] : addresses;
	return all.length > 0 && all.every((address) => !isPrivateAddress(address));
}

/** Where the cloud sends a bot's traffic: through the user's connection, straight out, or nowhere. */
export function routeFor(input: {
	homeRouting: boolean;
	linkUp: boolean;
	failClosed: boolean;
}): "home" | "direct" | "blocked" {
	if (!input.homeRouting) return "direct";
	if (input.linkUp) return "home";
	return input.failClosed ? "blocked" : "direct";
}
