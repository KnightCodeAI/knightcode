/** Native-kind consent and candidate artifact discovery, held outside repository-writable settings. */
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import {
	DesktopEntryKinds,
	type DesktopExtensionDiagnostic,
	type DesktopExtensionInfo,
	type ParamsOf,
	type ResultOf,
} from "@knightcode/app-server-protocol";
import { type Static, Type } from "typebox";
import { Compile } from "typebox/compile";
import { DefaultPackageManager } from "../../core/package-manager.ts";
import { SettingsManager } from "../../core/settings-manager.ts";
import { getPathComparisonKey } from "../../utils/paths.ts";
import { projectReadable } from "../workspaces.ts";
import {
	desktopIncompatibility,
	readDesktopManifest,
	stageDesktopRevision,
	type DesktopArtifact,
} from "./artifacts.ts";

const Consent = Type.Object(
	{
		source: Type.String(),
		kinds: Type.Array(DesktopEntryKinds.items, { maxItems: 2, uniqueItems: true }),
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
type Source = {
	owner: string;
	source: string;
	scope: "user" | "project";
	project?: string;
	kinds?: Static<typeof DesktopEntryKinds>;
	error?: string;
};

export class DesktopExtensionManager {
	private readonly agent: string;
	private readonly safeMode: boolean;
	private readonly appVersion: string | undefined;
	private readonly diagnostics = new Map<string, DesktopExtensionDiagnostic[]>();
	/** `appVersion` is the running desktop's; without it (CLI validation) only the declared range's syntax is checked. */
	constructor(agentDir: string, options: { safeMode?: boolean; appVersion?: string } = {}) {
		this.agent = agentDir;
		this.safeMode = options.safeMode ?? false;
		this.appVersion = options.appVersion;
	}

	async list(cwd?: string): Promise<ResultOf<"desktopExtension/list">> {
		return (await this.inventory(cwd)).snapshot;
	}

	/** The user's preview switch, kept in the agent directory beside consent; never in repository settings. */
	preview(): boolean {
		const file = join(this.agent, "desktop-extension-preview.json");
		if (!existsSync(file)) return false;
		let value: unknown;
		try {
			value = JSON.parse(readFileSync(file, "utf8"));
		} catch {
			return false;
		}
		// Filesystem boundary: anything but an explicit opt-in, including a corrupt file, leaves external code off.
		return !!value && typeof value === "object" && "enabled" in value && value.enabled === true;
	}

	setPreview(enabled: boolean): void {
		mkdirSync(this.agent, { recursive: true });
		const target = join(this.agent, "desktop-extension-preview.json");
		const temporary = `${target}.${randomUUID()}.tmp`;
		writeFileSync(temporary, JSON.stringify({ enabled }), { mode: 0o600 });
		renameSync(temporary, target);
	}

	private async inventory(cwd?: string) {
		const consents = this.readConsents();
		// Off works like safe mode for execution, but keeps the inventory and consent visible for management.
		const preview = this.preview();
		const runs = preview && !this.safeMode;
		const extensions: DesktopExtensionInfo[] = [];
		const candidates = new Map<string, DesktopArtifact>();
		const enabled = new Set<string>();
		for (const entry of this.discover(consents, cwd)) {
			const record = consents[entry.owner];
			const approved =
				record?.source === entry.source &&
				!!entry.kinds?.length &&
				entry.kinds.every((kind) => record.kinds.includes(kind));
			if (runs && record?.enabled && record.source === entry.source && (approved || entry.error))
				enabled.add(entry.owner);
			const info: DesktopExtensionInfo = {
				owner: entry.owner,
				name: basename(entry.source),
				source: entry.source,
				scope: entry.scope,
				...(entry.kinds ? { kinds: entry.kinds } : {}),
				approved,
				enabled: approved && record.enabled,
				dev: approved && record.dev,
				diagnostics: this.diagnostics.get(entry.owner) ?? [],
			};
			if (entry.error) info.error = entry.error;
			else if (approved && record.enabled && runs) {
				try {
					const artifact = await stageDesktopRevision(entry.source, join(this.agent, "desktop-artifacts"), entry.owner);
					info.revision = artifact.revision;
					info.kinds = artifact.kinds;
					if (!artifact.kinds.every((kind) => record.kinds.includes(kind))) {
						info.approved = info.enabled = info.dev = false;
						info.error = "Native entry kinds changed. Review and grant native consent again.";
					} else if (!record.dev && artifact.revision !== record.revision)
						info.error =
							"Source changed. Review and grant native consent again, or explicitly allow development reloads.";
					else {
						candidates.set(entry.owner, artifact);
						info.artifact = artifact;
					}
				} catch (error) {
					info.error = error instanceof Error ? error.message : String(error);
				}
			}
			extensions.push(info);
		}
		return {
			snapshot: { safeMode: this.safeMode, preview, extensions },
			artifacts: [...candidates.values()],
			enabled,
		};
	}

	/** Coordinator-only candidates recheck consent/trust/safe mode without publishing private server files. */
	async candidates(cwd?: string) {
		const { artifacts, enabled } = await this.inventory(cwd);
		return { artifacts, enabled };
	}

	/** Native consent can change while another window stages; executable admission rechecks the receipt. */
	admits(artifact: DesktopArtifact): boolean {
		const record = this.readConsents()[artifact.owner];
		return (
			!this.safeMode &&
			this.preview() &&
			!!record?.enabled &&
			artifact.kinds.every((kind) => record.kinds.includes(kind)) &&
			(record.dev || record.revision === artifact.revision) &&
			(!record.project || projectReadable(this.agent, record.project))
		);
	}

	async set(params: ParamsOf<"desktopExtension/set">): Promise<void> {
		const entry = this.discover(this.readConsents(), params.cwd).find((item) => item.owner === params.owner);
		if (!entry) throw new Error("Desktop extension is no longer configured or its project is not trusted.");
		if (params.kinds && !params.approve)
			throw new Error("Entry kinds are only accepted with explicit native approval.");
		if (params.revoke && (params.approve || params.enabled || params.dev))
			throw new Error("Revoking consent cannot also enable or approve an extension.");
		let artifact;
		if (params.approve) {
			if (params.source !== entry.source) throw new Error("Desktop extension source changed; review its source again.");
			if (entry.error) throw new Error(entry.error);
			artifact = await stageDesktopRevision(entry.source, join(this.agent, "desktop-artifacts"), entry.owner);
			if (
				!params.kinds ||
				params.kinds.length !== artifact.kinds.length ||
				!artifact.kinds.every((kind) => params.kinds!.includes(kind))
			)
				throw new Error("Native entry kinds changed or were not reviewed. Review and grant native consent again.");
		}
		const records = this.readConsents();
		const previous = records[entry.owner];
		if (
			!params.approve &&
			!params.revoke &&
			(!previous ||
				previous.source !== entry.source ||
				!entry.kinds?.length ||
				!entry.kinds.every((kind) => previous.kinds.includes(kind)))
		)
			throw new Error("Native entry-kind consent is required before enabling this extension.");
		if (params.dev && !params.approve) throw new Error("Development reloads require explicit native consent.");
		if (params.revoke) delete records[entry.owner];
		else
			records[entry.owner] = {
				source: entry.source,
				kinds: artifact?.kinds ?? previous!.kinds,
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
				const manifest = readDesktopManifest(source);
				if (!manifest) return;
				const incompatible = desktopIncompatibility(manifest, this.appVersion);
				if (incompatible) throw new Error(incompatible);
				const kinds: Static<typeof DesktopEntryKinds> = [
					...(manifest.frontend ? ["frontend" as const] : []),
					...(manifest.backend ? ["backend" as const] : []),
				];
				roots.set(key, { owner, source, scope, kinds, ...(project ? { project } : {}) });
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
