import { type Context, defineService, type ReplicatedState } from "@knightcode/chord";
import type { ServerId } from "@knightcode/protocol";

export interface SessionAddress {
	serverId: ServerId;
	sessionId: string;
}

export interface SessionSummary extends SessionAddress {
	createdAt: number;
}

export interface SessionCreateOptions {
	id?: string;
}

export interface SessionDirectoryState {
	revision: number;
	sessions: SessionSummary[];
}

export interface SessionDirectory {
	readonly state: ReplicatedState<SessionDirectoryState>;
}

export const SessionDirectory = defineService<SessionDirectory>("knightcode.session-directory");

export interface SessionManagement {
	create(options: SessionCreateOptions, context: Context): Promise<SessionSummary>;
	remove(sessionId: string, context: Context): Promise<void>;
	attach(sessionId: string, context: Context): Promise<void>;
	detach(context: Context): Promise<void>;
}

export const SessionManagement = defineService<SessionManagement>("knightcode.session-management");
