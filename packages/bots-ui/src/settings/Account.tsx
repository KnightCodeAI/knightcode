// Account: who you are (name, email, handle), appearance and time zone, the model new bots start with, AI providers,
// sign-in methods and passkeys, and your data (export, delete).
import { Copy, KeyRound, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { modelKey, useModels } from "../bot/ModelPicker.tsx";
import { Button } from "../primitives/Button.tsx";
import { Dialog } from "../primitives/Dialog.tsx";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { useToast } from "../primitives/Toast.tsx";
import { navigate } from "../shell/routes.ts";
import { useResource, useStore } from "../state/store.ts";
import { getThemePreference, setThemePreference, type ThemePreference } from "../theme.ts";
import { PlanCard } from "../usage/Usage.tsx";
import { formatDay } from "../chat/layout.ts";
import { usePlatform } from "../platform.ts";
import { signOut } from "../shell/signOut.ts";
import { ConnectProviders } from "./ConnectProviders.tsx";
import { DevicePush } from "./DevicePush.tsx";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

const ZONES = [
	"UTC",
	"America/New_York",
	"America/Chicago",
	"America/Los_Angeles",
	"Europe/London",
	"Europe/Berlin",
	"Asia/Kolkata",
	"Asia/Singapore",
	"Asia/Tokyo",
	"Australia/Sydney",
];

/** The account page. */
export function Account() {
	const store = useStore();
	const toast = useToast();
	const { data: account } = useResource("account", (api) => api.getAccount({}));
	const { data: signIn } = useResource("sign-in", (api) => api.listSignInMethods({}));
	const models = useModels();
	const [name, setName] = useState("");
	const [theme, setTheme] = useState<ThemePreference>(getThemePreference);
	const [deleting, setDeleting] = useState(false);
	const web = usePlatform() === "web";
	useEffect(() => setName(account?.name ?? ""), [account?.name]);
	const update = (patch: Parameters<typeof store.api.updateAccount>[0]) =>
		void store.api.updateAccount(patch).then(() => store.reload("account"));
	const zone = account?.timeZone ?? "UTC";
	const zones = ZONES.includes(zone) ? ZONES : [zone, ...ZONES];
	const exportData = async () => {
		const { fileId } = await store.api.exportAccount({});
		const { url } = await store.api.getFile({ id: fileId });
		window.open(url, "_blank", "noopener");
	};
	const addPasskey = async () => {
		const { options } = await store.api.beginPasskey({});
		const credential = await navigator.credentials
			?.create({ publicKey: options as PublicKeyCredentialCreationOptions })
			.catch(() => null);
		if (!credential) return toast({ text: "Passkey not added." });
		await store.api.addPasskey({ name: "This device", response: credential });
		store.reload("sign-in");
	};
	return (
		<>
			<PlanCard />
			<SettingsSection title="Account">
				<SettingsCard>
					<div className="kb-account-card">
						<span className="kb-account-card__avatar" aria-hidden>
							{(account?.name || account?.email || "?").slice(0, 1).toUpperCase()}
						</span>
						<div className="kb-account-card__body">
							<input
								className="kb-account-card__name"
								aria-label="Your name"
								placeholder="Enter your name"
								value={name}
								onChange={(e) => setName(e.target.value)}
								onBlur={() => name.trim() !== (account?.name ?? "") && update({ name: name.trim() })}
							/>
							<span className="kb-account-card__meta">
								{account?.email}
								{account?.handle && ` · ${account.handle}`}
								{account?.email && (
									<button
										type="button"
										className="kb-hover-actions__button"
										aria-label="Copy email address"
										onClick={() => void navigator.clipboard?.writeText(account.email!)}
									>
										<Copy size={13} />
									</button>
								)}
							</span>
						</div>
						<div className="kb-account-card__actions">
							<Button variant="secondary" onClick={() => void exportData()}>
								Export data
							</Button>
							{web && (
								<Button variant="secondary" onClick={() => void signOut()}>
									Sign Out
								</Button>
							)}
						</div>
					</div>
				</SettingsCard>
			</SettingsSection>
			<SettingsSection title="Appearance">
				<SettingsCard>
					{web && (
						<SettingsRow
							first
							title="Theme"
							control={
								<Select
									label="Theme"
									value={theme}
									onValueChange={(next) => {
										setTheme(next as ThemePreference);
										setThemePreference(next as ThemePreference);
									}}
									options={[
										{ value: "system", label: "System" },
										{ value: "light", label: "Light" },
										{ value: "dark", label: "Dark" },
									]}
								/>
							}
						/>
					)}
					<SettingsRow
						title="Time zone"
						control={
							<Select
								label="Time zone"
								value={zone}
								options={zones.map((z) => ({ value: z, label: z.replace(/_/g, " ") }))}
								onValueChange={(timeZone) => update({ timeZone })}
							/>
						}
					/>
					<SettingsRow
						title="Model for new bots"
						hint="KnightCode never picks one for you."
						control={
							models.length > 0 ? (
								<Select
									label="Model for new bots"
									value={account?.defaultModel ? modelKey(account.defaultModel) : " "}
									options={[
										...(account?.defaultModel ? [] : [{ value: " ", label: "Choose" }]),
										...models.map((m) => ({ value: modelKey(m), label: m.name })),
									]}
									onValueChange={(key) => {
										const picked = models.find((m) => modelKey(m) === key);
										if (picked) update({ defaultModel: { provider: picked.provider, modelId: picked.modelId } });
									}}
								/>
							) : undefined
						}
					/>
				</SettingsCard>
			</SettingsSection>
			<ConnectProviders />
			<SettingsSection title="Sign-in">
				<SettingsCard>
					{(signIn?.methods ?? []).map((method) => (
						<SettingsRow
							key={method.kind + method.label}
							title={method.label}
							hint={method.kind === "email" ? "One-time email code" : undefined}
						/>
					))}
					{(signIn?.passkeys ?? []).map((passkey) => (
						<SettingsRow
							key={passkey.id}
							title={
								<span className="kb-set-inline">
									<KeyRound size={14} /> {passkey.name}
								</span>
							}
							hint={`Added ${formatDay(passkey.createdAt)}${passkey.lastUsedAt ? ` · last used ${formatDay(passkey.lastUsedAt)}` : ""}`}
							control={
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Remove ${passkey.name}`}
									onClick={() => void store.api.deletePasskey({ id: passkey.id }).then(() => store.reload("sign-in"))}
								>
									<Trash2 size={14} />
								</button>
							}
						/>
					))}
					<SettingsRow
						title="Passkeys"
						hint="Sign in, and confirm spending, with your device."
						control={
							<Button variant="subtle" size="sm" onClick={() => void addPasskey()}>
								Add a passkey
							</Button>
						}
					/>
				</SettingsCard>
			</SettingsSection>
			<DevicePush />
			<SettingsSection title="Your data">
				<SettingsCard>
					<SettingsRow
						title="Export everything"
						hint="Your bots, chats, memory, pages and files, as one archive."
						control={
							<Button variant="subtle" size="sm" onClick={() => void exportData()}>
								Export
							</Button>
						}
					/>
					<SettingsRow
						title="Delete account"
						hint="Deletes your bots, their computer and everything they made. This cannot be undone."
						control={
							<Button variant="subtle" size="sm" onClick={() => setDeleting(true)}>
								Delete
							</Button>
						}
					/>
				</SettingsCard>
			</SettingsSection>
			{deleting && <DeleteAccount email={account?.email ?? ""} onClose={() => setDeleting(false)} />}
		</>
	);
}

/** Typing the email confirms deletion. */
function DeleteAccount({ email, onClose }: { email: string; onClose: () => void }) {
	const store = useStore();
	const [confirm, setConfirm] = useState("");
	return (
		<Dialog
			open
			onOpenChange={(open) => !open && onClose()}
			title="Delete your account?"
			width={440}
			footer={
				<>
					<Button variant="secondary" onClick={onClose}>
						Cancel
					</Button>
					<Button
						variant="primary"
						disabled={confirm !== email}
						onClick={() => void store.api.deleteAccount({ confirm }).then(() => navigate("/"))}
					>
						Delete everything
					</Button>
				</>
			}
		>
			<div className="kb-dialog__body kb-settings">
				<p className="kb-dialog__text">
					Type {email} to confirm. Your bots, their computer, chats, memory, pages and files are deleted.
				</p>
				<Input aria-label="Confirm email" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
			</div>
		</Dialog>
	);
}
