interface RoomRow {
	id: string;
	session_name: string | null;
	cwd: string | null;
	status: string;
	last_seen_at: number;
}

const container = document.getElementById("rooms") as HTMLElement;

function line(className: string, text: string): HTMLElement {
	const node = document.createElement("div");
	node.className = className;
	// textContent, not innerHTML: the session name and cwd come from whatever the
	// terminal reported, so they are untrusted strings rather than markup.
	node.textContent = text;
	return node;
}

async function render(): Promise<void> {
	const response = await fetch("/api/rooms");
	if (!response.ok) {
		location.href = "/login";
		return;
	}
	const { rooms } = (await response.json()) as { rooms: RoomRow[] };
	container.replaceChildren();
	if (rooms.length === 0) {
		const empty = document.createElement("p");
		empty.className = "empty";
		empty.textContent = "No sessions yet. Run /remote in a terminal.";
		container.append(empty);
		return;
	}
	for (const room of rooms) {
		const link = document.createElement("a");
		link.className = "room";
		link.href = `/r/${room.id}`;
		link.append(line("name", room.session_name ?? "Untitled session"));
		link.append(line("cwd", room.cwd ?? ""));
		if (room.status === "live") link.append(line("live", "live"));
		container.append(link);
	}
}

void render();
