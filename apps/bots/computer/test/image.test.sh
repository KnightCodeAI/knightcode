#!/usr/bin/env bash
# The computer image, end to end: builds it with Docker, starts it, and checks that knightcode-env answers over the
# bridge, that two bot users exist with separate Chrome profiles neither can read or drive across, and that port 25 is
# blocked while ordinary traffic flows. Run from anywhere: bash apps/bots/computer/test/image.test.sh
set -euo pipefail
export MSYS_NO_PATHCONV=1 # Git Bash on Windows would rewrite the container paths below.

# Native paths for docker: Git Bash's `pwd -W` gives C:/..., elsewhere plain pwd.
native() { (cd "$1" && (pwd -W 2>/dev/null || pwd)); }
here="$(cd "$(dirname "$0")" && pwd)"
app="$(native "$here/../..")"
repo="$(native "$here/../../../..")"
image="knightcode-bots-computer:test"
name="kb-computer-test-$$"
token="$(head -c 16 /dev/urandom | od -An -tx1 | tr -d ' \n')"
user_a="bot_00000000000000a1"
user_b="bot_00000000000000b2"

fail() {
	echo "FAIL: $*"
	exit 1
}
pass() { echo "ok: $*"; }

docker build -q -f "$app/computer/Dockerfile" -t "$image" "$repo" >/dev/null
docker run -d --rm --name "$name" -e BRIDGE_TOKEN="$token" -p 127.0.0.1::8080 "$image" >/dev/null
trap 'docker rm -f "$name" >/dev/null 2>&1 || true' EXIT
port="$(docker port "$name" 8080/tcp | head -1 | sed 's/.*://')"
base="http://127.0.0.1:${port}"
for _ in $(seq 1 60); do
	curl -sf "$base/health" >/dev/null && break
	sleep 1
done
curl -sf "$base/health" >/dev/null || fail "the bridge did not start"

bridge() { curl -s -H "x-bridge-token: $token" "$@"; }
in_as() { docker exec "$name" runuser -u "$1" -- "${@:2}"; }

# The bridge refuses requests without its token.
code="$(curl -s -w '
%{http_code}' -X POST "$base/browser?user=$user_a" -d '{"action":"location"}' | tail -1)"
[ "$code" = "403" ] || fail "the bridge answered $code without its token"
pass "the bridge needs its token"

# knightcode-env answers over the bridge, through the real client.
hello="$(cd "$app" && bun computer/test/bridge-check.ts "$base" "$token" "$user_a")" || fail "knightcode-env did not answer"
echo "$hello" | grep -q '"protocol"' || fail "unexpected hello: $hello"
pass "knightcode-env answers over the bridge: $hello"

# Two bot users, each with its own Chrome and profile.
for user in "$user_a" "$user_b"; do
	result="$(bridge -X POST "$base/browser?user=$user" -d '{"action":"navigate","url":"https://example.com/"}')"
	echo "$result" | grep -q '"url":"https://example.com/"' || fail "$user's Chrome did not open the page: $result"
	docker exec "$name" test -d "/home/$user/.config/chromium/Default" || fail "$user has no Chrome profile"
done
[ "$(docker exec "$name" stat -c '%U %a' "/home/$user_a")" = "$user_a 700" ] || fail "$user_a's home is not private"
pass "two bot users with separate Chrome profiles"

# Neither can read the other's profile or drive the other's Chrome.
if in_as "$user_a" ls "/home/$user_b/.config/chromium" >/dev/null 2>&1; then fail "$user_a read $user_b's profile"; fi
debug_b="$(docker exec "$name" bun -e "console.log(9222 + require('/var/lib/kb/sessions.json')['$user_b'])")"
if in_as "$user_a" curl -s --max-time 5 "http://127.0.0.1:$debug_b/json" >/dev/null 2>&1; then
	fail "$user_a reached $user_b's Chrome debugging port"
fi
in_as "$user_b" curl -s --max-time 5 "http://127.0.0.1:$debug_b/json" | grep -q webSocketDebuggerUrl ||
	fail "$user_b cannot reach its own Chrome"
pass "profiles and debugging ports stay with their bot"

# The shared folder is shared.
in_as "$user_a" bash -c 'echo hello > /home/shared/note.txt'
[ "$(in_as "$user_b" cat /home/shared/note.txt)" = "hello" ] || fail "$user_b cannot read the shared folder"
pass "the shared folder is shared"

# Port 25 is blocked; ordinary traffic is not.
# Refused at once by the guard, not merely dropped by whatever network the test runs on.
smtp="$(in_as "$user_a" timeout 10 bash -c 'exec 3<>/dev/tcp/1.1.1.1/25' 2>&1 || true)"
echo "$smtp" | grep -q "Connection refused" || fail "port 25 was not refused: $smtp"
in_as "$user_a" timeout 10 bash -c 'exec 3<>/dev/tcp/1.1.1.1/443' || fail "port 443 is blocked too"
# Every address a pool resolves to is unroutable, for IPv4 and IPv6-first lookups alike.
for lookup in ahosts hosts; do
	resolved="$(docker exec "$name" getent "$lookup" xmr.nanopool.org | awk '{print $1}' | sort -u | paste -sd, -)"
	for address in ${resolved//,/ }; do
		[ "$address" = "0.0.0.0" ] || [ "$address" = "::" ] || fail "mining pools resolve to $resolved ($lookup)"
	done
done
pass "port 25 and mining pools are blocked"

# A save round trip: export, then import into the same computer (relative names: Windows tools read them too).
work="$(mktemp -d)"
cd "$work"
bridge -X POST "$base/export" -o workspace.tgz
tar -tzf workspace.tgz | grep -q "shared/note.txt" || fail "the export lacks the shared folder"
if tar -tzf workspace.tgz | grep -q "SingletonLock"; then fail "the export kept Chrome's lock files"; fi
bridge -X POST --data-binary @workspace.tgz "$base/import" | grep -q ok || fail "the import failed"
cd - >/dev/null
rm -rf "$work"
pass "the workspace exports without caches and imports back"

echo "IMAGE TEST PASSED"
