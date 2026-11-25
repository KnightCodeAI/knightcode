/** Generate the published API reference and portable declarations from the desktop SDK. */
import { parse } from "@babel/parser";
import type { Identifier } from "@babel/types";

export interface DesktopApiPublication {
	apiVersion: number;
	inventory: string;
	declarations: string;
	surfaces: string[];
}

/** Generate declarations without importing or executing the renderer SDK. */
export function generateDesktopApi(source: string, entry: "frontend" | "backend" = "frontend"): DesktopApiPublication {
	const sourceName = entry === "backend" ? "desktop-backend.ts" : "desktop.ts";
	const declarationName = entry === "backend" ? "desktop-backend-sdk.d.ts" : "desktop-sdk.d.ts";
	const ast = parse(source, { sourceType: "module", plugins: ["typescript"] });
	const declarations = [`// Generated from src/${sourceName}. Run bun packages/cli/scripts/generate-desktop-api.ts.\n`];
	const entries: string[] = [];
	const surfaces: string[] = [];
	let apiVersion: number | undefined;
	for (const statement of ast.program.body) {
		if (
			statement.type === "ImportDeclaration" ||
			statement.type === "TSModuleDeclaration" ||
			(statement.type === "VariableDeclaration" && statement.declare)
		) {
			declarations.push(
				source
					.slice(statement.start!, statement.end!)
					.replace('"./desktop-backend.ts"', '"./desktop-backend-sdk.d.ts"'),
			);
			continue;
		}
		if (statement.type !== "ExportNamedDeclaration" || !statement.declaration) continue;
		const node = statement.declaration;
		if (node.type === "VariableDeclaration") {
			for (const variable of node.declarations) {
				if (
					variable.id.type !== "Identifier" ||
					variable.init?.type !== "TSAsExpression" ||
					variable.init.expression.type !== "ArrayExpression"
				)
					throw new Error("Add declaration generation for the new SDK constant shape.");
				const values = variable.init.expression.elements.map((value) => {
					if (value?.type !== "StringLiteral") throw new Error("SDK constants must be string tuples.");
					return JSON.stringify(value.value);
				});
				declarations.push(`export declare const ${variable.id.name}: readonly [${values.join(", ")}];`);
				entries.push(variable.id.name);
			}
		} else if (node.type === "FunctionDeclaration" && node.id) {
			if (node.id.name === "defineDesktopExtension") {
				for (const param of node.params) {
					if (param.type !== "AssignmentPattern" || param.right.type !== "ObjectExpression") continue;
					for (const property of param.right.properties) {
						if (
							property.type === "ObjectProperty" &&
							property.key.type === "Identifier" &&
							property.key.name === "apiVersion" &&
							property.value.type === "NumericLiteral"
						)
							apiVersion = property.value.value;
					}
				}
			}
			if (node.id.name === "experimental_defineDesktopBackend") {
				for (const item of node.body?.body ?? []) {
					if (item.type !== "ReturnStatement" || item.argument?.type !== "ObjectExpression") continue;
					for (const property of item.argument.properties)
						if (
							property.type === "ObjectProperty" &&
							property.key.type === "Identifier" &&
							property.key.name === "apiVersion" &&
							property.value.type === "NumericLiteral"
						)
							apiVersion = property.value.value;
				}
			}
			const params = node.params.map((param) => {
				const value = param.type === "AssignmentPattern" ? param.left : param;
				if (value.type !== "Identifier") throw new Error("Add declaration generation for the new SDK parameter shape.");
				const id: Identifier = value;
				return `${id.name}${param.type === "AssignmentPattern" || id.optional ? "?" : ""}${id.typeAnnotation ? source.slice(id.typeAnnotation.start!, id.typeAnnotation.end!) : ""}`;
			});
			declarations.push(
				`export declare function ${node.id.name}${node.typeParameters ? source.slice(node.typeParameters.start!, node.typeParameters.end!) : ""}(${params.join(", ")})${node.returnType ? source.slice(node.returnType.start!, node.returnType.end!) : ""};`,
			);
			entries.push(node.id.name);
		} else if (node.type === "TSInterfaceDeclaration") {
			declarations.push(source.slice(statement.start!, statement.end!));
			entries.push(node.id.name);
			for (const member of node.body.body) {
				if (
					(member.type === "TSPropertySignature" || member.type === "TSMethodSignature") &&
					member.key.type === "Identifier"
				)
					entries.push(`${node.id.name}.${member.key.name}`);
			}
		} else if (node.type === "TSTypeAliasDeclaration") {
			declarations.push(source.slice(statement.start!, statement.end!));
			entries.push(node.id.name);
			if (node.id.name === "experimental_Surface") {
				const types = node.typeAnnotation.type === "TSUnionType" ? node.typeAnnotation.types : [node.typeAnnotation];
				for (const type of types)
					if (type.type === "TSLiteralType" && type.literal.type === "StringLiteral") surfaces.push(type.literal.value);
			}
		} else throw new Error(`Undocumented SDK declaration shape: ${node.type}`);
	}
	if (apiVersion === undefined)
		throw new Error("SDK must declare a literal default apiVersion in defineDesktopExtension.");
	return {
		apiVersion,
		declarations: declarations.join("\n\n") + "\n",
		inventory:
			`# Desktop ${entry === "backend" ? "backend " : ""}API inventory\n\nGenerated from \`src/${sourceName}\`; API version ${apiVersion} (experimental).\nDo not edit by hand. See [the guide](desktop-extensions.md) and\n[portable declarations](${declarationName}) for signatures.\n\n## Surfaces\n\n` +
			surfaces.map((surface) => `- \`${surface}\``).join("\n") +
			"\n\n## Exports and members\n\n" +
			entries.map((entry) => `- \`${entry}\``).join("\n") +
			"\n",
		surfaces,
	};
}

/** Every declared mounting surface must have an explicit guide section, not only a generated row. */
export function checkDesktopDocumentation(api: DesktopApiPublication, guide: string): void {
	for (const surface of api.surfaces)
		if (!guide.includes(`<!-- surface: ${surface} -->`)) throw new Error(`Undocumented desktop surface: ${surface}`);
	if (!new RegExp(`API version ${api.apiVersion}\\b`).test(guide))
		throw new Error(`Guide must document API version ${api.apiVersion}.`);
}
