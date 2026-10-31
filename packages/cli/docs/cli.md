<a id="cli-and-modes-reference"></a>

# Command Line

This page documents KnightCode's built-in command-line commands and options. Run `knightcode --help` or append `--help` to a command for the exact interface in your installed version. The top-level help also includes options registered by loaded extensions.

```sh
knightcode [options] [--] [@files...] [messages...]
knightcode install <source> [options]
knightcode remove <source> [options]
knightcode uninstall <source> [options]
knightcode update [target] [options]
knightcode list
knightcode config [options]
knightcode auth <check|print-api-key|print-bearer-token> [options]
knightcode mcp <add|remove|list|login|logout> [options]
knightcode plugin <install|list|details|enable|disable|update|uninstall|validate|marketplace> [options]
knightcode app-server [-e <extension>]... [--session-dir <dir>]
```

`knightcode plugin` installs and manages Claude Code and Grok Build plugins; see [Plugins](plugins.md).

<a id="modes"></a>

## Invocation and output

```sh
knightcode
knightcode --print "Summarize this repository"
git diff | knightcode --print "Review this change"
knightcode --mode json "Inspect this repository" > events.jsonl
```

With terminal stdin and stdout, KnightCode opens the terminal UI unless `--print`, `--mode json`, or `--mode rpc` selects another interface. When either stream is redirected and neither JSON nor RPC mode is selected, KnightCode uses print mode. See [CLI Integration](cli-integration.md) for choosing between interactive, print, JSON, RPC, and SDK integration.

| Input | Behavior |
|---|---|
| `message` | Provide an initial prompt |
| `@path` | Include a text file or image in the first prompt |
| Piped stdin | Prepend its contents to the first prompt |
| `--` | Stop option parsing so a prompt can begin with `-` |

KnightCode resolves `@path` from the current working directory. The working directory also controls project configuration, resource discovery, and session grouping.

`--print` controls whether KnightCode runs once and exits. `--mode` selects the output interface. `--mode text` does not force one-shot execution when stdin and stdout are terminals; use `--print` for that behavior.

| Option | Behavior |
|---|---|
| `-p`, `--print` | Run the supplied prompts, write the final assistant text to stdout, then exit |
| `--mode text` | Select text output; still open the terminal UI when stdin and stdout are terminals |
| `--mode json` | Run the supplied prompts, write JSONL events to stdout, then exit |
| `--mode rpc` | Read JSONL commands from stdin and write responses and events to stdout until shutdown |
| `--export <input> [output]` | Export a session file to HTML and exit; derive the destination when `output` is omitted |

RPC mode rejects `@file` arguments. JSON and RPC modes reserve stdout for protocol records. See [JSON Event Stream](json.md) and [RPC Protocol](rpc.md).

### Plan before implementing

```sh
knightcode --plan
knightcode -p --plan "Plan the authentication refactor"
```

The built-in `--plan` extension flag enters enforced [plan mode](plan-mode.md)
only on initial startup, including when opening a saved session. Later reloads,
new sessions, resumes, and forks follow their saved state rather than reapplying
the flag. Print mode (`-p`) writes the submitted Markdown to stdout;
implementation requires explicit `/plan approve`. Incompatible tool filters or
active codemode `only` mode fail startup before any provider request.
`--no-extensions` disables the built-in unless explicitly loaded with
`-e builtin:plan-mode`.

<a id="model-options"></a>

## Models

```sh
knightcode --model sonnet:high
```

See [Choose a Model](models.md) for model selection and [Providers](providers.md) for credentials.

- `--provider <name>`<br>
  Restricts `--model` lookup to one provider. It requires `--model`.
- `--model <pattern>`<br>
  Selects by exact ID or fuzzy ID/name match. It accepts `provider/id` and an optional `:<thinking>` suffix. If several providers match, KnightCode prefers the one with credentials, otherwise it asks for `--provider`.
- `--api-key <key>`<br>
  Uses a non-persistent API-key override. It requires a model selected through `--model` or `--models`. It does not choose between providers that offer the same model.
- `--thinking <level>`<br>
  Sets `off`, `minimal`, `low`, `medium`, `high`, `xhigh`, or `max`. It overrides a `--model` suffix and is clamped to the model's capabilities.
- `--models <patterns>`<br>
  Sets a comma-separated scope for startup and cycling. It accepts exact IDs, fuzzy matches, case-insensitive globs, and optional `:<thinking>` suffixes. A model offered by several providers is added for each, with a warning.
- `--list-models [search]`<br>
  Lists available models, optionally filtered by a fuzzy search, then exits.

<a id="session-options"></a>

## Sessions

```sh
knightcode --continue
```

See [Sessions and Context](sessions.md) for resuming, forking, naming, and storing sessions.

- `-c`, `--continue`<br>
  Continues the most recent session for the current directory.
- `-r`, `--resume`<br>
  Opens the session selector and resumes the chosen session in its working directory. Press Tab to include sessions from other directories.
- `--session <path|id>`<br>
  Opens a session by file path or full/partial ID, and resumes it in its working directory. If the ID only matches sessions stored for another directory, KnightCode offers to fork it into the current directory instead.
- `--session-id <id>`<br>
  Opens the current directory's existing session with the ID, or creates it otherwise. IDs accept letters, numbers, `.`, `_`, and `-`.
- `--fork <path|id>`<br>
  Forks a session, chosen by file path or full/partial ID, into a new session in the current directory.
- `--session-dir <dir>`<br>
  Overrides storage and lookup. It takes precedence over `KNIGHTCODE_CODING_AGENT_SESSION_DIR` and the `sessionDir` setting.
- `--no-session`<br>
  Uses an in-memory session that is not persisted.
- `-n`, `--name <name>`<br>
  Sets the session display name.

Constraints:

- Session IDs must start and end with a letter or number.
- `--fork` cannot be combined with `--session`, `--continue`, `--resume`, or `--no-session`.
- `--session-id` cannot be combined with `--session`, `--continue`, or `--resume`. Combine it with `--fork` to choose the new ID.

<a id="tool-options"></a>

## Tools

```sh
knightcode --tools read,grep,find,ls --print "Review this project"
```

See [Settings](settings.md#tools) for configuring the default tool selection.

- `-t`, `--tools <list>`<br>
  Replaces the default selection with a comma-separated allowlist of built-in, extension, or custom tools. Entries are tool names or patterns where `*` matches any characters. MCP tools are kept unless an entry starts with `mcp__` (see [MCP tools](#mcp-tools)). A list of only `+name` and `-name` entries is not an allowlist; it changes the default selection instead.
- `-xt`, `--exclude-tools <list>`<br>
  Disables comma-separated tool names or patterns after all other selection options, MCP tools included.
- `-nbt`, `--no-builtin-tools`<br>
  Disables default built-in tools while retaining extension and custom tools.
- `-nt`, `--no-tools`<br>
  Starts with all built-in, extension, custom, and MCP tools disabled.

Default enabled tools are `read`, `bash`, `edit`, and `write`, unless `defaultTools` changes them. `--tools` with plain names replaces the whole selection, so name every tool you want. Like `defaultTools`, it also accepts a list of only `+name` and `-name` entries, which adds tools to or removes them from the default selection: `knightcode --tools +codemode,-write` keeps the other default tools, enables `codemode`, and disables `write`. These entries take exact tool names, not `*` patterns; use `--exclude-tools` to disable tools by pattern. Plain names and `+name`/`-name` entries cannot be mixed. `/reload` enables tools newly added to `defaultTools`, but a tool removed with `-name` stays removed.

<a id="mcp-tools"></a>

`--tools` selects the tools declared to the model. It does not remove MCP tools, whose reach is set by their [exposure](mcp.md#control-tool-exposure): `knightcode --tools read,codemode` keeps every MCP tool callable from codemode scripts. An MCP tool that no entry names or matches is never declared directly, whatever its exposure; only `tool_search`, if listed, can load it. Once an entry starts with `mcp__`, `--tools` filters MCP tools too, so this keeps only the tools of the `radius` server:

```sh
knightcode --tools read,bash,codemode,'mcp__radius__*'
```

The MCP resource tools (`list_mcp_resources`, `list_mcp_resource_templates`, `read_mcp_resource`) count as MCP tools. To remove MCP tools, use `--exclude-tools 'mcp__*'` or [`--no-mcp`](#resource-options).

| Built-in | Purpose |
|---|---|
| `read` | Read text files and supported images |
| `bash` | Run shell commands |
| `powershell` | Run PowerShell commands on Windows |
| `edit` | Apply exact text replacements to an existing file |
| `write` | Create or overwrite a file |
| `grep` | Search file contents |
| `find` | Find paths using glob patterns |
| `ls` | List directory contents |

The [web tools](usage.md#web-tools) `webfetch` and `websearch` and the [question tool](usage.md#questions) `ask_user` are off until enabled with `/tools` or named here. A tool excluded here stays off whatever `/tools` says, and one turned off with `/tools` stays off even when named here.

Built-in extensions add two more tools. They are off by default; the MCP extension turns them on when an MCP server needs them (see [MCP](mcp.md#control-tool-exposure)). To enable them yourself, name them in `--tools` or `defaultTools`.

| Built-in extension | Purpose |
|---|---|
| `codemode` | Run JavaScript that calls the other tools, for example in parallel with `Promise.allSettled`; only the script's output reaches the model |
| `tool_search` | Search tools that are not declared to the model (`codemode` and `deferred` exposure, such as MCP tools) and declare the matches for the next call |

### Enable codemode

To turn on `codemode` for every session, add it to the default tools in `~/.knightcode/agent/settings.json` or a project's `.knightcode/settings.json`:

```json
{
  "defaultTools": ["+codemode"]
}
```

This keeps `read`, `bash`, `edit`, and `write` and adds `codemode`. For one invocation, add it with `--tools`:

```sh
knightcode --tools +codemode
```

Codemode is useful without MCP: scripts can run several tool calls in parallel, filter large output before it reaches the model, call classifier models such as TypeSafe's Jev through `models.classify()` (see [Classifier models](models.md#use-classifier-models)), and generate images through `models.generateImages()` (see [Image models](models.md#use-image-models)).

### How codemode works

Scripts run in a QuickJS sandbox and reach the other tools through `tools.<name>(args)`. [Codemode](codemode.md) describes the script API, how tools are listed and found, the `store()` and `models` globals, and the limits.

### Tool search

`tool_search` is off by default; enable it with `"defaultTools": ["+tool_search"]` or `--tools`. It uses the same ranking as `searchTools()` over tools that are not declared yet and declares the matches for the next model call. Loaded tools are recorded in the session like other tool changes, so they stay declared on that branch.

<a id="resource-options"></a>

## Resources

```sh
knightcode --extension ./review.ts
```

See [Configuration](configuration.md) for conventional directories and project trust, [Settings](settings.md#resources) for configured paths, and [KnightCode Packages](packages.md) for package sources.

- `-e`, `--extension <path>`<br>
  Loads an extension file or directory, or a built-in extension such as `builtin:mcp`, and is repeatable.
- `-ne`, `--no-extensions`<br>
  Disables discovered, configured, and built-in extensions. Explicit `-e` paths still load, so `knightcode -ne -e builtin:mcp` keeps only the built-in MCP support.
- `--no-mcp`<br>
  Disables the built-in MCP support for this run: no servers connect, and there are no MCP tools or `/mcp`. It does not affect an extension that replaces the built-in MCP support.
- `--skill <path>`<br>
  Loads a skill file or directory and is repeatable.
- `-ns`, `--no-skills`<br>
  Disables discovered and configured skills. Explicit `--skill` paths still load.
- `--prompt-template <path>`<br>
  Loads a prompt-template file or directory and is repeatable.
- `-np`, `--no-prompt-templates`<br>
  Disables discovered and configured templates. Explicit `--prompt-template` paths still load.
- `--theme <path>`<br>
  Loads a theme file or directory and is repeatable.
- `--use-theme <name[/name]>`<br>
  Selects the initial interactive theme for this run.
- `--no-themes`<br>
  Disables discovered and configured themes. Explicit `--theme` paths still load.
- `-nc`, `--no-context-files`<br>
  Disables `AGENTS.md` and `CLAUDE.md` discovery.

Resource paths apply only to the current process. Relative paths resolve from the current working directory.

<a id="prompt-and-display-options"></a>

## Prompts and process

```sh
knightcode --append-system-prompt ./instructions.md
```

See [Configuration](configuration.md) for saved configuration, [Security](security.md#understand-project-trust) for project trust, and [Environment Variables](environment-variables.md) for process controls.

- `--system-prompt <text|path>`<br>
  Replaces the default system prompt with text or the contents of an existing file.
- `--append-system-prompt <text|path>`<br>
  Appends text or an existing file to the system prompt and is repeatable.
- `--tui-mode <mode>`<br>
  Uses `fullscreen` (default) or `regular` terminal mode.
- `--verbose`<br>
  Shows verbose interactive startup information, overriding `quietStartup`.
- `-a`, `--approve`<br>
  Trusts project-local configuration and resources for this process.
- `-na`, `--no-approve`<br>
  Ignores trust-gated project-local configuration and resources for this process.
- `--offline`<br>
  Disables automatic network activity, including model catalog refreshes. Equivalent to `KNIGHTCODE_OFFLINE=1`.
- `-h`, `--help`<br>
  Shows help, including flags registered by loaded extensions, then exits.
- `-v`, `--version`<br>
  Shows the KnightCode version, then exits.

Extensions may register additional long-form options. Unknown short options are rejected.

## Package commands

```sh
knightcode install npm:@scope/package
```

See [KnightCode Packages](packages.md) for source formats, filtering, installation, and project scope.

### Common tasks

| Task | Command |
|---|---|
| Install a package | `knightcode install <source>` |
| List configured packages | `knightcode list` |
| Remove a package and its settings entry | `knightcode remove <source>` |
| Configure which package resources load | `knightcode config` |

Add `--local` or `-l` to `install`, `remove`, `uninstall`, or `config` to use project settings instead of global settings.

### Update KnightCode or packages

Running `knightcode update` without a target updates KnightCode itself.

Interactive sessions check for updates at startup and hourly. Installer-managed
installs, writable global package manager installs, and downloaded release
binaries update in the background. A right-aligned line directly above the input
shows **Downloading vX.Y.Z**, then **Restart for vX.Y.Z** in green. Errors are red;
waiting for another terminal is yellow. Exit when convenient and relaunch; use
the displayed restart command to continue the saved session. Active work is never
restarted automatically.

The script installer stages and verifies a separate release before changing the
launcher, retaining the version that open sessions use. Global package manager
installs update in place, and the new version is started once to check it before
the update reports success. A downloaded standalone binary is replaced from the
matching [GitHub release](https://github.com/KnightCodeAI/knightcode/releases)
archive, checked against its `SHA256SUMS`, and smoke-tested before any file
moves; files next to it that the release does not ship are left alone. These
updates run in a separate process that can finish after you exit. Other open
sessions keep running, but files on disk change under them; after an in-place
update, a session warns you to restart if code it loads on demand fails. On
Windows, automatic global updates support npm and pnpm. Source checkouts,
non-writable installs, and package renames show manual update notices instead.

Failed background updates show a manual retry command and are retried on a later
check. Automatic updates are on by default. To retain update notices without
automatic downloads, open `/settings` and set **Automatic updates** to `false`,
or add `"autoUpdate": false` to your user-level `~/.knightcode/agent/settings.json` (Windows:
`%USERPROFILE%\.knightcode\agent\settings.json`). Project settings cannot override
this preference. See [Disable automatic updates](settings.md#disable-automatic-updates)
for a complete example and reload instructions.

Alternatively, set `KNIGHTCODE_DISABLE_AUTO_UPDATE=1` in your shell or operating
system environment before launching KnightCode; it overrides `autoUpdate: true`.
`KNIGHTCODE_SKIP_VERSION_CHECK=1` suppresses both automatic checks and downloads.
Explicit `knightcode update` remains available regardless of the setting or either
variable. Offline, print, JSON, and RPC sessions do not start background updates.

| Task | Command |
|---|---|
| Update KnightCode | `knightcode update` |
| Update all installed packages | `knightcode update --extensions` |
| Update one installed package | `knightcode update <source>` |
| Refresh model catalogs | `knightcode update --models` |
| Update KnightCode and all installed packages | `knightcode update --all` |

Add `--force` to reinstall KnightCode when the selected update includes KnightCode.

#### Custom update command

`knightcode update` cannot update KnightCode when a wrapper or another package manager provides it, such as mise or Nix. Set `KNIGHTCODE_SELF_UPDATE_COMMAND` so `knightcode update` runs that tool's update command instead:

```sh
export KNIGHTCODE_SELF_UPDATE_COMMAND="mise use -g npm:{packageName}@{version}"
```

`knightcode update` runs it only when knightcode.dev has a newer release (or with `--force`), replacing `{packageName}`, `{version}`, and `{installSpec}` (`{packageName}@{version}`) with that release. The value is split on spaces. For arguments with spaces, use the `selfUpdateCommand` setting in `~/.knightcode/agent/settings.json` instead, an argv array such as `["nix", "profile", "upgrade", "knightcode"]`. Project settings cannot set it.

A configured command replaces KnightCode's own update for every install method, including the script installer. Automatic updates then only show the update notice; run `knightcode update` to apply it. After the command exits, `knightcode update` checks the version that `knightcode --version` reports on `PATH` and warns if it is not the new release.

### Aliases and command options

- `knightcode uninstall <source>` is an alias for `knightcode remove <source>`.
- `knightcode update --self`, `knightcode update self`, and `knightcode update knightcode` are aliases for `knightcode update`.
- `knightcode update --extension <source>` is an alias for `knightcode update <source>`.
- `-a`, `--approve` trusts project-local files for one command. `-na`, `--no-approve` ignores trust-gated project-local files.
- Append `-h` or `--help` to a command for its exact usage and option constraints.

## Credential commands

```sh
knightcode auth check --provider openai --json
```

Authentication commands require `--provider <provider>` or `--model <model>`. See [Providers](providers.md) for supported methods.

| Command | Description |
|---|---|
| `knightcode auth check` | Print `ready`, `not_ready`, or `invalid`; exit with status `0`, `1`, or `2`, respectively |
| `knightcode auth print-api-key` | Print the resolved API key |
| `knightcode auth print-bearer-token` | Print a resolved OAuth bearer token |

| Option | Applies to | Description |
|---|---|---|
| `--provider <provider>` | All | Resolve credentials for a provider |
| `--model <model>` | All | Resolve credentials from a model; may be combined with `--provider` |
| `--json` | `auth check` | Write the structured result as JSON |
| `--credentials` | `auth check` | Emit the resolved credential when ready |
| `--no-refresh` | `auth check` | Do not refresh expired OAuth credentials; refresh is the default |
| `--min-expiry <duration>` | `print-bearer-token` | Require remaining token lifetime using `ms`, `s`, `m`, or `h`, such as `30m` |

Credential-printing commands write secrets to stdout.

## App server

`knightcode app-server` hosts many threads in one headless process. It reads
newline-delimited JSON requests from stdin, writes protocol messages to stdout,
and logs to stderr. It exits when stdin closes, unloading sessions and releasing
their locks. See [App Server](app-server.md) for the handshake, threads, approvals,
payload retrieval, and limits.

## MCP commands

These commands work outside a session, so agents can run them through `bash`. See [MCP Servers](mcp.md).

| Command | Description |
|---|---|
| `knightcode mcp add <server> [options] -- <command> [args...]` | Add or replace a stdio server in `mcp.json`; `--env KEY=VALUE` (repeatable) and `--cwd <dir>` set its environment and working directory. Arguments after the command are passed to it |
| `knightcode mcp add <server> [options] --url <url>` | Add or replace a streamable HTTP server; `--header KEY=VALUE` (repeatable), `--bearer-token-env-var <NAME>` (sends `Authorization: Bearer ${NAME}`), `--oauth-client-id`, `--oauth-client-secret`, `--oauth-callback-port`, `--oauth-client-name`, and `--oauth-client-registration` (`auto`, `cimd`, or `dcr`) configure authentication |
| `knightcode mcp remove <server>` | Remove a server from `mcp.json`; stored OAuth credentials are kept |
| `knightcode mcp list [--json]` | Connect to every enabled server and print its state, tools, and errors; exit with `1` when a config entry is invalid or an enabled server is not connected |
| `knightcode mcp login <server> [-l] [--timeout <seconds>]` | Sign in to an OAuth server: open the authorization page and wait for the browser; a terminal also accepts the pasted redirect URL. `--timeout` limits the whole sign-in, including requests to the authorization server (default 300 seconds). `-l` requires the server to be defined in the project's `.knightcode/mcp.json` |
| `knightcode mcp logout <server> [-l]` | Delete the stored OAuth credentials of a server |

`add` and `remove` change `~/.knightcode/agent/mcp.json`, or `.knightcode/mcp.json` in the current directory with `--local` (`-l`). `add` also takes `--exposure <mode>` (see [Exposure](mcp.md#control-tool-exposure)) and `--description <text>` and does not connect; run `knightcode mcp list` to check the server.

Project `.knightcode/mcp.json` files are only read for projects that are already trusted.
