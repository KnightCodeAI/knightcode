# Plugins

KnightCode installs Claude Code and Grok Build plugins. A plugin's skills, slash commands, and MCP servers work in KnightCode; its hooks, agents, LSP servers, and output styles are listed but never run.

Plugins sit next to [KnightCode packages](packages.md), which remain the way to ship KnightCode extensions. A plugin delivers files only: KnightCode never runs `npm install`, a lifecycle script, or anything else a plugin ships until you trust the plugin.

## Quick setup

Install a plugin from GitHub, a Git URL, or a local folder:

```bash
knightcode plugin install acme/review-tools
knightcode plugin install https://git.example.com/team/plugins.git --path plugins/lint
knightcode plugin install ./my-plugin
```

In a terminal, `install` shows what the plugin will run and asks whether to trust it. Pass `--trust` to skip the question. Without a terminal and without `--trust`, the plugin is installed but inactive until you run:

```bash
knightcode plugin enable review-tools --trust
```

Start KnightCode, or run `/reload` in a running session. The plugin's commands appear as `/<plugin>:<command>`, for example `/review-tools:review src/app.ts`.

Use `/plugins` in an interactive session to browse installed plugins and marketplace catalogs, trust, install, enable, disable, update, and uninstall them, and reload. The desktop app has the same controls under **Settings › Plugins**.

## Marketplaces

A marketplace is a repository or folder with a plugin catalog. Adding one installs nothing:

```bash
knightcode plugin marketplace add acme/plugin-marketplace
knightcode plugin marketplace list
knightcode plugin install review-tools@acme-plugins
```

`marketplace update` fetches the catalogs again; `plugin update` then picks up the new entries. Removing a marketplace leaves the plugins installed from it installed. KnightCode has no default marketplace.

## Commands

```text
knightcode plugin install <source|name@marketplace> [--ref <ref>] [--path <dir>] [-l] [--trust]
knightcode plugin list [--json]
knightcode plugin details|enable|disable|update|uninstall <plugin> [-l]
knightcode plugin validate <path>
knightcode plugin marketplace add <source> [--ref <ref>] [-l]
knightcode plugin marketplace list [--json]
knightcode plugin marketplace update [<name>]
knightcode plugin marketplace remove <name> [-l]
```

- `<plugin>` is the plugin's name, `name@marketplace`, or the full identity that `list --json` prints. A name that matches several plugins is an error that lists them.
- `-l` or `--local` uses the current project's `.knightcode/settings.json` instead of your user settings. The project must already be [trusted](security.md#understand-project-trust).
- `--ref` pins a branch, tag, or full commit SHA. A pinned tag or commit stays pinned: `update` fetches the same ref again.
- `validate` reads a plugin folder and prints what it offers and the compatibility warnings, without installing anything.

## Trust

A plugin runs nothing until you trust it. The confirmation lists the commands and URLs of its MCP servers, the environment variables its MCP configuration reads, and the components KnightCode will not run. Trust belongs to the plugin's identity (its source, subdirectory, and catalog entry) and carries across updates; `update` prints the new inventory.

A plugin declared in a project's settings needs both plugin trust and [project trust](security.md#understand-project-trust). Trust is never read from repository files.

A trusted, enabled plugin's stdio MCP servers start when a session starts, like servers in `mcp.json`.

## Where plugins live

| What | Where |
| --- | --- |
| What you want installed (`plugins`, `pluginMarketplaces`) | `settings.json`, user or project; see [Settings](settings.md) |
| Install records and trust | `~/.knightcode/agent/plugins/state.json` |
| Installed content, one immutable directory per revision | `~/.knightcode/agent/plugins/cache/<id>/<revision>/` |
| Plugin data (`${CLAUDE_PLUGIN_DATA}`), kept on uninstall | `~/.knightcode/agent/plugins/data/<id>/` |

```json
{
  "plugins": [
    { "source": "acme/review-tools", "ref": "v1.2.0" },
    { "source": "lint@acme-plugins", "enabled": false }
  ],
  "pluginMarketplaces": [{ "name": "acme-plugins", "source": "acme/plugin-marketplace" }]
}
```

A project that declares a plugin it has not installed on this machine reports it at session start with the install command; sessions never fetch or update sources. Running sessions keep the revision they loaded. Old revisions are not removed automatically.

## Authoring

A plugin is a folder with a manifest, or without one when it has `skills/`, `commands/`, or `.mcp.json`:

```text
my-plugin/
  .claude-plugin/plugin.json   # or .grok-plugin/plugin.json, or plugin.json
  skills/fix-tests/SKILL.md
  commands/review.md
  .mcp.json
```

KnightCode reads the first of `plugin.json`, `.grok-plugin/plugin.json`, and `.claude-plugin/plugin.json`; the others are ignored. The manifest's `skills` and `commands` fields replace the conventional folders, and an empty array means none. `mcpServers` takes a path, an inline map, or an array of both; later definitions win, and an inline map does not hide `.mcp.json`. Component paths must stay inside the plugin folder.

The plugin's name becomes a namespace: lowercase, characters outside `a-z`, `0-9` and `-` replaced by `-`, at most 64 characters. Skills are named `<plugin>:<skill>`.

KnightCode replaces these tokens in skill and command files when the plugin is installed: `${CLAUDE_PLUGIN_ROOT}` and `${GROK_PLUGIN_ROOT}` (the installed folder), `${CLAUDE_PLUGIN_DATA}` and `${GROK_PLUGIN_DATA}`, and in skills `${CLAUDE_SKILL_DIR}` and `${SKILL_DIR}`. A skill without a `description` gets one from its first paragraph or heading. Other files a skill references are not rewritten.

## Compatibility

| Feature | Supported | Notes |
| --- | --- | --- |
| Skills | Yes | Loaded from the exact files the plugin declares. `user-invocable: false` keeps a skill out of the slash commands. |
| Commands | Yes | Files, folders (subfolders join with `:`), and inline `{ "content": … }` records. |
| MCP servers | Yes | stdio and streamable HTTP, through the [MCP support](mcp.md). |
| Hooks, agents, LSP servers, output styles, `userConfig`, `dependencies` | No | Listed as unsupported; the rest of the plugin works. |
| `` !`cmd` `` shell preprocessing | No | Left as text, with a warning. |
| `allowed-tools`, `model`, `effort`, `context`, `agent`, `hooks`, `shell` frontmatter | No | Ignored, with a warning. A `model` is never mapped to a KnightCode model. |
| `${CLAUDE_SESSION_ID}`, `${SESSION_ID}`, `${user_config.*}` | No | Left as text, with a warning. |
| Marketplace sources | Partly | Relative paths, `local`, `github`, `url`, and `git-subdir`. `npm`, `pip`, and other kinds are reported as unsupported. |

### Arguments

`/<plugin>:<command> args` and `/<plugin>:<skill> args` follow Claude Code's rules:

- Arguments split like a shell: single and double quotes group words, `target\ file.ts` is one argument, `$VAR` stays as written, and shell operators such as `|` and `&&` are dropped.
- `$0`, `$1`, and `$ARGUMENTS[N]` are 0-indexed. `$name` fills from the `arguments` frontmatter in order. `$ARGUMENTS` is the whole argument string.
- Without any placeholder, non-empty arguments are appended as `ARGUMENTS: <args>`.

Grok Build splits arguments on whitespace instead, so `"two words"` is one argument in KnightCode and two in Grok Build. KnightCode's own [prompt templates](prompt-templates.md) keep their 1-indexed `$1` and `$@`.

The native `/skill:<plugin>:<skill> args` also works, with native semantics: the arguments follow the skill, unsubstituted.

### MCP configuration

Plugin servers are named `plugin_<plugin>_<server>`, so their tools are `mcp__plugin_<plugin>_<server>__<tool>` with `-` turned into `_`. Skills and commands that name their own plugin's tools in Claude Code's form are rewritten to these names at install. A server with the same name in `mcp.json` overrides the plugin's.

| Field | Handling |
| --- | --- |
| `command`, `args`, `cwd`, `url`, `oauth` (except `clientSecret`) | Expanded when the session starts: plugin paths, `${VAR}`, `${VAR:-default}`. A missing variable leaves the server out with a warning. |
| `env`, `headers`, `oauth.clientSecret` | `${VAR}` is resolved when the server connects, so secrets stay out of the registered config. `${VAR:-default}` and plugin paths are resolved at start. Values never run as commands. |
| stdio environment | `CLAUDE_PLUGIN_ROOT`, `CLAUDE_PLUGIN_DATA`, `GROK_PLUGIN_ROOT`, and `GROK_PLUGIN_DATA` are added. |
| Grok `urlTemplate`, `url_template` | Become `url`. |
| Grok `bearer_token_env_var` | Becomes `Authorization: Bearer ${VAR}`. |
| Grok `oauth_client_id`, `oauth_client_secret_env_var`, `oauth_scopes` | Become `oauth.clientId`, `oauth.clientSecret`, and a space-separated `oauth.scope`. |
| `bearer_token_file`, `setup`, `headersHelper`, `oauth.xaa` | Not implemented: the server is not registered and no sign-in is attempted. |
| `auth.provider` | Rejected: it would send KnightCode provider credentials. |
| `type: "sse"`, `type: "ws"` | Not supported. |

Two plugin servers whose names differ only in `-` and `_` would share tool names; both are left out with a warning. Tool names long enough to get KnightCode's hash suffix do not match the rewritten names in skills.

### Flags

- `--no-extensions` turns off every plugin resource.
- `--no-mcp` leaves plugin MCP servers out with the rest of MCP support.
- `--no-skills` and `--no-prompt-templates` do not hide plugin skills or commands.
