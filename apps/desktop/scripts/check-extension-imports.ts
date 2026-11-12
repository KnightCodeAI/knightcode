/** Enforce the public import boundary for built-ins and desktop extension examples. */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";
import { traverseFast } from "@babel/types";

const ALLOWED = new Set([
	"@knightcodeai/cli/desktop",
	"@knightcodeai/cli/desktop/testing",
	"react",
	"react-dom",
	"react/jsx-runtime",
	"radix-ui",
	"@pierre/diffs",
	"@pierre/trees",
	"typebox",
]);

export function checkExtensionSource(file: string, source: string, ownerRoot: string): string[] {
	const errors: string[] = [];
	const ast = parse(source, { sourceType: "module", plugins: ["typescript", "jsx"], createImportExpressions: true });
	const check = (name: string) => {
		if (ALLOWED.has(name)) return;
		if (name.startsWith(".")) {
			const path = relative(ownerRoot, resolve(dirname(file), name));
			if (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path)) return;
		}
		errors.push(
			`${file}: unsupported import ${JSON.stringify(name)}; use the desktop SDK or a file inside this extension.`,
		);
	};
	traverseFast(ast, (node) => {
		if (
			(node.type === "ImportDeclaration" ||
				node.type === "ExportNamedDeclaration" ||
				node.type === "ExportAllDeclaration") &&
			node.source
		)
			check(node.source.value);
		if (node.type === "TSImportType" && node.argument.type === "StringLiteral") check(node.argument.value);
		// Inline loading is forbidden by repository policy, including computed names that cannot be audited.
		if (
			node.type === "TSImportEqualsDeclaration" ||
			node.type === "ImportExpression" ||
			(node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "require")
		)
			errors.push(`${file}: inline imports and require are not supported; use a top-level SDK import.`);
	});
	return errors;
}

export function checkExtensionImports(repo = resolve(dirname(fileURLToPath(import.meta.url)), "../../..")): string[] {
	const errors: string[] = [];
	const walk = (directory: string, owner: string): void => {
		for (const entry of readdirSync(directory, { withFileTypes: true })) {
			const file = resolve(directory, entry.name);
			if (entry.isSymbolicLink()) errors.push(`${file}: symlinks are not supported inside extension source.`);
			else if (entry.isDirectory()) walk(file, owner);
			else if (/\.[cm]?[jt]sx?$/.test(entry.name))
				errors.push(...checkExtensionSource(file, readFileSync(file, "utf8"), owner));
		}
	};
	for (const directory of [
		"apps/desktop/src/renderer/builtins",
		"examples/desktop-extensions",
		"packages/cli/examples/desktop-extensions",
	]) {
		const root = resolve(repo, directory);
		if (!existsSync(root)) continue;
		for (const entry of readdirSync(root, { withFileTypes: true })) {
			const file = resolve(root, entry.name);
			if (entry.isDirectory()) walk(file, file);
			else if (entry.isSymbolicLink()) errors.push(`${file}: symlinks are not supported inside extension source.`);
			else if (/\.[cm]?[jt]sx?$/.test(entry.name))
				// A root-level file is a standalone extension, not a shared owner for its neighbours.
				errors.push(...checkExtensionSource(file, readFileSync(file, "utf8"), file));
		}
	}
	return errors;
}

if (import.meta.main) {
	const errors = checkExtensionImports();
	for (const error of errors) console.error(error);
	if (errors.length) process.exitCode = 1;
	else console.log("Desktop extension import audit passed.");
}
