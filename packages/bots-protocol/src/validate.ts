// Checks wire values against TypeBox schemas. Never compiles with eval: the Worker forbids it.
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";

/** A value that does not match its contract; `path` is a JSON Pointer to the offending field. */
export class ProtocolError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(path ? `${path}: ${message}` : message);
		this.name = "ProtocolError";
		this.path = path;
	}
}

/** Returns `value` typed by `schema`, or throws a `ProtocolError` naming the first bad field. */
export function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
	if (Value.Check(schema, value)) return value as Static<S>;
	const errors = Value.Errors(schema, value);
	// Union failures report every branch; the deepest non-structural error names the real field.
	const best =
		[...errors]
			.filter((e) => e.keyword !== "anyOf" && e.keyword !== "boolean")
			.sort((a, b) => b.instancePath.length - a.instancePath.length)[0] ?? errors[0];
	throw new ProtocolError(best?.instancePath ?? "", best?.message ?? "invalid value");
}
