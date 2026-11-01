// Chat apps: Telegram (send a code to the KnightCode Bots Telegram bot), Slack (install, then link DMs to a bot), each
// group conversation's listening mode and rules, and every bot's own email address.
import type { ChannelLink } from "@knightcode/bots-protocol";
import { Copy, Trash2 } from "lucide-react";
import { useState } from "react";
import { formatTime } from "../chat/layout.ts";
import { Button } from "../primitives/Button.tsx";
import { Input } from "../primitives/Input.tsx";
import { Select } from "../primitives/Select.tsx";
import { useBots, useResource, useStore } from "../state/store.ts";
import { SettingsCard, SettingsRow, SettingsSection } from "./parts.tsx";

export function Channels() {
	const store = useStore();
	const { data } = useResource("channels", (api) => api.getChannels({}));
	const { data: bots } = useBots();
	const active = (bots?.bots ?? []).filter((b) => !b.archived);
	const [telegramBot, setTelegramBot] = useState<string>();
	const [code, setCode] = useState<{ code: string; expiresAt: number }>();
	const [dmBot, setDmBot] = useState<string>();
	const refresh = () => store.reload("channels");
	const name = (botId: string) => active.find((b) => b.id === botId)?.name ?? botId;
	const tgBot = telegramBot ?? active[0]?.id;
	const slackBot = dmBot ?? active[0]?.id;
	if (!data) return null;
	return (
		<>
			<SettingsSection title="Email" hint="Each bot has its own address. Renaming keeps the old one delivering.">
				<SettingsCard>
					{data.addresses.map((a) => (
						<SettingsRow
							key={a.botId}
							title={name(a.botId)}
							hint={a.address}
							control={
								<button
									type="button"
									className="kb-hover-actions__button"
									aria-label={`Copy ${a.address}`}
									onClick={() => void navigator.clipboard?.writeText(a.address)}
								>
									<Copy size={14} />
								</button>
							}
						/>
					))}
				</SettingsCard>
			</SettingsSection>
			<SettingsSection
				title="Telegram"
				hint="Pick a bot, then send the code to the KnightCode Bots Telegram bot within 10 minutes."
			>
				<SettingsCard>
					<SettingsRow
						title="Bot"
						control={
							tgBot && (
								<div className="kb-set-inline">
									<Select
										label="Telegram bot"
										value={tgBot}
										onValueChange={(v) => (setTelegramBot(v), setCode(undefined))}
										options={active.map((b) => ({ value: b.id, label: b.name }))}
									/>
									<Button
										variant="subtle"
										size="sm"
										onClick={() => void store.api.createTelegramCode({ botId: tgBot }).then(setCode)}
									>
										Get code
									</Button>
								</div>
							)
						}
					/>
					{code && (
						<div className="kb-set-pad">
							<span className="kb-code-chip">{code.code}</span>
							<span className="kb-set-row__hint">Valid until {formatTime(code.expiresAt)}.</span>
						</div>
					)}
				</SettingsCard>
			</SettingsSection>
			<SettingsSection title="Slack">
				<SettingsCard>
					<SettingsRow
						title={data.slackInstalled ? "Installed in your workspace" : "Not installed"}
						control={
							<Button
								variant="subtle"
								size="sm"
								onClick={() => void store.api.slackInstall({}).then((r) => window.open(r.url, "_blank", "noopener"))}
							>
								{data.slackInstalled ? "Reinstall" : "Add to Slack"}
							</Button>
						}
					/>
					{data.slackInstalled && slackBot && (
						<SettingsRow
							title="Direct messages go to"
							control={
								<div className="kb-set-inline">
									<Select
										label="Slack DMs bot"
										value={slackBot}
										onValueChange={setDmBot}
										options={active.map((b) => ({ value: b.id, label: b.name }))}
									/>
									<Button
										variant="subtle"
										size="sm"
										onClick={() => void store.api.linkSlackDms({ botId: slackBot }).then(refresh)}
									>
										Link DMs
									</Button>
								</div>
							}
						/>
					)}
				</SettingsCard>
			</SettingsSection>
			{data.links.length > 0 && (
				<SettingsSection title="Linked conversations">
					<SettingsCard>
						{data.links.map((link) => (
							<LinkRow key={link.id} link={link} botName={name(link.botId)} onChange={refresh} />
						))}
					</SettingsCard>
				</SettingsSection>
			)}
		</>
	);
}

function LinkRow({ link, botName, onChange }: { link: ChannelLink; botName: string; onChange: () => void }) {
	const store = useStore();
	const [rules, setRules] = useState(link.rules ?? "");
	const channel = link.channel === "telegram" ? "Telegram" : link.channel === "slack" ? "Slack" : "Email";
	return (
		<div className="kb-set-pad kb-link-row">
			<SettingsRow
				title={`${channel} · ${link.label}`}
				hint={`To ${botName}`}
				control={
					<div className="kb-set-inline">
						{link.mode && (
							<Select
								label={`${link.label} mode`}
								value={link.mode}
								onValueChange={(mode) =>
									void store.api.updateChannelLink({ id: link.id, mode: mode as ChannelLink["mode"] }).then(onChange)
								}
								options={[
									{ value: "mentions", label: "Mentions only" },
									{ value: "listen", label: "Listen" },
								]}
							/>
						)}
						<button
							type="button"
							className="kb-hover-actions__button"
							aria-label={`Remove ${link.label}`}
							onClick={() => void store.api.deleteChannelLink({ id: link.id }).then(onChange)}
						>
							<Trash2 size={14} />
						</button>
					</div>
				}
			/>
			{link.mode && (
				<Input
					aria-label={`${link.label} room rules`}
					placeholder="Room rules in plain words (optional)"
					value={rules}
					onChange={(e) => setRules(e.target.value)}
					onBlur={() =>
						rules !== (link.rules ?? "") && void store.api.updateChannelLink({ id: link.id, rules }).then(onChange)
					}
				/>
			)}
		</div>
	);
}
