// The primitives gallery (development only, at /__gallery): every primitive and every avatar shape.
import { AVATAR_COLORS, AVATAR_SHAPES } from "@knightcode/bots-protocol";
import {
	Badge,
	BotAvatarView,
	Button,
	Card,
	Dialog,
	IconButton,
	Input,
	Menu,
	MenuItem,
	MenuSeparator,
	Select,
	Skeleton,
	Tabs,
	Textarea,
	ToastProvider,
	Toggle,
	useToast,
} from "@knightcode/bots-ui";
import { Plus, Search, Settings } from "lucide-react";
import { type ReactNode, useState } from "react";

function Row({ title, children }: { title: string; children: ReactNode }) {
	return (
		<section style={{ display: "grid", gap: 10 }}>
			<h2 style={{ margin: 0, fontSize: 13, fontWeight: 500, color: "var(--kb-color-text-secondary)" }}>{title}</h2>
			<div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center" }}>{children}</div>
		</section>
	);
}

function ToastDemo() {
	const show = useToast();
	return <Button onClick={() => show({ text: "Renamed to Rex", action: { label: "Undo", onAction: () => undefined } })}>Show toast</Button>;
}

/** Renders every primitive in its main states. */
export function Gallery() {
	const [tab, setTab] = useState("details");
	const [on, setOn] = useState(true);
	const [select, setSelect] = useState("system");
	const [dialog, setDialog] = useState(false);
	return (
		<ToastProvider>
			<main style={{ display: "grid", gap: 28, padding: 32, maxWidth: 1100 }}>
				<Row title="Buttons">
					<Button variant="primary">Primary</Button>
					<Button variant="primary" size="sm">
						Get started
					</Button>
					<Button variant="secondary">Cancel</Button>
					<Button variant="subtle">Add account</Button>
					<Button variant="primary" disabled>
						Create
					</Button>
				</Row>
				<Row title="Icon buttons">
					<IconButton label="Search" icon={<Search size={16} />} />
					<IconButton label="New Bot" icon={<Plus size={16} />} />
					<IconButton label="Settings" icon={<Settings size={14} />} variant="ghost" size={32} />
				</Row>
				<Row title="Menu, select, dialog, toast">
					<Menu label="Account" trigger={<Button>Open menu</Button>}>
						<MenuItem icon={<Settings size={14} />}>Settings</MenuItem>
						<MenuItem>Support</MenuItem>
						<MenuSeparator />
						<MenuItem>Log out</MenuItem>
					</Menu>
					<Select
						label="Theme"
						value={select}
						onValueChange={setSelect}
						options={[
							{ value: "system", label: "Follow System" },
							{ value: "light", label: "Light" },
							{ value: "dark", label: "Dark" },
						]}
					/>
					<Button onClick={() => setDialog(true)}>Open dialog</Button>
					<ToastDemo />
					<Dialog
						open={dialog}
						onOpenChange={setDialog}
						title="Create New Bot"
						width={440}
						footer={
							<>
								<Button onClick={() => setDialog(false)}>Cancel</Button>
								<Button variant="primary">Create</Button>
							</>
						}
					>
						<div className="kb-dialog__body">
							<Input aria-label="Bot name" placeholder="Name your Bot" />
						</div>
					</Dialog>
				</Row>
				<Row title="Tabs, switch, badges">
					<Tabs
						label="Conversation details"
						value={tab}
						onValueChange={setTab}
						items={[
							{ value: "details", label: "Details" },
							{ value: "library", label: "Library" },
							{ value: "computer", label: "Computer" },
						]}
					/>
					<Toggle label="Auto-Review" checked={on} onCheckedChange={setOn} />
					<Badge>Needs you</Badge>
					<Badge tone="accent">3</Badge>
				</Row>
				<Row title="Fields">
					<div style={{ width: 320 }}>
						<Input aria-label="Name" placeholder="Name your Bot" />
					</div>
					<div style={{ width: 320 }}>
						<Textarea aria-label="Instructions" placeholder="What should this bot do?" />
					</div>
				</Row>
				<Row title="Card and skeleton">
					<Card style={{ width: 360, padding: 16 }}>A card holds a connector, an approval or a question.</Card>
					<div style={{ width: 240, display: "grid", gap: 8 }}>
						<Skeleton height={14} />
						<Skeleton height={14} width="70%" />
					</div>
				</Row>
				<Row title="Avatars">
					{AVATAR_SHAPES.map((shape, i) => (
						<span key={shape} title={shape} style={{ display: "inline-grid", justifyItems: "center", gap: 4, fontSize: 11 }}>
							<BotAvatarView shape={shape} color={AVATAR_COLORS[i % AVATAR_COLORS.length]!} size={44} />
							{shape}
						</span>
					))}
				</Row>
			</main>
		</ToastProvider>
	);
}
