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

## Commands

| Command | Effect |
| --- | --- |
| `/remote` | Publish this session and print its link |
| `/remote status` | Show the link and how many viewers are connected |
| `/remote stop` | Stop publishing and delete the room |
| `/remote logout` | Revoke the stored account credential and delete it locally |

`/remote` runs in the interactive terminal only. In `--print`, RPC and JSON
modes it reports that and does nothing.

## What the remote can and cannot do

A viewer can read the transcript, send prompts, and stop the current turn.
Prompts arrive as ordinary user messages and appear in your terminal.

A viewer cannot end your session, quit KnightCode, switch sessions, change
model, or run slash commands. Closing the browser tab, losing signal, or losing
the relay does nothing to the terminal. Your session ends only when you end it.

If the relay becomes unreachable the command does not fail: it reconnects with
backoff indefinitely, the footer shows `remote retrying`, and the agent carries
on working.

## Privacy and retention

Room contents pass through and are briefly stored by the relay so a device that
reconnects can catch up. That includes tool output, which can contain secrets if
a command prints them. Nothing is redacted: anything visible in your terminal is
visible in the room while it lives. Only the account that created a room can
read it.

A room is deleted 24 hours after the terminal disconnects, or immediately on
`/remote stop`. Stored history is capped at 8 MB per room; older content is
dropped as the session grows. Images are not mirrored in either direction — an
image in the transcript appears as a placeholder recording its type and size.

## Configuration

| Environment variable | Default | Effect |
| --- | --- | --- |
| `KNIGHTCODE_REMOTE_RELAY` | `https://remote.knightcode.dev` | Relay origin to publish to |
| `KNIGHTCODE_REMOTE_CONFIG_DIR` | `~/.knightcode` | Directory holding `remote-auth.json` |

`/remote` refuses to start when `KNIGHTCODE_OFFLINE` is set.
