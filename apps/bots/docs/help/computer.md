# The computer

Each account has one cloud computer that its bots share, each bot as its own
user with its own browser profile. It wakes when a bot needs it and sleeps after
ten idle minutes; open tabs and sign-ins come back when it wakes.

- Computer time is metered in five-minute blocks. At your spending limit the
  computer stops; chat keeps working.
- Take control lets you use a bot's screen yourself; Teach a task records you
  doing a task so the bot can write it up as a skill.
- Home connection routing sends the computer's web traffic out through your own
  connection, through the desktop app or a Tailscale exit node.
- In the desktop app, "Let bots use this computer" lets bots run commands on
  your own PC. The app asks before the first command in each session.
