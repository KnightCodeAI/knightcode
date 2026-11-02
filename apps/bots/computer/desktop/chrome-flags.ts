// How each bot's Chrome starts (spec section 7). One persistent profile per bot, never shared; one fingerprint per
// profile (a fixed window, language and time zone, matched to the exit address when one is set); WebRTC only through
// the proxy; QUIC off when proxied, so every connection takes the proxy; the debugging port on loopback only.

export interface ChromeOptions {
	profileDir: string;
	debugPort: number;
	/** BCP 47, matched to the exit address; default en-US. */
	language?: string;
	/** A proxy URL when the bot's traffic goes through the user's home connection or Tailscale. */
	proxy?: string;
}

export function chromeFlags(options: ChromeOptions): string[] {
	const language = options.language ?? "en-US";
	return [
		`--user-data-dir=${options.profileDir}`,
		"--remote-debugging-address=127.0.0.1",
		`--remote-debugging-port=${options.debugPort}`,
		// The container is the sandbox: user namespaces are not available inside it. Each bot's Chrome still runs as
		// that bot's own OS user, so profiles and processes stay apart.
		"--no-sandbox",
		"--no-first-run",
		"--no-default-browser-check",
		"--disable-dev-shm-usage",
		"--password-store=basic",
		"--restore-last-session",
		"--window-position=0,0",
		"--window-size=1280,800",
		`--lang=${language}`,
		`--accept-lang=${language},${language.split("-")[0]}`,
		"--force-webrtc-ip-handling-policy=disable_non_proxied_udp",
		...(options.proxy ? [`--proxy-server=${options.proxy}`, "--disable-quic"] : []),
	];
}
