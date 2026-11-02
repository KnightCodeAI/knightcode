// Tailscale (spec section 14): a bot's cloud computer can join the owner's tailnet to reach their machines, and use an
// exit node so its traffic leaves from the owner's network. It joins with a single-use, ephemeral, pre-authorized key
// tagged for bots (the node disappears when the computer stops), and runs tailscaled in userspace mode; Chrome and the
// shell reach the tailnet through tailscaled's local SOCKS5 and HTTP proxy.

export const BOT_TAG = "tag:knightcode-bot";
export const LOCAL_PROXY = "localhost:1055";

/** A single-use ephemeral key for one computer start, from the owner's Tailscale API access token. */
export async function ephemeralKey(input: { apiToken: string; tailnet?: string; apiUrl?: string; fetch?: typeof fetch }): Promise<string> {
	const base = (input.apiUrl ?? "https://api.tailscale.com").replace(/\/$/, "");
	const response = await (input.fetch ?? fetch)(`${base}/api/v2/tailnet/${encodeURIComponent(input.tailnet ?? "-")}/keys`, {
		method: "POST",
		headers: { authorization: `Bearer ${input.apiToken}`, "content-type": "application/json" },
		body: JSON.stringify({
			capabilities: { devices: { create: { reusable: false, ephemeral: true, preauthorized: true, tags: [BOT_TAG] } } },
			expirySeconds: 600,
			description: "KnightCode Bots computer",
		}),
	});
	if (!response.ok) throw new Error(`Tailscale answered ${response.status}`);
	return ((await response.json()) as { key: string }).key;
}

const quote = (value: string) => `'${value.replace(/'/g, `'\\''`)}'`;

/** The setup script that joins the tailnet (and uses `exitNode`, when given) on the computer. */
export function joinScript(input: { key: string; hostname: string; exitNode?: string }): string {
	return [
		`tailscaled --tun=userspace-networking --socks5-server=${LOCAL_PROXY} --outbound-http-proxy-listen=${LOCAL_PROXY} --state=mem: &`,
		"for _ in $(seq 1 50); do tailscale status >/dev/null 2>&1 && break; sleep 0.2; done",
		[
			"tailscale up",
			`--authkey=${quote(input.key)}`,
			`--hostname=${quote(input.hostname)}`,
			`--advertise-tags=${BOT_TAG}`,
			...(input.exitNode ? [`--exit-node=${quote(input.exitNode)}`, "--exit-node-allow-lan-access=false"] : []),
		].join(" "),
		`export ALL_PROXY=socks5h://${LOCAL_PROXY} HTTP_PROXY=http://${LOCAL_PROXY} HTTPS_PROXY=http://${LOCAL_PROXY}`,
	].join("\n");
}
