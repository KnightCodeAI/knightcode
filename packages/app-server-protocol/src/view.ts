/**
 * Declarative views (apps/desktop/docs/desktop-app/architecture.md §8.2): data an extension hands to a widget, a tool
 * result or an extension message, drawn by every client with its own components. Never HTML, scripts or URLs that
 * load. `checkView` is the one definition of an acceptable view; the server and the terminal both use it.
 */

import { type Static, type TSchema, Type } from "typebox";
import { Compile } from "typebox/compile";

// Its own two-line helper: importing protocol.ts here would make the two modules import each other.
const Obj = <P extends Record<string, TSchema>>(properties: P) =>
	Type.Object(properties, { additionalProperties: false });
const Id = Type.String({ minLength: 1, maxLength: 128 });
const Tone = Type.Union([
	Type.Literal("muted"),
	Type.Literal("accent"),
	Type.Literal("success"),
	Type.Literal("warning"),
	Type.Literal("error"),
]);

export const View = Type.Cyclic(
	{
		View: Type.Union([
			Obj({ type: Type.Literal("text"), text: Type.String(), tone: Type.Optional(Tone) }),
			Obj({ type: Type.Literal("markdown"), markdown: Type.String() }),
			Obj({
				type: Type.Literal("stack"),
				direction: Type.Optional(Type.Union([Type.Literal("vertical"), Type.Literal("horizontal")])),
				children: Type.Array(Type.Ref("View")),
			}),
			Obj({ type: Type.Literal("list"), items: Type.Array(Type.Ref("View")) }),
			Obj({
				type: Type.Literal("table"),
				columns: Type.Array(Type.String(), { minItems: 1 }),
				rows: Type.Array(Type.Array(Type.String())),
			}),
			Obj({
				type: Type.Literal("progress"),
				value: Type.Number({ minimum: 0 }),
				max: Type.Number({ exclusiveMinimum: 0 }),
				label: Type.Optional(Type.String()),
			}),
			Obj({ type: Type.Literal("button"), id: Id, label: Type.String() }),
			Obj({
				type: Type.Literal("field"),
				id: Id,
				kind: Type.Union([Type.Literal("text"), Type.Literal("toggle"), Type.Literal("select")]),
				label: Type.String(),
				value: Type.Union([Type.String(), Type.Boolean()]),
				options: Type.Optional(Type.Array(Type.String(), { minItems: 1 })),
			}),
		]),
	},
	"View",
);
export type View = Static<typeof View>;

/** Serialized UTF-8 bytes of a view in a tool result or an extension message: the inline item limit (§5.9). */
export const VIEW_MAX_BYTES = 65_536;
/** A widget's lines or view. With at most 16 widgets, a thread's `ui` stays far inside a 1 MiB resume page. */
export const WIDGET_MAX_BYTES = 16_384;
/** Nesting of stacks and lists, counting the outermost view as 1. */
export const VIEW_MAX_DEPTH = 8;

const validator = Compile(View);

/** Deeper than VIEW_MAX_DEPTH. Bounded recursion: it stops one level past the limit. */
function tooDeep(value: unknown, level: number): boolean {
	if (level > VIEW_MAX_DEPTH) return true;
	if (typeof value !== "object" || value === null) return false;
	const { children, items } = value as { children?: unknown; items?: unknown };
	for (const nested of [children, items]) {
		if (Array.isArray(nested) && nested.some((child) => tooDeep(child, level + 1))) return true;
	}
	return false;
}

/** The rules the schema cannot say: unique control ids, table shape, a field's value against its kind and options. */
function ruleError(view: View, ids: Set<string>): string | undefined {
	switch (view.type) {
		case "stack":
		case "list":
			for (const child of view.type === "stack" ? view.children : view.items) {
				const error = ruleError(child, ids);
				if (error) return error;
			}
			return undefined;
		case "table": {
			const row = view.rows.find((cells) => cells.length !== view.columns.length);
			return row ? `a table row has ${row.length} cells for ${view.columns.length} columns` : undefined;
		}
		case "button":
		case "field": {
			if (ids.has(view.id)) return `the control id "${view.id}" is used twice`;
			ids.add(view.id);
			if (view.type === "button") return undefined;
			if (view.kind === "toggle") {
				if (typeof view.value !== "boolean") return `the toggle "${view.id}" needs a boolean value`;
			} else if (typeof view.value !== "string") {
				return `the ${view.kind} field "${view.id}" needs a string value`;
			}
			if (view.kind !== "select") {
				return view.options ? `the ${view.kind} field "${view.id}" cannot have options` : undefined;
			}
			if (!view.options) return `the select "${view.id}" needs options`;
			return view.options.includes(view.value as string)
				? undefined
				: `the select "${view.id}" value is not one of its options`;
		}
		default:
			return undefined;
	}
}

/** A copy of `value`, made through JSON and checked against every rule, or why it was refused. Never throws. */
export function checkView(value: unknown, maxBytes = VIEW_MAX_BYTES): { view: View } | { error: string } {
	let json: string | undefined;
	try {
		json = JSON.stringify(value);
	} catch (error) {
		return { error: `the view has no JSON form: ${error instanceof Error ? error.message : String(error)}` };
	}
	if (typeof json !== "string") return { error: "the view has no JSON form" };
	const bytes = new TextEncoder().encode(json).length;
	if (bytes > maxBytes) return { error: `the view is ${bytes} bytes, over ${maxBytes} bytes` };
	const copy: unknown = JSON.parse(json);
	if (tooDeep(copy, 1)) return { error: `the view nests more than ${VIEW_MAX_DEPTH} levels of stacks and lists` };
	if (!validator.Check(copy)) {
		const [first] = validator.Errors(copy);
		return { error: `not a valid view${first ? ` at "${first.instancePath || "/"}": ${first.message}` : ""}` };
	}
	const error = ruleError(copy, new Set());
	return error ? { error } : { view: copy };
}
