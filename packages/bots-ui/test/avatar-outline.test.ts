// Selection outlines follow the rendered body, including its motion and shape transitions, without tracing eyes.
import { describe, expect, it } from "vitest";
import { createEngine } from "../src/avatar/motion.ts";
import { renderTree, type RenderOptions } from "../src/avatar/render.ts";
import type { SvgNode } from "../src/avatar/svg.ts";

const descendants = (node: SvgNode): SvgNode[] => [node, ...node.children.flatMap(descendants)];
const geometry = (node: SvgNode): SvgNode => ({
	...node,
	attrs: Object.fromEntries(Object.entries(node.attrs).filter(([key]) => !/^(fill|stroke|vector-effect)/.test(key))),
	children: node.children.map(geometry),
});

describe("avatar selection outline", () => {
	it("traces the body without the eye cutouts", () => {
		for (const body of ["sphere", "house", "starFlower"] as const) {
			const engine = createEngine({ body });
			const frame = engine.frame();
			const options: RenderOptions = { hasOutline: true };
			const tree = renderTree(frame, { ink: "#ff6700" }, 64, "picker", options);
			const ring = descendants(tree).find((node) => node.attrs["data-avatar-outline"] === "");
			expect(ring, body).toBeDefined();
			const silhouette = renderTree({ ...frame, eyes: null }, { ink: "#fff" }, 64, "picker-outline");
			const traced = descendants(tree).find((node) => node.attrs.id === "picker-outline-silhouette");
			expect(traced, body).toBeDefined();
			expect(traced!.children.map(geometry), body).toEqual(silhouette.children.map(geometry));
			expect(
				descendants(traced!).some((node) => node.tag === "mask"),
				body,
			).toBe(false);
		}
	});

	it("keeps the ring geometry in sync during a shape morph", () => {
		const engine = createEngine({ body: "house" });
		engine.setBody("starFlower");
		const rings: SvgNode[] = [];
		for (let i = 0; i < 3; i++) {
			engine.advance(0.1);
			const frame = engine.frame();
			const tree = renderTree(frame, { ink: "#ff6700" }, 64, "picker", { hasOutline: true });
			const ring = descendants(tree).find((node) => node.attrs["data-avatar-outline"] === "");
			expect(ring).toBeDefined();
			const silhouette = renderTree({ ...frame, eyes: null }, { ink: "#fff" }, 64, "picker-outline");
			const traced = descendants(tree).find((node) => node.attrs.id === "picker-outline-silhouette");
			expect(traced).toBeDefined();
			expect(traced!.children.map(geometry)).toEqual(silhouette.children.map(geometry));
			rings.push(traced!);
		}
		expect(rings[0]).not.toEqual(rings[1]);
		expect(rings[1]).not.toEqual(rings[2]);
	});

	it("uses rounded, non-scaling strokes for a consistent gap and thickness", () => {
		const engine = createEngine({ body: "house" });
		const tree = renderTree(engine.frame(), { ink: "#ff6700" }, 64, "picker", { hasOutline: true });
		const nodes = descendants(tree);
		expect(nodes.some((node) => node.tag === "feMorphology")).toBe(false);
		const traced = nodes.find((node) => node.attrs.id === "picker-outline-silhouette");
		expect(traced).toBeDefined();
		for (const path of descendants(traced!).filter((node) => node.tag === "path")) {
			expect(path.attrs["vector-effect"]).toBe("non-scaling-stroke");
			expect(path.attrs["stroke-linejoin"]).toBe("round");
		}
		const ring = nodes.find((node) => node.attrs["data-avatar-outline"] === "");
		expect(ring?.attrs["stroke-width"]).toBe(8);
		const gap = nodes.find((node) => node.tag === "use" && node.attrs.stroke === "#000");
		expect(gap?.attrs["stroke-width"]).toBe(5);
	});

	it("does no outline rendering for ordinary avatars", () => {
		const engine = createEngine({ body: "house" });
		const tree = renderTree(engine.frame(), { ink: "#ff6700" }, 64, "plain");
		expect(descendants(tree).some((node) => "data-avatar-outline" in node.attrs)).toBe(false);
		expect(descendants(tree).some((node) => node.tag === "filter")).toBe(false);
	});
});
