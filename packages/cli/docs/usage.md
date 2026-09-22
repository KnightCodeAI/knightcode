# Use KnightCode in the terminal

Run `knightcode` from the folder you want to work in. KnightCode uses that folder to discover files, instructions, and configuration, and to group saved sessions. If you have not installed KnightCode or chosen a model yet, follow the [Quickstart](quickstart.md).

KnightCode may ask whether you trust the working folder before loading its project resources. See [Project trust](security.md#understand-project-trust).

<p align="center"><img src="images/interactive-mode.png" alt="KnightCode interactive mode showing a conversation, editor, and status information" width="750"></p>

The transcript shows your prompts, KnightCode's responses, tool calls, results, and errors. You write prompts and commands in the editor. The footer shows the current folder, session, model, context usage, and accumulated usage and cost.

## Enter a prompt

Type a request and press `Enter` to send it. Use `Shift+Enter` to add a line, or press `Ctrl+G` to work on a longer prompt in your configured external editor.

To include files or images:

- Type `@` to search for a file and add it to your prompt.
- Press `Tab` to complete a path.
- Paste an image or drag it into a compatible terminal.

## Follow KnightCode's work

KnightCode shows each tool call and result while it works. Press `Ctrl+O` to expand or collapse tool output. Press `Ctrl+T` to show or hide thinking blocks.

The startup header lists the instructions and resources KnightCode loaded. The editor border indicates the current thinking level. The footer updates as the model uses context and reports usage.

KnightCode does not ask before every tool call. Review commands and changed files, and use a sandbox for untrusted or unattended work. See [Security](security.md).

## Change direction

You can send more input while KnightCode is working:

| What you want | Action |
|---|---|
| Adjust the current task | Type a message and press `Enter` |
| Add work after the current task | Type a message and press `Alt+Enter` |
| Return queued messages to the editor | Press `Alt+Up` |
| Stop the current task | Press `Escape` |

A message sent with `Enter` waits until the current response and its tool calls finish, then guides the next response. A follow-up sent with `Alt+Enter` waits until KnightCode finishes the current task. Aborting returns queued messages to the editor.

Windows Terminal reserves some Alt shortcuts. See [Terminal Setup](terminal-setup.md) for the Windows alternatives.

## Change the model or settings

Type `/` to search the available commands. The commands you will use most often are:

- `/model` selects a model. Press `Ctrl+L` to open the same selector.
- `/thinking` selects how much reasoning the current model uses. Press `Shift+Tab` to cycle through supported levels.
- `/login` and `/logout` manage provider access.
- `/settings` changes common preferences.
- `/tools` turns the [web tools](#web-tools) and the [scratchpad](#scratchpad) off, on for this session, or on by default.

Prompt templates, skills, and extensions can add more commands to the same menu. See [Choose a Model](models.md), [Configuration](configuration.md), or the complete [Slash Commands reference](slash-commands.md).

## Continue or start over

KnightCode saves sessions automatically unless session persistence is disabled.

- `/new` starts a new session.
- `/resume` opens another saved session.
- `/name` gives the current session a recognizable name.
- `/session` shows its file, ID, message count, token usage, and cost.
- `/undo` goes back to an earlier user message and can restore the files edited after it.

Use `/tree`, `/fork`, or `/clone` when you want to explore another approach without losing existing work. Use `/compact` to reduce the conversation history sent to the model. See [Sessions and Context](sessions.md) for these workflows.

After leaving KnightCode, run `knightcode --continue` from the same folder to resume its most recent session.

## Run a terminal command

Prefix a command with `!` to run it and include its output in the conversation:

```text
!git status
```

Use `!!` when you want to run a command without sending its output to the model.

## Web Tools

Two tools give the agent read access to the web. Both ship disabled; turn them on with `/tools`.

| Tool | What it does |
|------|--------------|
| `webfetch` | Fetches a URL and returns the page as markdown, 400 lines at a time. The agent pages with `offset`/`limit` like `read`, or passes `grep` to get only matching lines. Responses are cached for 15 minutes, capped at 5 MB, and time out after 30 seconds. Private, loopback, and link-local addresses are refused. |
| `websearch` | Searches the web and returns up to 10 results (default 5) as title, URL, and snippet. DuckDuckGo needs no key but may rate-limit; Brave Search needs an API key. |

`/tools` lists each tool with its current state; pick one to open its settings panel. **Status** cycles through three states:

| State | Effect |
|-------|--------|
| Disabled | The tool is not offered to the model |
| Enabled for this session | On until knightcode exits, including across `/new`, `/resume`, and `/fork`; nothing is written to disk |
| Enabled by default | On in every session |

The `websearch` panel adds two rows: **Provider** (`duckduckgo` or `brave`) and **Brave API key**. Choosing Brave without a stored key opens the key prompt at once. Get a key at https://brave.com/search/api/; the free plan is enough. The key is also read from `BRAVE_API_KEY` when none is stored, but the provider only switches to Brave when you pick it. Keys show masked in the panel.

The same changes work without the panel:

```bash
/tools websearch on        # this session
/tools webfetch always     # every session
/tools webfetch off
```

Settings are stored in `~/.knightcode/agent/tools.json`, owner-readable only because it can hold the Brave key. `--tools` and `--exclude-tools` still apply: a tool excluded on the command line stays off whatever `/tools` says.

Fetched pages and search results are marked as untrusted in the tool output so the model treats instructions inside them as data, but treat the tools like any other network access: a fetched page can still influence what the agent does next.

## Scratchpad

`/tools scratchpad on` gives each session a private working directory under the system temp directory (`<tmp>/knightcode-<uid>/scratchpad/<session-id>`, or `<tmp>\knightcode\scratchpad\<session-id>` on Windows). The system prompt names it and asks the agent to put throwaway scripts and intermediate output there instead of in your project.

The agent keeps its working notes there in `notes.md`: task list, decisions, `file:line` facts, next steps. After each compaction the first 8 KB of `notes.md` is put back into the context once, so those notes outlive the summary. Open the file to see what the agent is tracking.

The scratchpad is off by default. When on, it adds about 60 tokens to the system prompt, which is cached; the notes cost tokens only after a compaction. It is not a tool, so `--tools` and `--exclude-tools` do not affect it. `/fork` starts a new, empty directory, and the operating system clears old ones with the rest of its temp files. If `<tmp>/knightcode-<uid>` already exists but is not a private directory you own, as when another user on a shared machine created it first, the scratchpad stays off and KnightCode reports why.

## Copy, export, or share results

Press `Ctrl+X` or run `/copy` to copy the last assistant response. Use `/export` to save the session as HTML or JSONL.

Use `/share` to upload the session and get a viewer link. With Radius authentication, the artifact is visible to your Radius organization. Otherwise, KnightCode creates a private GitHub gist through the GitHub CLI. Review the session first because it can contain prompts, tool output, file contents, and credentials exposed during the conversation.

## Adjust the terminal

Regular mode uses the terminal's normal scrollback. Fullscreen mode keeps the editor and status area fixed while the transcript scrolls within the terminal window. Choose a mode through `/settings` or `--tui-mode`.

Terminal support for mouse input, keyboard shortcuts, and inline images varies. See [Terminal Setup](terminal-setup.md) for platform-specific configuration and [Keybindings](keybindings.md) for every configurable shortcut. Run `/hotkeys` to inspect the shortcuts active in your current session.

## Collect diagnostic information

When troubleshooting terminal rendering or conversation state, run `/debug`. KnightCode writes the rendered terminal lines and current session messages to `knightcode-debug.log` in your [agent directory](configuration.md#agent-directory).

Review this file before sharing it. It can contain prompts, model responses, tool output, file contents, and terminal data.
