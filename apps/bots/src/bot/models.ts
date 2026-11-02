// Model access for a bot: the account's own provider credentials, held by its user object (spec section 4). Tests
// replace the factory with a scripted provider; nothing here chooses a model, the bot's settings do.
import type { Credential, CredentialInfo, CredentialStore, Models } from "@knightcode/ai";
import { builtinModels } from "@knightcode/ai/providers/all";
import type { Env } from "../env.ts";

export type ModelsFactory = (input: { env: Env; accountId: string }) => Models;

/** The account's credentials over RPC; `modify` runs in the user object, serialized per provider there. */
function userCredentials(env: Env, accountId: string): CredentialStore {
	const user = env.USER.get(env.USER.idFromName(accountId));
	return {
		read: (providerId) => user.credentialRead(providerId) as Promise<Credential | undefined>,
		list: () => user.credentialList() as Promise<readonly CredentialInfo[]>,
		modify: (providerId, fn) => user.credentialModify(providerId, fn) as Promise<Credential | undefined>,
		delete: (providerId) => user.credentialDelete(providerId),
	};
}

const defaultFactory: ModelsFactory = ({ env, accountId }) =>
	builtinModels({ credentials: userCredentials(env, accountId) });

let factory: ModelsFactory = defaultFactory;

export const modelsFor: ModelsFactory = (input) => factory(input);

/** Tests only: replace how bots reach models (`undefined` restores the default). */
export function setModelsFactory(next: ModelsFactory | undefined): void {
	factory = next ?? defaultFactory;
}
