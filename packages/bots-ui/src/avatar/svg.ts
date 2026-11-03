// A tiny SVG element tree: serialised for the first paint, then patched in place frame by frame.

export interface SvgNode {
	tag: string;
	attrs: Record<string, string | number>;
	children: SvgNode[];
}

export const el = (tag: string, attrs: Record<string, string | number>, children: SvgNode[] = []): SvgNode => ({
	tag,
	attrs,
	children,
});

export function svgRoot(viewSize: number, id: string, size: number | string, children: SvgNode[]): SvgNode {
	return el(
		"svg",
		{ xmlns: "http://www.w3.org/2000/svg", id, width: size, height: size, viewBox: `0 0 ${viewSize} ${viewSize}` },
		children,
	);
}

const SELF_CLOSING = new Set(["path", "use", "rect", "stop", "circle"]);
const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" };

export function serialize(node: SvgNode): string {
	let attrs = "";
	for (const [name, value] of Object.entries(node.attrs))
		attrs += ` ${name}="${String(value).replace(/[&<>"]/g, (c) => ESCAPES[c]!)}"`;
	return SELF_CLOSING.has(node.tag)
		? `<${node.tag}${attrs}/>`
		: `<${node.tag}${attrs}>${node.children.map(serialize).join("")}</${node.tag}>`;
}

const SVG_NS = "http://www.w3.org/2000/svg";
const END = "/";

interface Mounted {
	root: Element;
	shape: string[];
	slots: Attr[];
	values: string[];
}

const mounted = new WeakMap<Element, Mounted>();

function flattenTree(node: SvgNode, shape: string[], values: string[]): void {
	shape.push(node.tag);
	for (const [name, value] of Object.entries(node.attrs)) {
		shape.push(name);
		values.push(String(value));
	}
	for (const child of node.children) flattenTree(child, shape, values);
	shape.push(END);
}

function build(doc: Document, node: SvgNode): Element {
	const element = doc.createElementNS(SVG_NS, node.tag);
	for (const [name, value] of Object.entries(node.attrs)) element.setAttribute(name, String(value));
	for (const child of node.children) element.append(build(doc, child));
	return element;
}

/** Renders `tree` into `host`, rewriting only changed attribute values when the tree's shape is unchanged. */
export function patch(host: Element, tree: SvgNode): void {
	const shape: string[] = [];
	const values: string[] = [];
	flattenTree(tree, shape, values);
	const previous = mounted.get(host);
	if (previous != null && host.firstChild === previous.root && sameShape(previous.shape, shape)) {
		for (let i = 0; i < values.length; i++) if (values[i] !== previous.values[i]) previous.slots[i]!.value = values[i]!;
		previous.values = values;
		return;
	}
	const root = build(host.ownerDocument, tree);
	host.replaceChildren(root);
	const slots = [root, ...root.querySelectorAll("*")].flatMap((e) => [...e.attributes]);
	mounted.set(host, { root, shape, slots, values });
}

const sameShape = (a: string[], b: string[]): boolean => a.length === b.length && a.every((v, i) => v === b[i]);
