/** Settings › Models & accounts: the default model, sign-ins and the sign-in flows. */
import {
	type experimental_LoginState,
	experimental_appearance,
	experimental_Button as Button,
	experimental_controllers,
	experimental_controls,
	experimental_icons,
	experimental_pickerServices,
	experimental_settingsControls,
	experimental_settingsServices as services,
	experimental_shellServices,
	experimental_useThreadList,
	experimental_useUpdate,
	type experimental_SettingsRequests as Requests,
} from "@knightcodeai/cli/desktop";
import { Fragment, type CSSProperties, type ReactNode, useCallback, useEffect, useRef, useState } from "react";
import {
	Archive,
	Box,
	Card,
	Check,
	ChevronDown,
	ChevronRight,
	ConfigFields,
	ConfirmDialog,
	Copy,
	DeleteThreadDialog,
	Dialog,
	DialogActions,
	Download,
	ExternalLink,
	Folder,
	IconButton,
	Import,
	KeyRound,
	levelName,
	ListFilter,
	LogIn,
	LogOut,
	Menu,
	MenuContent,
	MenuItem,
	MenuRadioGroup,
	MenuRadioItem,
	MenuSeparator,
	MenuTrigger,
	MessageSquare,
	ModelList,
	MoreHorizontal,
	NavRow,
	openFile,
	PageBar,
	PageBody,
	PageHeader,
	Pencil,
	Plus,
	Popover,
	RefreshCw,
	Row,
	ScopeCard,
	SearchField,
	Section,
	Segmented,
	SelectMenu,
	SizeField,
	Spinner,
	SquarePen,
	Switch,
	Tabs,
	Tooltip,
	Trash2,
	useProjectTrust,
} from "./ui.tsx";

/** One sign-in flow, under its provider's row: links and codes to act on, and the prompt the provider is waiting for. */
function LoginFlow({ loginId, onDone }: { loginId: string; onDone: () => void }) {
	const login: experimental_LoginState | undefined = services().experimental_useLogin(loginId);
	const [value, setValue] = useState("");
	useEffect(() => {
		if (login?.status === "complete") onDone();
	}, [login?.status, onDone]);
	if (!login) return <div className="kc-pulse px-4 pb-3 text-sm text-secondary">Starting sign-in…</div>;
	const prompt = login.status === "pending" ? login.pendingPrompt : undefined;
	const submit = (answer: string) => {
		setValue("");
		if (prompt) void services().experimental_answerLogin(loginId, answer);
	};
	const open = (url: string) => void services().experimental_openExternal(url);
	return (
		<div className="flex flex-col items-start gap-3 px-4 pb-3 text-sm">
			{login.events.map((event, i) => {
				const e = event as {
					type?: string;
					url?: string;
					instructions?: string;
					userCode?: string;
					verificationUri?: string;
					message?: string;
					links?: { url: string; label?: string }[];
				};
				if (e.type === "info" && e.links?.length)
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							<div className="text-secondary">{e.message}</div>
							{e.links.map((link) => (
								<Button key={link.url} variant="soft" toolbar onClick={() => open(link.url)}>
									<ExternalLink size={16} /> {link.label ?? link.url}
								</Button>
							))}
						</div>
					);
				if (e.type === "auth_url" && e.url)
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							{e.instructions ? <div className="text-secondary">{e.instructions}</div> : null}
							<Button variant="solid" toolbar onClick={() => open(e.url!)}>
								<ExternalLink size={16} /> Open the sign-in page
							</Button>
						</div>
					);
				if (e.type === "device_code")
					return (
						<div key={i} className="flex flex-col items-start gap-1.5">
							<div className="text-secondary">Enter this code at the sign-in page:</div>
							<div className="selectable font-code text-lg tracking-widest">{e.userCode}</div>
							{e.verificationUri ? (
								<Button variant="soft" toolbar onClick={() => open(e.verificationUri!)}>
									<ExternalLink size={16} /> Open {e.verificationUri}
								</Button>
							) : null}
						</div>
					);
				return e.message ? (
					<div key={i} className="text-secondary">
						{e.message}
					</div>
				) : null;
			})}
			{prompt ? (
				<div className="flex w-full flex-col gap-2">
					<div>{prompt.prompt.message}</div>
					{prompt.prompt.options ? (
						<div className="flex flex-col gap-1">
							{prompt.prompt.options.map((o) => (
								<button
									key={o.id}
									type="button"
									onClick={() => submit(o.id)}
									className="rounded-lg border border-line px-3 py-2 text-start hover:bg-ghost-hover"
								>
									<div>{o.label}</div>
									{o.description ? <div className="text-xs text-secondary">{o.description}</div> : null}
								</button>
							))}
						</div>
					) : (
						<div className="flex gap-2">
							<input
								autoFocus
								type={prompt.prompt.type === "secret" ? "password" : "text"}
								value={value}
								aria-label={prompt.prompt.message}
								placeholder={prompt.prompt.placeholder}
								onChange={(e) => setValue(e.target.value)}
								onKeyDown={(e) =>
									experimental_shellServices().experimental_matches(e, "desktop.composer.send") && submit(value)
								}
								className="kc-input h-7 flex-1 border-line-strong px-2"
							/>
							<Button variant="solid" toolbar onClick={() => submit(value)}>
								Continue
							</Button>
						</div>
					)}
				</div>
			) : null}
			{login.status === "failed" ? (
				<>
					<div className="text-danger-text">{login.error}</div>
					<Button variant="soft" toolbar onClick={onDone}>
						Dismiss
					</Button>
				</>
			) : null}
			{login.status === "pending" ? (
				<Button variant="soft" toolbar onClick={() => void services().experimental_cancelLogin(loginId).then(onDone)}>
					Cancel
				</Button>
			) : null}
		</div>
	);
}

/** The default model: a select-style button opening the composer's searchable model list. */
function DefaultModel() {
	const models = experimental_pickerServices().experimental_useModels();
	const defaultModel = services().experimental_useDefaultModel();
	const model = models.find((m) => `${m.provider}/${m.id}` === defaultModel);
	return (
		<Popover
			side="bottom"
			align="end"
			trigger={(open) => (
				<Button variant="field" toolbar aria-expanded={open} aria-label="Default model" className="max-w-64 px-3">
					<span className="truncate">{model ? `${model.providerName} · ${model.name}` : "Choose a model"}</span>
					<ChevronDown size={14} className="text-tertiary" />
				</Button>
			)}
		>
			{(close) => (
				<ModelList
					model={model}
					onModel={(m) => {
						close();
						void services().experimental_setDefaultModel(m);
					}}
				/>
			)}
		</Popover>
	);
}

export function Models() {
	const accounts = services().experimental_useAccounts();
	const [active, setActive] = useState<{ key: string; loginId?: string } | undefined>();
	useEffect(() => void services().experimental_refreshAccounts(), []);
	const signedIn = new Set(accounts?.accounts.map((a) => `${a.provider}:${a.type}`));
	return (
		<>
			<Card title="Default model">
				<Row title="New threads use" detail="Shared with the terminal (settings.json)">
					<DefaultModel />
				</Row>
			</Card>
			<Card title="Accounts">
				{accounts?.accounts.length ? null : <Row title="Not signed in to any provider" />}
				{accounts?.accounts.map((a) => (
					<Row
						key={`${a.provider}:${a.type}`}
						title={a.providerName}
						detail={a.type === "oauth" ? (a.isSubscription ? "Subscription" : "Signed in") : "API key"}
					>
						<Button variant="soft" toolbar onClick={() => void services().experimental_logout(a.provider)}>
							<LogOut size={16} /> Sign out
						</Button>
					</Row>
				))}
			</Card>
			<Card title="Add an account">
				{accounts?.loginOptions.map((o) => {
					const key = `${o.provider}:${o.type}`;
					const open = active?.key === key;
					return (
						<div
							key={key}
							className="relative not-last:after:absolute not-last:after:inset-x-4 not-last:after:bottom-0 not-last:after:h-px not-last:after:bg-line"
						>
							<Row title={o.providerName} detail={o.label}>
								{signedIn.has(key) ? (
									<span className="flex items-center gap-1 text-sm text-success">
										<Check size={16} /> Signed in
									</span>
								) : open ? null : (
									<Button
										variant="soft"
										toolbar
										onClick={() => {
											setActive({ key });
											void services()
												.experimental_startLogin(o.provider, o.type)
												.then((loginId) => (loginId ? setActive({ key, loginId }) : setActive(undefined)));
										}}
									>
										{o.type === "api_key" ? <KeyRound size={16} /> : <LogIn size={16} />}
										{o.type === "api_key" ? "Add key" : "Sign in"}
									</Button>
								)}
							</Row>
							{open && active.loginId ? (
								<LoginFlow loginId={active.loginId} onDone={() => setActive(undefined)} />
							) : null}
						</div>
					);
				})}
			</Card>
		</>
	);
}
