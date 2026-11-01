// The vault: API credentials, website logins and command variables. Values are write-only: never shown, never returned
// by the API, never given to the model. Items can be renamed only by replacing them.
import type { VaultItem } from "@knightcode/bots-protocol";
import { Plus, Search, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatDay } from "../chat/layout.ts";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { navigate, useQueryParam } from "../shell/routes.ts";
import { useResource, useStore } from "../state/store.ts";
import { OnePassword } from "./OnePassword.tsx";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

const KINDS: { value: VaultItem["kind"] | "all"; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "api", label: "API keys" },
	{ value: "login", label: "Logins" },
	{ value: "env", label: "Variables" },
];

/** The header button; it opens the editor through ?new=1. */
export function NewVaultItem() {
	return (
		<Button
			variant="primary"
			size="sm"
			className="kb-set-header-button"
			onClick={() => navigate("/settings/vault?new=1")}
		>
			New item <Plus size={16} />
		</Button>
	);
}

/** The vault page. */
export function Vault() {
	const store = useStore();
	const { data } = useResource("vault", (api) => api.listVault({}));
	const [kind, setKind] = useState<VaultItem["kind"] | "all">("all");
	const [query, setQuery] = useState("");
	const creating = useQueryParam("new") !== null;
	const items = data?.items ?? [];
	const needle = query.trim().toLowerCase();
	const shown = items.filter(
		(i) =>
			(kind === "all" || i.kind === kind) && (!needle || `${i.name} ${i.origin ?? ""}`.toLowerCase().includes(needle)),
	);
	const count = (k: VaultItem["kind"] | "all") =>
		k === "all" ? items.length : items.filter((i) => i.kind === k).length;
	return (
		<>
			<div className="kb-vault__bar">
				<div className="kb-vault__tabs" role="tablist" aria-label="Item type" data-ref="type-tabs">
					{KINDS.map((k, i) => (
						<button
							key={k.value}
							type="button"
							role="tab"
							aria-selected={kind === k.value}
							className="kb-vault__tab"
							data-ref={
								kind === k.value ? "type-tab-active" : i === 1 || (i === 0 && kind !== "all") ? "type-tab" : undefined
							}
							onClick={() => setKind(k.value)}
						>
							<span className="kb-vault__tab-label">{k.label}</span>
							<span className="kb-vault__tab-count">{count(k.value)}</span>
						</button>
					))}
				</div>
				<label className="kb-vault__search">
					<Search size={14} aria-hidden />
					<input
						type="search"
						aria-label="Search the vault"
						placeholder="Search"
						value={query}
						onChange={(e) => setQuery(e.target.value)}
						data-ref="search"
					/>
				</label>
			</div>
			{shown.length === 0 ? (
				<p className="kb-set-section__hint kb-vault__empty">
					{items.length === 0 ? "Nothing saved yet. Bots ask for a credential when they need one." : "No items match."}
				</p>
			) : (
				<SettingsCard>
					{shown.map((item) => (
						<SettingsRow
							key={item.id}
							title={item.name}
							hint={[KINDS.find((k) => k.value === item.kind)?.label, item.origin, `added ${formatDay(item.createdAt)}`]
								.filter(Boolean)
								.join(" · ")}
							control={
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Delete ${item.name}`}
									onClick={() => void store.api.deleteVault({ id: item.id }).then(() => store.reload("vault"))}
								>
									<Trash2 size={14} />
								</button>
							}
						/>
					))}
				</SettingsCard>
			)}
			<SettingsSection
				title="Command variables"
				hint="Exported to a bot's own shell. The bot's commands can read them."
			>
				<p className="kb-set-section__hint">Add one with New item and the Variable kind.</p>
			</SettingsSection>
			<OnePassword />
			{creating && <VaultEditor onClose={() => navigate("/settings/vault")} />}
		</>
	);
}

/** New item: the value goes in once and is never read back. */
function VaultEditor({ onClose }: { onClose: () => void }) {
	const store = useStore();
	const [kind, setKind] = useState<VaultItem["kind"]>("api");
	const [name, setName] = useState("");
	const [origin, setOrigin] = useState("");
	const [injection, setInjection] = useState<NonNullable<VaultItem["injection"]>>("bearer");
	const [header, setHeader] = useState("");
	const [value, setValue] = useState("");
	const needsOrigin = kind !== "env";
	const valid =
		name.trim() &&
		value &&
		(!needsOrigin || /^https:\/\//.test(origin.trim())) &&
		(kind !== "api" || injection !== "header" || header.trim());
	const save = async () => {
		await store.api.putVault({
			kind,
			name: name.trim(),
			origin: needsOrigin ? origin.trim() : undefined,
			injection: kind === "api" ? injection : undefined,
			header: kind === "api" && injection === "header" ? header.trim() : undefined,
			value,
		});
		setValue("");
		store.reload("vault");
		onClose();
	};
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="New vault item"
			width={480}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button variant="primary" disabled={!valid} onClick={() => void save()}>
						Save
					</Button>
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<Select
					label="Kind"
					value={kind}
					onValueChange={(next) => setKind(next as VaultItem["kind"])}
					options={[
						{ value: "api", label: "API credential" },
						{ value: "login", label: "Website login" },
						{ value: "env", label: "Command variable" },
					]}
				/>
				<Input
					aria-label="Name"
					placeholder={kind === "env" ? "VARIABLE_NAME" : "Name"}
					value={name}
					onChange={(e) => setName(e.target.value)}
				/>
				{needsOrigin && (
					<Input
						aria-label="Origin"
						placeholder="https://api.example.com"
						value={origin}
						onChange={(e) => setOrigin(e.target.value)}
					/>
				)}
				{kind === "api" && (
					<Select
						label="Sent as"
						value={injection}
						onValueChange={(next) => setInjection(next as NonNullable<VaultItem["injection"]>)}
						options={[
							{ value: "bearer", label: "Bearer token" },
							{ value: "header", label: "A named header" },
							{ value: "basic", label: "Basic auth" },
						]}
					/>
				)}
				{kind === "api" && injection === "header" && (
					<Input
						aria-label="Header name"
						placeholder="X-Api-Key"
						value={header}
						onChange={(e) => setHeader(e.target.value)}
					/>
				)}
				<Input
					type="password"
					autoComplete="new-password"
					aria-label="Value"
					placeholder={kind === "login" ? "username:password" : "Value"}
					value={value}
					onChange={(e) => setValue(e.target.value)}
				/>
				<p className="kb-set-row__hint">
					{kind === "env"
						? "The bot's own commands can read this variable."
						: "Sent only to this origin. The value is never shown again, and the bot never sees it."}
				</p>
			</div>
		</Dialog>
	);
}
