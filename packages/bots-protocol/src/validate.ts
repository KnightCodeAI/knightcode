// Checks wire values against TypeBox schemas with @knightcode/schema, which never compiles with eval (the Worker
// forbids it) and reports a tagged union's error inside the branch the tag selects.
import { compile, type JsonSchema, type Validator } from "@knightcode/schema";
import type { Static, TSchema } from "typebox";

/** A value that does not match its contract; `path` is a JSON Pointer to the offending field. */
export class ProtocolError extends Error {
	readonly path: string;

	constructor(path: string, message: string) {
		super(path ? `${path}: ${message}` : message);
		this.name = "ProtocolError";
		this.path = path;
	}
}

const validators = new WeakMap<TSchema, Validator<unknown>>();

/** Returns `value` typed by `schema`, or throws a `ProtocolError` naming the first bad field. */
export function parse<S extends TSchema>(schema: S, value: unknown): Static<S> {
	let validator = validators.get(schema);
	// TypeBox schemas are plain JSON Schema; only their TypeScript types differ.
	if (!validator) validators.set(schema, (validator = compile(schema as unknown as JsonSchema)));
	if (validator.check(value)) return value as Static<S>;
	const unknownTag = unknownDiscriminator(schema, value);
	if (unknownTag)
		throw new ProtocolError(`/${unknownTag.key}`, `unknown ${unknownTag.key} ${JSON.stringify(unknownTag.value)}`);
	// A tagged union's error comes from inside the branch its tag selects (the closest one, when nested unions leave
	// several with that tag, such as a thread frame's bot and group forms).
	const branches = taggedBranches(schema, value);
	if (branches.length > 0) {
		const errors = branches.map((branch) => validatorFor(branch).errors(value)).sort((a, b) => a.length - b.length);
		const [closest] = errors[0] ?? [];
		if (closest) throw new ProtocolError(closest.path, closest.message);
	}
	const [first] = validator.errors(value);
	throw new ProtocolError(first?.path ?? "", first?.message ?? "invalid value");
}

function validatorFor(schema: TSchema): Validator<unknown> {
	let validator = validators.get(schema);
	if (!validator) validators.set(schema, (validator = compile(schema as unknown as JsonSchema)));
	return validator;
}

/** The union's leaf branches whose `type` or `kind` tag is the value's, through nested unions. */
function taggedBranches(schema: TSchema, value: unknown): TSchema[] {
	if (typeof value !== "object" || value === null || !("anyOf" in schema)) return [];
	for (const key of ["type", "kind"]) {
		const tag = (value as Record<string, unknown>)[key];
		if (tag === undefined) continue;
		const matching = leaves(schema).filter((branch) => {
			const field = (branch as { properties?: Record<string, { const?: unknown }> }).properties?.[key];
			return field !== undefined && "const" in field && field.const === tag;
		});
		if (matching.length > 0) return matching;
	}
	return [];
}

function leaves(schema: TSchema): TSchema[] {
	const branches = (schema as { anyOf?: TSchema[] }).anyOf;
	return branches ? branches.flatMap(leaves) : [schema];
}

/** For a union tagged by `type` or `kind`, the tag key when the value's tag matches no branch. */
function unknownDiscriminator(schema: TSchema, value: unknown): { key: string; value: unknown } | undefined {
	if (typeof value !== "object" || value === null || !("anyOf" in schema)) return undefined;
	for (const key of ["type", "kind"]) {
		const tags = branchTags(schema, key);
		const tag = (value as Record<string, unknown>)[key];
		if (tags.size > 0 && !tags.has(tag)) return { key, value: tag };
	}
	return undefined;
}

function branchTags(schema: TSchema, key: string, tags = new Set<unknown>()): Set<unknown> {
	const branches = (schema as { anyOf?: TSchema[] }).anyOf ?? [];
	for (const branch of branches) {
		const tag = (branch as { properties?: Record<string, { const?: unknown }> }).properties?.[key];
		if (tag && "const" in tag) tags.add(tag.const);
		else branchTags(branch, key, tags);
	}
	return tags;
}
