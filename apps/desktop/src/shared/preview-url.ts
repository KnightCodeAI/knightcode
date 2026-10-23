/**
 * What a preview tab may show (desktop-shell.md section 9.8): http and https pages, and the blank page it starts on.
 * Main checks guest navigations against it; the address bar checks before it loads, since main never sees loadURL.
 */

/** A preview partition: one per thread, `persist:kc-preview:<threadId>`. */
export const PREVIEW_PARTITION = /^persist:kc-preview:[0-9a-zA-Z-]{1,64}$/;

export const previewPartition = (threadId: string) => `persist:kc-preview:${threadId}`;

export function isPreviewUrl(url: string): boolean {
	if (url === "about:blank") return true;
	try {
		const { protocol } = new URL(url);
		return protocol === "http:" || protocol === "https:";
	} catch {
		return false;
	}
}

const LOCAL = /^(localhost|127(?:\.\d{1,3}){3}|0\.0\.0\.0|\[::1\])(:\d+)?(?:[/?#]|$)/i;

/** A page served on this machine (a dev server): what a link in a message opens in the preview, not the browser. */
export function isLocalUrl(url: string): boolean {
	try {
		const { protocol, host } = new URL(url);
		return (protocol === "http:" || protocol === "https:") && LOCAL.test(host);
	} catch {
		return false;
	}
}

/**
 * What the address bar loads for what was typed: a URL as it is; a local address (`localhost:3000`) over http; a
 * host with a dot over https. Anything else, and anything that is not then a preview URL, is refused (undefined).
 */
export function previewAddress(typed: string): string | undefined {
	const text = typed.trim();
	if (!text || /\s/.test(text)) return undefined;
	const candidate = /^[a-z][a-z0-9+.-]*:/i.test(text) && !LOCAL.test(text)
		? text
		: LOCAL.test(text)
			? `http://${text}`
			: /^[^/?#]+\.[^/?#]+/.test(text)
				? `https://${text}`
				: undefined;
	return candidate && candidate !== "about:blank" && isPreviewUrl(candidate) ? new URL(candidate).toString() : undefined;
}
