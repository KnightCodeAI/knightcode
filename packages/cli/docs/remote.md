# Remote sessions

`/remote` publishes the session running in your terminal to the web, so you can
watch it and reply from another device. The terminal keeps working normally.

## Getting started

Run `/remote`. The first time, a sign-in screen opens your browser on the
approval page and shows an eight-character code: sign in with GitHub, check the
page shows the same code, and approve. Escape cancels. The credential is stored
in `~/.knightcode/remote-auth.json` and reused afterwards, and the screen also
prints the URL for a headless box where nothing launched. Once the browser
approves, the screen confirms it and continues on enter, or by itself a few
seconds later.

Once signed in, `/remote` prints a link. You do not have to copy it: open
<https://remote.knightcode.dev> on your phone and the session appears in the
list.

## The web app

The list shows every session you have published, newest first, with its state:
**Working** while a turn is running in the terminal, **Connected** while the
terminal is attached and idle, **Disconnected** once it has gone. Filter it to
active or past sessions from the menu on the right.

Open a session to read the transcript. Runs of tool calls are folded into one
line such as _Ran 2 commands, created a file_; tap it to list the calls, and
tap a call to see what it did — the command and its output, the file and its
content, the diff an edit made.

The composer sends replies to the terminal. Type `/` to list the slash commands
the terminal can run from a message: extension commands, skills and prompt
templates. Built-in commands that open a terminal UI, such as `/model`, are not
offered.

The menu in the session's top-right corner copies the link or deletes the
session from the relay.

## Commands

| Command | Effect |
| --- | --- |
| `/remote` | Toggle publishing: start and print the link, or pause. Pausing keeps the room readable, and the next `/remote` resumes the same link |
| `/remote status` | Show the link and how many viewers are connected |
| `/remote stop` | Stop publishing and delete the room |
| `/remote logout` | Revoke the stored account credential and delete it locally |

`/remote` runs in the interactive terminal only. In `--print`, RPC and JSON
modes it reports that and does nothing.

## What the remote can and cannot do

A viewer can read the transcript, send prompts, run the slash commands listed
above, and stop the current turn. Prompts arrive as ordinary user messages and
appear in your terminal; `/remote` itself is never offered to a viewer.

A viewer cannot end your session, quit KnightCode, switch sessions, or change
model. Closing the browser tab, losing signal, or losing the relay does nothing
to the terminal. Your session ends only when you end it.

If the relay becomes unreachable the command does not fail: it reconnects with
backoff indefinitely, the footer shows `remote retrying`, and the agent carries
on working.

## Privacy and retention

Room contents pass through and are briefly stored by the relay so a device that
reconnects can catch up. That includes tool output, which can contain secrets if
a command prints them. Nothing is redacted: anything visible in your terminal is
visible in the room while it lives. Only the account that created a room can
read it.

A room stays readable as a past session for 30 days after the terminal
disconnects, and is deleted then, on `/remote stop`, or when you delete it from
the web app. Stored history is capped at 8 MB per room; older content is
dropped as the session grows. Images are not mirrored in either direction — an
image in the transcript appears as a placeholder recording its type and size.

## Configuration

| Environment variable | Default | Effect |
| --- | --- | --- |
| `KNIGHTCODE_REMOTE_RELAY` | `https://remote.knightcode.dev` | Relay origin to publish to |
| `KNIGHTCODE_REMOTE_CONFIG_DIR` | `~/.knightcode` | Directory holding `remote-auth.json` |

`/remote` refuses to start when `KNIGHTCODE_OFFLINE` is set.
