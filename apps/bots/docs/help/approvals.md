# Approvals

Before a bot changes something outside its chat (sends mail, posts, pays, edits
a file in an app), it follows your approval mode:

- Never ask: it acts on runs you started, and within a routine's standing grant.
- Auto: a reviewer model you choose lets on-task, undoable actions through and
  asks about the rest.
- Ask: it asks before every change.

Allow and Block lists hold exact tools or sites. Blocked actions are refused in
every mode. Text from outside (email, webhooks, other people's messages, web
pages, other bots) can never widen what a bot may do; such runs act only within
their routine's grant and ask about anything else. An approval covers one exact
action, once.
