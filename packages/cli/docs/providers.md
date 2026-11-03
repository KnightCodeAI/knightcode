# Providers

Most hosted providers support one or both of these authentication methods:

- Sign in through a browser or device flow backed by OAuth.
- Provide an API key.

Use `/login [provider]` to see the methods supported by a provider. Amazon Bedrock and Google Vertex AI can also use ambient cloud credentials.

## Authenticate interactively

Run `/login` and select a provider. KnightCode guides you through its OAuth or API-key flow and saves the resulting credential in [`auth.json`](configuration.md#agent-directory).

On a remote or headless machine, an OAuth callback may not reach the local process. When prompted, paste the final redirect URL or authorization code back into KnightCode.

Run `/logout` and select a provider to remove its stored credential. This does not unset environment variables, remove authentication from `models.json`, or revoke the credential at the provider.

`auth.json` can contain API keys and OAuth tokens. Keep it private and do not commit it.

## Check subscription usage

Run `/usage` in the interactive terminal to see remaining allowance and reset
times reported by connected Claude (`anthropic`), OpenAI Codex (legacy)
(`openai-codex`) and Grok (`xai`) subscription sign-ins. For Grok, run `/login xai`
and choose "Sign in with SuperGrok or X Premium". The figures cover the whole
account, not just the current KnightCode session. Other subscription sign-ins,
including the current `openai` ChatGPT sign-in, are listed as unsupported.

Claude shows extra usage first. KnightCode draws from extra usage rather than
Claude's plan limits. The extra-usage percentage is account-wide and includes
usage outside KnightCode; it does not measure this client's consumption alone.
The plan windows are shown only for reference. Codex windows describe the plan
allowance. Accounts with purchased credits can keep working at 0% remaining.

Grok shows the weekly or monthly credit pool and, when reported, the Grok Build
and API shares. These product lines are shares of the same pool, not separate
allowances. Accounts with purchased credits or pay-as-you-go can keep working
at 0% remaining. An xAI API key is billed separately and is not shown.

`unavailable` means the provider did not report a valid value. A window whose
reset has passed asks you to run `/usage` again instead of assuming the allowance
has refilled. Each opening fetches once; there is no polling or Refresh key.
Rate-limited providers are not requested again until their cooldown expires.

The panel is read-only: it never buys credits or changes provider settings.
It is available only in the interactive terminal, not RPC, print, JSON, or IDE
engine sessions. It uses your configured credential store and the existing
OAuth refresh path. Usage requests go only to the providers' fixed usage
endpoints, not a configured model endpoint.

Disable it with `"extensions": ["-builtin:usage"]` in settings, or disable all
extensions with `--no-extensions`.

## Use an API key from the environment

Environment variables are useful in CI and anywhere KnightCode should not store the key. Set the variable before starting KnightCode:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
knightcode
```

This table covers providers with a single primary API-key variable. Providers that need additional configuration or support ambient credentials are covered under [Provider Specific Config](#provider-specific-config).

| Provider | Environment variable |
|---|---|
| Anthropic | `ANTHROPIC_API_KEY` |
| AgentRouter | `AGENTROUTER_API_KEY` |
| Ant Ling | `ANT_LING_API_KEY` |
| OpenAI | `OPENAI_API_KEY` |
| DeepSeek | `DEEPSEEK_API_KEY` |
| NVIDIA NIM | `NVIDIA_API_KEY` |
| Google Gemini | `GEMINI_API_KEY` |
| GitHub Copilot | `COPILOT_GITHUB_TOKEN` |
| Mistral | `MISTRAL_API_KEY` |
| Groq | `GROQ_API_KEY` |
| Cerebras | `CEREBRAS_API_KEY` |
| xAI | `XAI_API_KEY` |
| OpenRouter | `OPENROUTER_API_KEY` |
| Vercel AI Gateway | `AI_GATEWAY_API_KEY` |
| ZAI Coding Plan (Global) | `ZAI_API_KEY` |
| ZAI Coding Plan (China) | `ZAI_CODING_CN_API_KEY` |
| OpenCode Zen and Go | `OPENCODE_API_KEY` |
| Radius | `RADIUS_API_KEY` |
| TypeSafe ([classifier models](models.md#use-classifier-models)) | `TYPESAFE_API_KEY` |
| Hugging Face | `HF_TOKEN` |
| Fireworks | `FIREWORKS_API_KEY` |
| Together AI | `TOGETHER_API_KEY` |
| Baseten | `BASETEN_API_KEY` |
| Kimi For Coding | `KIMI_API_KEY` |
| Meta | `META_API_KEY` |
| MiniMax | `MINIMAX_API_KEY` |
| MiniMax (China) | `MINIMAX_CN_API_KEY` |
| Moonshot AI (Global and China) | `MOONSHOT_API_KEY` |
| Qwen Token Plan and Individual | `QWEN_TOKEN_PLAN_API_KEY` |
| Qwen Token Plan (China) | `QWEN_TOKEN_PLAN_CN_API_KEY` |
| Xiaomi MiMo | `XIAOMI_API_KEY` |
| Xiaomi MiMo Token Plan (China) | `XIAOMI_TOKEN_PLAN_CN_API_KEY` |
| Xiaomi MiMo Token Plan (Amsterdam) | `XIAOMI_TOKEN_PLAN_AMS_API_KEY` |
| Xiaomi MiMo Token Plan (Singapore) | `XIAOMI_TOKEN_PLAN_SGP_API_KEY` |

Anthropic also recognizes `ANTHROPIC_OAUTH_TOKEN` as an API credential and `ANTHROPIC_AUTH_TOKEN` as bearer authentication.

With no key or token set, Anthropic uses workload identity federation when `ANTHROPIC_FEDERATION_RULE_ID`, `ANTHROPIC_ORGANIZATION_ID` and `ANTHROPIC_IDENTITY_TOKEN_FILE` are set: the Anthropic SDK exchanges the identity token for a short-lived access token and refreshes it itself (re-reading the identity token file, so keep that file fresh for long sessions). `ANTHROPIC_SERVICE_ACCOUNT_ID` and `ANTHROPIC_WORKSPACE_ID` are passed through when set.

## Load an API key from a command

To use a secret manager without writing the resolved key to disk, set a provider's `key` in `auth.json` to a command prefixed with `!`:

```json
{
  "anthropic": {
    "type": "api_key",
    "key": "!security find-generic-password -ws 'anthropic'"
  }
}
```

KnightCode runs the command when the key is first needed and caches its standard output for the process lifetime. Empty output, a timeout, or a nonzero exit leaves the key unresolved until KnightCode restarts.

## Provider Specific Config

The providers below have additional setup, need additional settings, or can use credentials supplied by their platform.

A stored API-key credential can include an `env` object. Its values take priority over the process environment for that provider:

```json
{
  "cloudflare-workers-ai": {
    "type": "api_key",
    "key": "...",
    "env": {
      "CLOUDFLARE_ACCOUNT_ID": "account-id"
    }
  }
}
```

### Radius

Radius is a service crafted for KnightCode by the builders of KnightCode, Earendil Works. It provides a customizable AI gateway with organization-level controls and analytics built in, and artifacts for sharing what you create with KnightCode.

To get started, run `/login radius` in KnightCode. This adds Radius as a provider, and its models appear in `/model` like any other provider's.

Radius also has an MCP server, so KnightCode can manage Radius for you.

Radius is currently in early alpha and evolving quickly. See [radius.earendil.com](https://radius.earendil.com) for more.

Radius authentication uses its gateway catalog and caches refreshed model metadata for later offline startup. A custom Radius gateway configured in `models.json` uses its own catalog rather than inheriting the public `radius.pi.dev` catalog.

### OpenRouter

Authenticate with `/login openrouter` or `OPENROUTER_API_KEY`.

With a key, KnightCode lists only the OpenRouter chat models that key may use, with the key's context size, max output, and prices. These come from OpenRouter's `/models/user` endpoint and reflect guardrails and provider restrictions set in OpenRouter. Image and classifier models are not filtered.

KnightCode refreshes the list in the background at startup in interactive mode, when `/model` opens, after `/login`, and on `knightcode update --models`. The last list is saved and used offline and in `knightcode -p` and RPC mode. After switching keys outside `/login`, the previous key's list stays until the next refresh.

Regional endpoints filter models to their region. To use one, set the base URL in [`models.json`](models.md#configure-a-compatible-endpoint):

```json
{
  "providers": {
    "openrouter": { "baseUrl": "https://us.openrouter.ai/api/v1" }
  }
}
```

If the base URL rejects the key at `/models/user` or does not have that endpoint, for example a proxy configured as the OpenRouter base URL, KnightCode lists every OpenRouter model.

### AgentRouter

Authenticate with `/login agentrouter` or `AGENTROUTER_API_KEY`. The default model is `gpt-6.1-sol`.

KnightCode sends `gpt-5.6-sol`, `gpt-6-astra`, and `gpt-6.1-sol` through the OpenAI Responses API because AgentRouter rejects Chat Completions for these models. Other models keep their configured Chat Completions or Anthropic Messages API.

When developing from source, run `bun run generate:models` after changing catalog definitions, then restart KnightCode. AgentRouter catalog generation keeps the committed model data if its pricing endpoint is unavailable; the GPT API corrections apply to that fallback too.

### Azure OpenAI

The provider ID is `azure` (formerly `azure-openai-responses`). Use it as the key in `auth.json`, `models.json`, and `settings.json`, and in model references such as `--model azure/gpt-5.4`.

The `azure` provider serves OpenAI models through the Responses API and Microsoft Foundry models through Chat Completions, such as `azure/deepseek-v4-pro`.

Set an API key plus either a base URL or resource name:

```bash
export AZURE_OPENAI_API_KEY=...
export AZURE_OPENAI_BASE_URL=https://your-resource.ai.azure.com
# Or:
export AZURE_OPENAI_RESOURCE_NAME=your-resource
```

Resource root URLs under `ai.azure.com`, `cognitiveservices.azure.com`, and `openai.azure.com` are normalized to the OpenAI API path.

KnightCode sends the model ID as the deployment name. If a deployment has a different name, map it with `AZURE_OPENAI_DEPLOYMENT_NAME_MAP`. The map applies to both the Responses API and Foundry Chat Completions:

```bash
export AZURE_OPENAI_DEPLOYMENT_NAME_MAP=gpt-5.4=my-gpt-deployment,deepseek-v4-pro=my-deepseek
```

`AZURE_OPENAI_API_VERSION` overrides the API version for OpenAI models (default `v1`).

To use a Foundry model that KnightCode does not include, add it under `azure` in [`models.json`](models.md#configure-a-compatible-endpoint) with `api: "openai-completions"`. Custom models require a `baseUrl`; `AZURE_OPENAI_BASE_URL` and `AZURE_OPENAI_RESOURCE_NAME` take priority over it when set:

```json
{
  "providers": {
    "azure": {
      "baseUrl": "https://your-resource.services.ai.azure.com",
      "models": [
        { "id": "your-deployment", "api": "openai-completions" }
      ]
    }
  }
}
```

### Amazon Bedrock

Bedrock can use a bearer token or an ambient AWS credential source:

```bash
# Named profile
export AWS_PROFILE=your-profile

# IAM keys
export AWS_ACCESS_KEY_ID=AKIA...
export AWS_SECRET_ACCESS_KEY=...
# Required for temporary credentials
export AWS_SESSION_TOKEN=...

# Bedrock bearer token
export AWS_BEARER_TOKEN_BEDROCK=...

# Region, when not supplied by the profile or AWS SDK configuration
export AWS_REGION=us-west-2
# AWS_DEFAULT_REGION is also supported
```

KnightCode also supports ECS task credentials and IRSA through the standard `AWS_CONTAINER_CREDENTIALS_*` and `AWS_WEB_IDENTITY_TOKEN_FILE` variables.

### Cloudflare AI Gateway

The gateway requires a token, account ID, and gateway ID:

```bash
export CLOUDFLARE_API_KEY=...
export CLOUDFLARE_ACCOUNT_ID=...
export CLOUDFLARE_GATEWAY_ID=...
```

The account and gateway IDs can come from the process environment or the credential's `env` object in `auth.json`.

`CLOUDFLARE_API_KEY` authenticates KnightCode to the gateway. Upstream access can use Cloudflare unified billing, credentials stored in the gateway, or an `Authorization` header configured for the provider in `models.json`.

### Cloudflare Workers AI

Workers AI requires a token and account ID:

```bash
export CLOUDFLARE_API_KEY=...
export CLOUDFLARE_ACCOUNT_ID=...
```

The account ID can also be stored in the credential's `env` object.

### Google Vertex AI

Use a Google Cloud API key:

```bash
export GOOGLE_CLOUD_API_KEY=...
```

To use Application Default Credentials, configure a project and location:

```bash
export GOOGLE_CLOUD_PROJECT=your-project
# GCLOUD_PROJECT is also supported
export GOOGLE_CLOUD_LOCATION=us-central1
```

Then authenticate:

```bash
gcloud auth application-default login
```

To use a service-account key file instead, set `GOOGLE_APPLICATION_CREDENTIALS` along with the project and location.

### Gemini web

Signs in to the Gemini web app (gemini.google.com) with your own Google session cookies instead of an API key. Run `/login gemini-web` and paste the `__Secure-1PSID` value, then the `__Secure-1PSIDTS` value, from your browser's cookies for gemini.google.com. KnightCode loads the Gemini page once to check that the session works before saving anything. `GEMINI_WEB_COOKIES` (a bare `__Secure-1PSID` value, or `__Secure-1PSID=...; __Secure-1PSIDTS=...`) works as an environment fallback.

Read this before using it:

- **The cookies are your Google account.** They are not scoped to Gemini. They are stored in plaintext in `~/.knightcode/agent/auth.json` (mode `0600`) and sent to gemini.google.com, plus accounts.google.com when refreshing the session. Only the session cookies are kept.
- **Uninstalling does not remove them.** `npm uninstall` and deleting the binary leave `~/.knightcode` in place. Run `/logout` for `gemini-web` first, or delete `auth.json`.
- **It is unofficial.** The web app is a private interface. Google does not support this use, it may violate Google's terms, and the account can be restricted. The format can change without notice and break the provider.
- **Cookies are refreshed.** Google rotates `__Secure-1PSIDTS` while the session is in use. KnightCode saves the new value, so a restart or reinstall keeps the sign-in. Best-effort rotation waits at most ten seconds; failed attempts are also throttled for 60 seconds so an unreachable accounts host does not delay every tool round. A cookie Google has already rejected still needs a fresh login.
- **Session page requests.** Session-page initialization has a separate 30-second limit, including redirects and cookie-updated page reloads; expiration stops setup without automatic retries or a generation. On conversation continuations, KnightCode reuses the page's request tokens in memory for up to five minutes with unchanged cookies. Expired tokens or changed cookies cause a page reload on the next real request, not a background timer. If a cached token gets an HTTP 400, 401, or 403 rejection, KnightCode reloads the page and retries once. Quota errors and incomplete streams do not trigger this token-refresh retry. This avoids repeated page loads; it does not establish how Google charges the web allowance.
- **Tool calling is emulated.** The web app has no function calling. KnightCode describes the tools in the prompt and parses `<tool_call>` blocks from the reply, so it is less reliable than a real API provider. Tool names and partial arguments appear while Gemini generates them, but tools execute only after the completed reply has been parsed. Gemini can rewrite or withdraw draft calls; only calls in the final reply execute. Invalid tool-call JSON gets one corrective attempt before any call in that batch executes; repeated malformed JSON stops the reply with an error rather than issuing another batch of failed edits. Valid JSON with schema errors still goes through normal tool validation. Saved malformed calls are described as unexecuted proposals during replay, without changing local history. Gemini is asked to group independent calls, use small edit replacements, start servers separately in the background, and give diagnostic commands finite timeouts.
- **Applying file changes.** Gemini is instructed to edit files with the listed tools, not return replacement code to paste. For clear edit requests answered with copy-paste instructions, KnightCode makes one corrective continuation when an edit-capable tool is available. Explanation-only requests and replies following an attempted edit are left alone, including denied edits. Existing permission checks still apply. If that correction produces no tool call, KnightCode reports that no edits were executed by the reply instead of treating it as a completed edit.
- **Generic failure replies.** Gemini sometimes returns only “I seem to be encountering an error. Can I try something else for you?”, “I encountered an error doing what you asked. Could you try again?”, “Sorry, something went wrong. Please try your request again.”, or “I'm having a hard time fulfilling your request. Can I help you with something else instead?” as a completed HTTP 200 reply. KnightCode treats these as failures, not successful task completion. It tries once in a fresh temporary chat with the full transcript and confirmed tool results, instructing Gemini not to repeat successful operations. A repeated failure is reported as an error and its continuation is not cached. Saved error-only replies from older versions are excluded from replayed prompts without deleting local history. These messages do not establish a fixed session timeout or reveal Google's underlying cause.
- **Progress and timeouts.** KnightCode streams the thought summaries Google returns and asks Gemini for brief progress updates before tool calls. Google does not expose its hidden reasoning trace, and some replies have no thought summary. The low-level adapter defaults to ten minutes only when no `timeoutMs` is supplied. The CLI and desktop supply a request timeout from `retry.provider.timeoutMs`, falling back to `httpIdleTimeoutMs` (five minutes by default), so that application setting overrides the adapter default. SDK callers can also supply `timeoutMs`. When this full request limit expires, Gemini Web stops without automatic agent-level repeats; user cancellation and explicit quota errors remain distinct.
- **Context.** Chats remain temporary and are not saved to your Gemini history. Within a running KnightCode session, the first request sends the instructions, tool schemas, and transcript; later requests reuse that temporary conversation and send only new messages or tool results. Continuation metadata stays in memory, not on disk. Changed history, instructions, tools, models, or accounts start a fresh chat, as do restarts and more than two hours of inactivity. This is a local retention policy, not a guarantee of Google's chat lifetime. If Google explicitly rejects a continuation, KnightCode tries once with the full transcript. Standalone SDK calls without `sessionId`, and calls with `cacheRetention: "none"`, send a cold replay instead.
- **Large history replays.** When a cold replay exceeds roughly 32K estimated tokens and a source-reading tool is available, older successful tool outputs over 2,000 characters are shortened to their beginning and end with explicit omission markers. The most recent eight results, the entire latest tool-call batch, all errors and permission denials, user messages, system instructions, tool schemas, tool arguments, and assistant conclusions remain unshortened. Gemini is told to re-read omitted source content before editing and not repeat successful operations. Local history is not changed, and no model-generated summary request is added. New tool results in incremental continuations are never shortened. Low-level SDK `stream()` callers can set `historyReplay: "full"` to disable this replay optimization. This reduces replay data; it does not establish a measured Google-side speedup or quota saving.
- **Usage and idle time.** Gemini Web uses your account's web allowance, not Gemini API-key billing. Google does not report token counts, cache hits/misses, or per-request costs through this interface: zero usage in KnightCode means unavailable, not free. KnightCode sends no Gemini generation, cache-warming, or cookie-refresh requests while idle. Returning after a pause may require resending context on your next request, but idling itself does not cause a KnightCode cache-miss request. An active task can continue generating after tool results without another user message; being silent while it works is not idle. Each tool-result round still requires a generation. At most one extra recovery generation per reply is shared by explicit continuation rejection, a generic failure reply, a false tools-disabled refusal, copy-paste deflection, malformed tool-call JSON, or withdrawn draft calls; these recoveries do not stack. Conversation reuse reduces repeated data sent, but does not guarantee lower quota consumption. Google's quota accounting is not exposed and the allowance can also be used outside KnightCode.
- **Limits.** `default` follows the model selected in the Gemini account. `gemini-3.5-flash-lite`, `gemini-3.8-flash`, `gemini-3.1-pro`, and `gemini-4-argon` select those models, with low, medium, and high thinking. If Google answers a selected model with a different one, KnightCode discards the reply and reports that model's quota as exhausted. Text input only. This unofficial interface cannot guarantee the same tool reliability or progress detail as supported API providers.
