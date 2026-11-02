#!/bin/bash
# Runs the owner's setup script (for example `apt-get install` of the tools their bots need) as root, on every fresh
# computer and after Update. The bridge calls it with the script's path; its output goes back to the Worker.
# Usage: setup.sh <script>
set -uo pipefail
script="$1"
export DEBIAN_FRONTEND=noninteractive
cd /home/shared
exec timeout 900 bash "$script"
