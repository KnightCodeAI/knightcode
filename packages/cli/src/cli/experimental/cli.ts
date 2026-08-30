import { type ClientCommandContext, clientCommand } from "./commands/client.ts";
import { type KnightCommandContext, knightcodeCommand } from "./commands/knightcode.ts";
import { type ServerCommandContext, serverCommand } from "./commands/server.ts";

export type ExperimentalCliContext = KnightCommandContext & ServerCommandContext & ClientCommandContext;

export const experimentalCli = knightcodeCommand.command(serverCommand).command(clientCommand);
