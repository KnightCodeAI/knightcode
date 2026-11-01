// Approvals: the mode (Ask by default, Auto review with a reviewer model you choose, or Never ask), the Always allow
// and Block lists of exact tools or sites, and a preview of what happens to an action.
import type { ApprovalSettings, Rule } from "@knightcode/bots-protocol";
import { Plus, X } from "lucide-react";
import { useState } from "react";
import { modelKey, useModels } from "../bot/ModelPicker.tsx";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { Toggle } from "../primitives/Toggle.tsx";
import { useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

/** What happens to `target` (a tool name or a site) under `settings`, in words. */
export function previewAction(settings: Pick<ApprovalSettings, "mode" | "allow" | "block">, target: string): string {
	const value = target.trim();
	if (!value) return "";
	const matches = (rule: Rule) => (rule.kind === "site" ? value.startsWith(rule.value) : value === rule.value);
	if (settings.block.some(matches)) return "Refused: it is on the Block list, in every mode.";
	if (settings.allow.some(matches)) return "Runs without asking: it is on the Always allow list.";
	if (settings.mode === "never")
		return "Runs without asking in runs you start; outside text still asks unless a routine's grant covers it.";
	if (settings.mode === "auto")
		return "The reviewer passes it if it fits what you asked; otherwise, or if unsure, it asks.";
	return "Asks first, since it changes something.";
}

/** The approvals page. */
export function Approvals() {
	const store = useStore();
	const { data } = useResource("approval-settings", (api) => api.getApprovalSettings({}));
	const models = useModels();
	const [preview, setPreview] = useState("");
	const save = (patch: Partial<ApprovalSettings>) =>
		void store.api.updateApprovalSettings(patch).then(() => store.reload("approval-settings"));
	if (!data) return null;
	return (
		<>
			<SettingsSection>
				<SettingsCard>
					<SettingsRow
						first
						title="Auto-Review"
						hint="A reviewer model passes actions that fit your request, else asks."
						control={
							<Toggle
								label="Auto-Review"
								dataRef="toggle"
								checked={data.mode === "auto"}
								onCheckedChange={(on) => save({ mode: on ? "auto" : "ask" })}
							/>
						}
					/>
				</SettingsCard>
			</SettingsSection>
			<RuleList
				title="Always allow"
				hint="These tools and sites run without asking."
				rules={data.allow}
				onChange={(allow) => save({ allow })}
			/>
			<RuleList
				title="Block"
				hint="Refused without a card, in every mode."
				rules={data.block}
				onChange={(block) => save({ block })}
			/>
			<SettingsSection title="More">
				<SettingsCard>
					{data.mode === "auto" && models.length > 0 && (
						<SettingsRow
							title="Reviewer model"
							hint="Asks you whenever it errors or is unsure."
							control={
								<Select
									label="Reviewer model"
									value={data.reviewer ? modelKey(data.reviewer) : " "}
									options={[
										...(data.reviewer ? [] : [{ value: " ", label: "Choose" }]),
										...models.map((m) => ({ value: modelKey(m), label: m.name })),
									]}
									onValueChange={(key) => {
										const m = models.find((x) => modelKey(x) === key);
										if (m) save({ reviewer: { provider: m.provider, modelId: m.modelId } });
									}}
								/>
							}
						/>
					)}
					<SettingsRow
						title="Never ask"
						hint="Runs every action in runs you start. Outside text never gets more than a routine's grant."
						control={
							<Toggle
								label="Never ask"
								checked={data.mode === "never"}
								onCheckedChange={(on) => save({ mode: on ? "never" : "ask" })}
							/>
						}
					/>
				</SettingsCard>
			</SettingsSection>
			<SettingsSection title="Preview" hint="Type a tool or a site to see what would happen.">
				<SettingsCard>
					<div className="kb-set-pad">
						<Input
							aria-label="Tool or site"
							placeholder="github.comment or https://example.com"
							value={preview}
							onChange={(e) => setPreview(e.target.value)}
						/>
						{preview.trim() && (
							<p className="kb-set-row__hint" role="status">
								{previewAction(data, preview)}
							</p>
						)}
					</div>
				</SettingsCard>
			</SettingsSection>
		</>
	);
}

function RuleList({
	title,
	hint,
	rules,
	onChange,
}: {
	title: string;
	hint: string;
	rules: Rule[];
	onChange: (rules: Rule[]) => void;
}) {
	const [adding, setAdding] = useState(false);
	const [value, setValue] = useState("");
	const add = () => {
		const trimmed = value.trim();
		if (!trimmed) return;
		const kind = /^https?:\/\//.test(trimmed) ? "site" : "tool";
		onChange([...rules, { id: `rule-${Date.now()}`, kind, value: trimmed }]);
		setValue("");
		setAdding(false);
	};
	return (
		<SettingsSection
			title={title}
			hint={hint}
			action={
				<Button
					variant="secondary"
					size="sm"
					className="kb-set-add"
					data-ref="add-rule"
					aria-label={`Add rule to ${title}`}
					onClick={() => setAdding(true)}
				>
					<Plus size={12} /> Add Rule
				</Button>
			}
		>
			{(rules.length > 0 || adding) && (
				<SettingsCard>
					{rules.map((rule) => (
						<SettingsRow
							key={rule.id}
							title={rule.value}
							hint={rule.kind === "site" ? "Site" : "Tool"}
							control={
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Remove ${rule.value}`}
									onClick={() => onChange(rules.filter((r) => r.id !== rule.id))}
								>
									<X size={14} />
								</button>
							}
						/>
					))}
					{adding && (
						<form
							className="kb-set-pad kb-set-inline"
							onSubmit={(event) => {
								event.preventDefault();
								add();
							}}
						>
							<Input
								autoFocus
								aria-label={`New ${title} rule`}
								placeholder="A tool name, or a site starting with https://"
								value={value}
								onChange={(e) => setValue(e.target.value)}
							/>
							<Button variant="primary" size="sm" type="submit" disabled={!value.trim()}>
								Add
							</Button>
						</form>
					)}
				</SettingsCard>
			)}
		</SettingsSection>
	);
}
