#!/bin/bash
# One bot's desktop, run as that bot's OS user: an Xvfb display, a window manager, and a VNC server bound to loopback
# (the bridge carries it to the Worker's screen proxy). Usage: session.sh <display number> <vnc port>
# The display takes only clients holding its cookie, which lives in the bot's own home (mode 600): another bot's user
# cannot open it through the shared X11 socket.
set -euo pipefail
display="$1"
vnc_port="$2"
export XAUTHORITY="${XAUTHORITY:?the bridge sets XAUTHORITY}"

umask 077
rm -f "${XAUTHORITY}"
cookie="$(od -An -tx1 -N16 /dev/urandom | tr -d ' \n')"
xauth -q -f "${XAUTHORITY}" add ":${display}" MIT-MAGIC-COOKIE-1 "${cookie}"
Xvfb ":${display}" -screen 0 1280x800x24 -nolisten tcp -auth "${XAUTHORITY}" &
for _ in $(seq 1 50); do
	[ -S "/tmp/.X11-unix/X${display}" ] && break
	sleep 0.1
done
export DISPLAY=":${display}"
openbox &
x11vnc -display ":${display}" -auth "${XAUTHORITY}" -rfbport "${vnc_port}" -localhost -forever -shared -nopw -quiet -noxdamage &
wait
