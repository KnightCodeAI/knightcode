/**
 * Loopback must never go through a proxy: a corporate HTTP_PROXY otherwise
 * swallows the traffic between the engine and its own clients. Bun's fetch
 * honours the proxy variables, so every entry that talks to the engine over
 * loopback calls this before its first request.
 */
export function bypassProxyForLoopback(): void {
	for (const key of ["NO_PROXY", "no_proxy"]) {
		const entries = (process.env[key] ?? "")
			.split(",")
			.map((value) => value.trim())
			.filter((value) => value.length > 0);
		for (const host of ["127.0.0.1", "localhost", "::1"]) {
			if (!entries.some((value) => value.toLowerCase() === host)) entries.push(host);
		}
		process.env[key] = entries.join(",");
	}
}
