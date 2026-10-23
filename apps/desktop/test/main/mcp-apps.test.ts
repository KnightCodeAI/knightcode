import { expect, test } from "vitest";
import { appCsp, cspSource, McpApps } from "../../src/main/mcp-apps.ts";
import { InvalidParams } from "../../src/main/open-in.ts";

const ORIGIN = "app://desktop";

test("an app that declares nothing gets the spec's default policy, framed only by the app", () => {
	expect(appCsp(undefined, ORIGIN)).toBe(
		"default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
			"font-src 'self'; media-src 'self' data:; connect-src 'none'; frame-src 'none'; base-uri 'self'; " +
			"frame-ancestors app://desktop",
	);
});

test("declared domains go into their own directives, rewritten from their parts", () => {
	const csp = appCsp(
		{
			resourceDomains: ["https://CDN.example.com", "https://cdn.example.com/"],
			connectDomains: ["wss://*.example.com:8443", "http://localhost:3000"],
			frameDomains: ["https://embed.example.org"],
			baseUriDomains: ["https://example.com"],
		},
		ORIGIN,
	);
	expect(csp).toContain("script-src 'self' 'unsafe-inline' https://cdn.example.com;");
	expect(csp).toContain("img-src 'self' data: https://cdn.example.com;");
	expect(csp).toContain("connect-src wss://*.example.com:8443 http://localhost:3000;");
	expect(csp).toContain("frame-src https://embed.example.org;");
	expect(csp).toContain("base-uri https://example.com;");
});

test("anything that is not a host source is refused, never passed through", () => {
	for (const entry of [
		"https://a.com; script-src *",
		"'unsafe-eval'",
		"'self'",
		"*",
		"https://a.com/path",
		"https://a.com,https://b.com",
		" https://a.com",
		"data:",
		"javascript://a.com",
		"http://example.com",
		"ws://example.com",
		"https://a.com:99999",
		"https://-bad.com",
		"x".repeat(300),
		42,
	])
		expect(() => cspSource(entry), String(entry)).toThrow(InvalidParams);
	expect(() => appCsp({ connectDomains: "https://a.com" as unknown as string[] }, ORIGIN)).toThrow(InvalidParams);
	expect(() => appCsp({ connectDomains: Array.from({ length: 33 }, (_, i) => `https://a${i}.com`) }, ORIGIN)).toThrow(
		InvalidParams,
	);
});

test("each app is served once on its own origin until released, alone with its window", async () => {
	const apps = new McpApps(ORIGIN);
	const a = apps.serve("<p>a</p>", undefined, 1);
	const b = apps.serve("<p>b</p>", { connectDomains: ["https://api.example.com"] }, 2);
	expect(a.url).toMatch(/^kc-mcp-app:\/\/[0-9a-f-]{36}\/index\.html$/);
	expect(new URL(a.url).host).not.toBe(new URL(b.url).host);
	const response = apps.handle(new Request(a.url));
	expect(response.status).toBe(200);
	expect(await response.text()).toBe("<p>a</p>");
	expect(response.headers.get("content-security-policy")).toContain("connect-src 'none'");
	expect(apps.handle(new Request(b.url)).headers.get("content-security-policy")).toContain(
		"connect-src https://api.example.com",
	);
	// Only the document itself, under its own origin.
	expect(apps.handle(new Request(a.url.replace("index.html", "other.js"))).status).toBe(404);
	apps.release(a.id);
	expect(apps.handle(new Request(a.url)).status).toBe(404);
	apps.releaseWindow(2);
	expect(apps.handle(new Request(b.url)).status).toBe(404);
});
