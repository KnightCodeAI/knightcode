/** Native consent and frontend artifact discovery, held outside repository-writable settings. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import type {
	DesktopExtensionDiagnostic,
	DesktopExtensionInfo,
	ParamsOf,
	ResultOf,
} from "@knightcode/app-server-protocol";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { getPathComparisonKey } from "../../utils/paths.ts";
import { projectReadable } from "../workspaces.ts";
import { readDesktopManifest, stageDesktopExtension } from "./artifacts.ts";

const Consent = Type.Object(
	{
		source: Type.String(),
		kinds: Type.Array(Type.Literal("frontend")),
		revision: Type.String(),
		enabled: Type.Boolean(),
		dev: Type.Boolean(),
		project: Type.Optional(Type.String()),
	},
	{ additionalProperties: false },
);
const Consents = Type.Record(Type.String(), Consent);
const checkConsents = Compile(Consents);
type Consents = Static<typeof Consents>;
type Source = { owner: string; source: string; scope: "user" | "project"; project?: string; error?: string };

export class DesktopExtensionManager {
	private readonly agent: string;
	private readonly safeMode: boolean;
	private readonly diagnostics = new Map<string, DesktopExtensionDiagnostic[]>();
	constructor(agentDir: string, options: { safeMode?: boolean } = {}) {
		this.agent = agentDir;
		this.safeMode = options.safeMode ?? false;
	}

	async list(cwd?: string): Promise<ResultOf<"desktopExtension/list">> {
		const consents = this.readConsents();
		const extensions: DesktopExtensionInfo[] = [];
		for (const entry of this.discover(consents, cwd)) {
			const record = consents[entry.owner];
			const approved = record?.source === entry.source && record.kinds.includes("frontend");
			const info: DesktopExtensionInfo = {
				owner: entry.owner,
				name: basename(entry.source),
				source: entry.source,
				scope: entry.scope,
				approved,
				enabled: approved && record.enabled,
				dev: approved && record.dev,
				diagnostics: this.diagnostics.get(entry.owner) ?? [],
			};
			if (entry.error) info.error = entry.error;
			else if (approved && record.enabled && !this.safeMode) {
				try {
					const artifact = await stageDesktopExtension(
						entry.source,
						join(this.agent, "desktop-artifacts"),
						entry.owner,
					);
					info.revision = artifact.revision;
					if (!record.dev && artifact.revision !== record.revision)
						info.error =
							"Source changed. Review and grant native consent again, or explicitly allow development reloads.";
					else info.artifact = artifact;
				} catch (error) {
					info.error = error instanceof Error ? error.message : String(error);
				}
			}
			extensions.push(info);
		}
		return { safeMode: this.safeMode, extensions };
	}

	async set(params: ParamsOf<"desktopExtension/set">): Promise<void> {
		const entry = this.discover(this.readConsents(), params.cwd).find((item) => item.owner === params.owner);
		if (!entry) throw new Error("Desktop extension is no longer configured or its project is not trusted.");
		if (params.revoke && (params.approve || params.enabled || params.dev))
			throw new Error("Revoking consent cannot also enable or approve an extension.");
		let artifact;
		if (params.approve) {
			if (params.source !== entry.source) throw new Error("Desktop extension source changed; review its source again.");
			if (entry.error) throw new Error(entry.error);
			artifact = await stageDesktopExtension(entry.source, join(this.agent, "desktop-artifacts"), entry.owner);
		}
		const records = this.readConsents();
		const previous = records[entry.owner];
		if (
			!params.approve &&
			!params.revoke &&
			(!previous || previous.source !== entry.source || !previous.kinds.includes("frontend"))
		)
			throw new Error("Native frontend consent is required before enabling this extension.");
		if (params.dev && !params.approve) throw new Error("Development reloads require explicit native consent.");
		if (params.revoke) delete records[entry.owner];
		else
			records[entry.owner] = {
				source: entry.source,
				kinds: ["frontend"],
				revision: artifact?.revision ?? previous!.revision,
				enabled: params.enabled ?? previous?.enabled ?? true,
				dev: params.approve ? (params.dev ?? false) : previous!.dev,
				...(entry.project ? { project: entry.project } : {}),
			};
		mkdirSync(this.agent, { recursive: true });
		const target = join(this.agent, "desktop-extension-consent.json");
		const temporary = `${target}.${randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify(records, null, 2), { mode: 0o600 });
		renameSync(temporary, target);
	}

	report(owner: string, diagnostic: DesktopExtensionDiagnostic): void {
		// Diagnostics are a bounded wire-input history, not a source of executable registrations.
		const entries = this.diagnostics.get(owner) ?? [];
		this.diagnostics.set(
			owner,
			[...entries.filter((entry) => entry.windowId !== diagnostic.windowId), diagnostic].slice(-32),
		);
	}

	private readConsents(): Consents {
		const file = join(this.agent, "desktop-extension-consent.json");
		if (!existsSync(file)) return {};
		const value: unknown = JSON.parse(readFileSync(file, "utf8"));
		if (!checkConsents.Check(value))
			throw new Error("Invalid desktop native consent file; restore it through native recovery.");
		return value;
	}

	private discover(consents: Consents, cwd?: string): Source[] {
		const roots = new Map<string, Source>();
		const add = (path: string, scope: "user" | "project", project?: string) => {
			if (!existsSync(join(path, "package.json"))) return;
			const source = realpathSync(path);
			const key = getPathComparisonKey(source);
			if (roots.has(key)) return;
			const owner = `external-${createHash("sha256").update(key).digest("hex").slice(0, 24)}`;
			try {
				if (!readDesktopManifest(source)) return;
				roots.set(key, { owner, source, scope, ...(project ? { project } : {}) });
			} catch (error) {
				roots.set(key, {
					owner,
					source,
					scope,
					...(project ? { project } : {}),
					error: error instanceof Error ? error.message : String(error),
				});
			}
		};
		const local = join(this.agent, "desktop-extensions");
		if (existsSync(local))
			for (const entry of readdirSync(local, { withFileTypes: true }))
				if (entry.isDirectory()) add(join(local, entry.name), "user");
		const projects = new Set([
			...(cwd ? [resolve(cwd)] : []),
			...Object.values(consents).flatMap((record) => (record.project ? [record.project] : [])),
		]);
		const loadPackages = (directory: string, scope: "user" | "project") => {
			const settings = SettingsManager.create(directory, this.agent, { projectTrusted: scope === "project" });
			const manager = new DefaultPackageManager({ cwd: directory, agentDir: this.agent, settingsManager: settings });
			const packages = (scope === "user" ? settings.getGlobalSettings() : settings.getProjectSettings()).packages ?? [];
			for (const declaration of packages) {
				const source = typeof declaration === "string" ? declaration : declaration.source;
				const path = manager.getInstalledPath(source, scope);
				if (path) add(path, scope, scope === "project" ? directory : undefined);
			}
		};
		loadPackages(this.agent, "user");
		for (const project of projects)
			if (existsSync(project) && projectReadable(this.agent, project)) loadPackages(project, "project");
		return [...roots.values()].sort((a, b) => a.owner.localeCompare(b.owner));
	}
}
