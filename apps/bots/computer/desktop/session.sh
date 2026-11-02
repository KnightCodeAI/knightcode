#!/bin/bash
# One bot's desktop, run as that bot's OS user: an Xvfb display, a window manager, and a VNC server bound to loopback
# (the bridge carries it to the Worker's screen proxy). Usage: session.sh <display number> <vnc port>
set -euo pipefail
display="$1"
vnc_port="$2"

Xvfb ":${display}" -screen 0 1280x800x24 -nolisten tcp -ac &
for _ in $(seq 1 50); do
	[ -S "/tmp/.X11-unix/X${display}" ] && break
	sleep 0.1
done
export DISPLAY=":${display}"
openbox &
x11vnc -display ":${display}" -rfbport "${vnc_port}" -localhost -forever -shared -nopw -quiet -noxdamage &
wait
