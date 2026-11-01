import { afterEach, describe, expect, it, vi } from "vitest";
import { findTrigger } from "../src/chat/Composer.tsx";
import { isAllowed } from "../src/chat/McpAppFrame.tsx";
import { parseChartSpec } from "../src/chat/rich/Chart.tsx";

describe("isAllowed", () => {
	afterEach(() => vi.unstubAllGlobals());
	it("allows only the sandbox origin, never the app's own", () => {
		vi.stubGlobal("location", { origin: "https://app.example" });
		expect(isAllowed("https://sandbox.example/panel?x=1", "https://sandbox.example")).toBe(true);
		expect(isAllowed("https://evil.example/panel", "https://sandbox.example")).toBe(false);
		expect(isAllowed("https://app.example/panel", "https://app.example")).toBe(false);
		expect(isAllowed("https://sandbox.example/panel", undefined)).toBe(false);
		expect(isAllowed("not a url", "https://sandbox.example")).toBe(false);
	});
});

describe("findTrigger", () => {
	it("finds an @ mention at the caret and a / skill only at the start", () => {
		expect(findTrigger("hi @in", 6)).toEqual({ char: "@", start: 3, query: "in" });
		expect(findTrigger("@", 1)).toEqual({ char: "@", start: 0, query: "" });
		expect(findTrigger("mail@example", 12)).toBeUndefined();
		expect(findTrigger("/rev", 4)).toEqual({ char: "/", start: 0, query: "rev" });
		expect(findTrigger("a /rev", 6)).toBeUndefined();
	});
});

describe("parseChartSpec", () => {
	it("accepts a well-formed spec and rejects anything else", () => {
		expect(parseChartSpec('{"kind":"bar","labels":["a"],"series":[{"name":"s","values":[1]}]}')).toEqual({
			kind: "bar",
			title: undefined,
			labels: ["a"],
			series: [{ name: "s", values: [1] }],
		});
		expect(parseChartSpec('{"kind":"script","labels":[],"series":[]}')).toBeUndefined();
		expect(parseChartSpec('{"kind":"line","labels":["a"],"series":[{"name":"s","values":["1"]}]}')).toBeUndefined();
		expect(parseChartSpec("not json")).toBeUndefined();
	});
});
