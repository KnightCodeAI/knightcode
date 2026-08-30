import type { ProviderStreams } from "../types.ts";
import { lazyApi } from "./lazy.ts";

export const knightCodeMessagesApi = (): ProviderStreams => lazyApi(() => import("./knightcode-messages.ts"));
