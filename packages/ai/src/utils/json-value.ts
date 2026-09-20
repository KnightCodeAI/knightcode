/**
 * Find the first part of `value` that JSON cannot carry: a function, a symbol, a
 * bigint, `undefined` inside a container, a non-finite number, or an object with a
 * prototype other than Object (a Date, a Map, a class instance). Returns a dotted
 * path to it, or undefined when the whole value is JSON-compatible.
 */
export function findNonJson(value: unknown, path = "details"): string | undefined {
	if (value === null || typeof value === "string" || typeof value === "boolean") return undefined;
	if (typeof value === "number") return Number.isFinite(value) ? undefined : path;
	if (Array.isArray(value)) {
		for (let i = 0; i < value.length; i++) {
			const found = value[i] === undefined ? `${path}[${i}]` : findNonJson(value[i], `${path}[${i}]`);
			if (found !== undefined) return found;
		}
		return undefined;
	}
	if (typeof value !== "object") return path;
	const prototype = Object.getPrototypeOf(value);
	if (prototype !== Object.prototype && prototype !== null) return path;
	for (const key of Object.keys(value as object)) {
		const child = (value as Record<string, unknown>)[key];
		// An undefined property is dropped by JSON.stringify, which matches an optional field.
		if (child === undefined) continue;
		const found = findNonJson(child, `${path}.${key}`);
		if (found !== undefined) return found;
	}
	return undefined;
}
