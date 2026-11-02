// Abuse rules for the computer (spec section 7): outbound mail (port 25) and mining pools are blocked, and new
// connections are rate limited per process. The image enforces them with a connect() guard loaded into every process
// (computer/netguard) and a hosts-file block, both written from these values when the bridge starts.

/** Ports no process may connect to: SMTP, and the usual mining pool (stratum) ports. */
export const BLOCKED_PORTS = [25, 3333, 4444, 5555, 7777, 14444, 14433, 45700] as const;

/** Mining pool hosts, resolved to nowhere. */
export const BLOCKED_HOSTS = [
	"pool.minexmr.com",
	"xmr.nanopool.org",
	"xmr-eu1.nanopool.org",
	"xmr-us-east1.nanopool.org",
	"pool.supportxmr.com",
	"gulf.moneroocean.stream",
	"xmrpool.eu",
	"monerohash.com",
	"eth.2miners.com",
	"rvn.2miners.com",
	"stratum.antpool.com",
	"btc.f2pool.com",
	"ss.antpool.com",
	"mine.c3pool.com",
	"auto.c3pool.org",
] as const;

/** New outbound connections one process may open per second before the guard refuses more. */
export const CONNECTIONS_PER_SECOND = 50;

/** The guard's config file: one rule per line. */
export function netguardConfig(): string {
	return [`rate ${CONNECTIONS_PER_SECOND}`, ...BLOCKED_PORTS.map((port) => `port ${port}`)].join("\n") + "\n";
}

/** Lines for /etc/hosts that send the blocked hosts nowhere, over IPv4 and IPv6 (else AAAA lookups reach DNS). */
export function hostsBlock(): string {
	return BLOCKED_HOSTS.flatMap((host) => [`0.0.0.0 ${host}`, `:: ${host}`]).join("\n") + "\n";
}
