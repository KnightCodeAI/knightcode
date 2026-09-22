# Run KnightCode on Android with Termux

KnightCode runs on Android through [Termux](https://termux.dev/), a terminal emulator and Linux environment. Text input, file tools, and shell commands are supported. KnightCode can copy and paste text through the Android clipboard with Termux:API. Clipboard image paste is not supported.

## Before you begin

Install Termux from [GitHub or F-Droid](https://github.com/termux/termux-app#installation). Do not use the deprecated Google Play build.

[Termux:API](https://github.com/termux/termux-api#installation) is optional. Install it only when you want KnightCode to copy or paste Android clipboard text, or when shell commands need Android device APIs.

## Install KnightCode

1. Update Termux packages:

   ```bash
   pkg update && pkg upgrade
   ```

2. Install Node.js and Git:

   ```bash
   pkg install nodejs git
   ```

3. Install KnightCode:

   ```bash
   npm install -g --ignore-scripts @knightcodeai/cli
   ```

4. Verify the installation:

   ```bash
   knightcode --version
   ```

5. Open the folder you want to work in and start KnightCode:

   ```bash
   cd /path/to/working-folder
   knightcode
   ```

Continue with the main [Quickstart](quickstart.md#3-choose-a-model) to connect a model and run your first task.

## Access Android shared storage

Termux cannot access shared Android storage until you grant permission. Run this once:

```bash
termux-setup-storage
```

After approval, Android shared storage is available under `/storage/emulated/0` and through the links Termux creates under `~/storage/`.

Only grant this permission when KnightCode should be able to access those files. Commands and tools running in Termux use the same storage permissions as the Termux process.

## Use clipboard commands

KnightCode uses `termux-clipboard-set` to copy text and `termux-clipboard-get` for its clipboard-paste shortcut. Shell commands can use both commands directly. Install the Termux:API app and its command-line package:

```bash
pkg install termux-api
```

Verify the integration:

```bash
printf 'KnightCode clipboard test' | termux-clipboard-set
termux-clipboard-get
```

The second command should print `KnightCode clipboard test`.

The Termux clipboard API supports text only. KnightCode's clipboard-paste shortcut inserts that text into the editor but cannot attach clipboard images.

## Add Termux-specific instructions

KnightCode detects that it is running in Termux, but it cannot infer how you want it to interact with Android. Add only the environment details relevant to your work to `~/.knightcode/agent/AGENTS.md`:

````markdown
# Termux environment

- KnightCode runs in Termux on Android.
- Shared Android storage is under `/storage/emulated/0`.
- Open URLs with `termux-open-url "https://example.com"`.
- Open files with `termux-open <path>`.
- Do not access shared storage unless the task requires it.
````

Run `/reload` after changing the file during an active session.

## Troubleshooting

### Clipboard integration fails

Confirm that you installed both components:

1. The Termux:API Android app from the same source as Termux
2. The `termux-api` command-line package

Then run the clipboard verification commands above outside KnightCode. If they fail there, fix the Termux:API installation before retrying KnightCode's copy command.

### Shared storage reports permission denied

Run `termux-setup-storage`, approve the Android permission request, and retry the path under `~/storage/` or `/storage/emulated/0`.

### KnightCode is not found after installation

Open a new Termux shell and run:

```bash
npm prefix -g
command -v knightcode
```

Confirm that the global npm binary directory is on `PATH`, then reinstall KnightCode if the package is missing.
