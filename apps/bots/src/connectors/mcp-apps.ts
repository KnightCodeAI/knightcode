// MCP App panels (spec section 9): an app's interactive UI resource is served from a separate sandbox origin, never
// from the app's own, under a strict content security policy: no network access of its own, no framing except by
// KnightCode Bots, and only inline or HTTPS scripts and styles. The panel talks to the app over postMessage, which the
// client checks against this origin.

/** The sandbox origin's host: panels never share an origin with the app or its cookies. */
export const SANDBOX_HOST = "sandbox.bots.knightcode.dev";

export function panelPolicy(appOrigin: string): string {
	return [
		"default-src 'none'",
		"script-src 'unsafe-inline' https:",
		"style-src 'unsafe-inline' https:",
		"img-src https: data: blob:",
		"font-src https: data:",
		"media-src https: data: blob:",
		"connect-src 'none'",
		"form-action 'none'",
		"base-uri 'none'",
		`frame-ancestors ${appOrigin}`,
	].join("; ");
}

/** The panel's HTML as the sandbox origin serves it. */
export function panelResponse(html: string, appOrigin: string): Response {
	return new Response(html, {
		headers: {
			"content-type": "text/html; charset=utf-8",
			"content-security-policy": panelPolicy(appOrigin),
			"x-content-type-options": "nosniff",
			"referrer-policy": "no-referrer",
			"cross-origin-resource-policy": "cross-origin",
			"cache-control": "no-store",
		},
	});
}

/** True for requests addressed to the sandbox origin, which serves panels and nothing else. */
export const isSandboxRequest = (url: URL) => url.hostname === SANDBOX_HOST || url.hostname.startsWith("sandbox.");
