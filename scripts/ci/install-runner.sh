#!/usr/bin/env bash
# Run in the dedicated Linux CI guest. Never pass a registration token as an argument.
set -euo pipefail
usage() { echo 'Usage: bash install-runner.sh PROJECT VERSION SHA256 [NAME] [--plan]'; }
[[ $# -ge 3 && $# -le 5 ]] || { usage >&2; exit 2; }
repo=$1; version=$2; checksum=$3; name=${4:-"$(hostname)-${repo,,}"}
case "$repo" in Sandline|Hundred-Acre-Learning|Gunball) ;; *) usage >&2; exit 2;; esac
[[ $version =~ ^2\.[0-9]+\.[0-9]+$ && $checksum =~ ^[0-9a-fA-F]{64}$ ]] || { echo 'Use the version and SHA-256 from GitHub Settings > Actions > Runners > New runner > Linux x64' >&2; exit 2; }
[[ $name =~ ^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$ ]] || { echo 'Invalid runner name' >&2; exit 2; }
directory="$HOME/project-ci-runners/$repo/$name"
url="https://github.com/actions/runner/releases/download/v$version/actions-runner-linux-x64-$version.tar.gz"
if [[ ${5:-} == --plan ]]; then printf 'Repo: JoshuaLRay/%s\nDirectory: %s\nArchive: %s\nLabel: project-ci\n' "$repo" "$directory" "$url"; exit 0; fi
[[ $# -le 4 ]] || { usage >&2; exit 2; }
(( EUID != 0 )) || { echo 'Run as the dedicated non-root CI user' >&2; exit 1; }
bash "$(dirname "$0")/preflight.sh" "$repo"
[[ $(ps -p 1 -o comm=) == systemd ]] || { echo 'Enable systemd in the dedicated CI guest first' >&2; exit 1; }
[[ ! -e $directory ]] || { echo 'Runner directory already exists; inspect its service instead of replacing registration' >&2; exit 1; }
umask 077
archive=$(mktemp)
trap 'rm -f "$archive"; unset token' EXIT
curl --fail --location --proto '=https' --tlsv1.2 "$url" --output "$archive"
printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status || { echo 'Runner checksum mismatch; nothing extracted' >&2; exit 1; }
mkdir -p "$directory"
tar -xzf "$archive" -C "$directory"
cd "$directory"
sudo ./bin/installdependencies.sh
set +x
printf 'Paste the short-lived registration token for JoshuaLRay/%s (hidden): ' "$repo" >/dev/tty
read -r -s token </dev/tty
printf '\n' >/dev/tty
[[ -n $token ]] || { echo 'Empty registration token' >&2; exit 1; }
ACTIONS_RUNNER_INPUT_TOKEN="$token" ./config.sh --unattended --url "https://github.com/JoshuaLRay/$repo" --name "$name" --labels project-ci --work _work
unset token
sudo ./svc.sh install "$(id -un)"
sudo ./svc.sh start
echo 'Registered. Verify Online in repository runner settings before activation.'
