import { expect, test } from "vitest";
import {
	isLocalUrl,
	isPreviewUrl,
	PREVIEW_PARTITION,
	previewAddress,
	previewPartition,
} from "../../src/shared/preview-url.ts";

test("a preview shows http and https pages and the blank page, nothing else", () => {
	expect(isPreviewUrl("http://localhost:3000/")).toBe(true);
	expect(isPreviewUrl("https://example.com/a?b#c")).toBe(true);
	expect(isPreviewUrl("about:blank")).toBe(true);
	for (const url of ["file:///etc/passwd", "javascript:alert(1)", "data:text/html,x", "app://desktop/index.html", "chrome://gpu", "nonsense"])
		expect(isPreviewUrl(url)).toBe(false);
});

test("the address bar adds the scheme a local or dotted address needs, and refuses the rest", () => {
	expect(previewAddress("localhost:3000")).toBe("http://localhost:3000/");
	expect(previewAddress(" 127.0.0.1:5173/app ")).toBe("http://127.0.0.1:5173/app");
	expect(previewAddress("[::1]:8080")).toBe("http://[::1]:8080/");
	expect(previewAddress("example.com/docs")).toBe("https://example.com/docs");
	expect(previewAddress("example.com:8080/docs")).toBe("https://example.com:8080/docs");
	expect(previewAddress("staging.example.com:8443")).toBe("https://staging.example.com:8443/");
	expect(previewAddress("https://example.com")).toBe("https://example.com/");
	for (const typed of ["", "hello world", "javascript:alert(1)", "file:///C:/x", "about:blank", "word"])
		expect(previewAddress(typed)).toBeUndefined();
});

test("only a page on this machine counts as local", () => {
	for (const url of ["http://localhost:3000/", "https://127.0.0.1/x", "http://[::1]:8080/", "http://0.0.0.0:5173"])
		expect(isLocalUrl(url)).toBe(true);
	for (const url of ["https://example.com", "http://localhost.evil.com/", "file:///localhost", "http://192.168.1.2/"])
		expect(isLocalUrl(url)).toBe(false);
});

test("a thread's partition is the one main lets a webview attach with", () => {
	expect(PREVIEW_PARTITION.test(previewPartition("019a3f2e-7b1c-7d40-9a2b-5c6d7e8f9a0b"))).toBe(true);
	expect(PREVIEW_PARTITION.test("persist:other")).toBe(false);
	expect(PREVIEW_PARTITION.test("persist:kc-preview:../x")).toBe(false);
});
