import { bedrockProviderModule } from "@knightcode/ai/bedrock-provider";
import { registerBunOAuthFlows } from "@knightcode/ai/bun-oauth";
import { setBedrockProviderModule } from "@knightcode/ai/compat";
import { APP_NAME } from "../config.ts";

process.title = APP_NAME;
process.emitWarning = (() => {}) as typeof process.emitWarning;
registerBunOAuthFlows();
setBedrockProviderModule(bedrockProviderModule);
