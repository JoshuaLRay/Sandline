#!/usr/bin/env bash
set -euo pipefail
case "${1:-}" in Sandline|Hundred-Acre-Learning|Gunball) repo=$1;; *) echo 'Expected project name' >&2; exit 2;; esac
[[ $(uname -s) == Linux && $(uname -m) == x86_64 ]] || { echo 'Requires Linux x64' >&2; exit 1; }
for command in git curl python3 timeout tar sudo flock; do
  command -v "$command" >/dev/null || { echo "Missing $command" >&2; exit 1; }
done
sudo -n true || { echo 'Browser dependency installation needs noninteractive sudo in the dedicated CI guest' >&2; exit 1; }
case "$PWD" in /mnt/*) echo 'Use the Linux filesystem, not a Windows-mounted checkout' >&2; exit 1;; esac
available=$(df -Pk . | awk 'NR==2 {print $4}')
(( available >= 10*1024*1024 )) || { echo 'Need at least 10 GiB free in the CI guest' >&2; exit 1; }
if [[ $repo == Gunball ]]; then
  command -v docker >/dev/null
  docker info >/dev/null || { echo 'Docker daemon must be accessible to the runner user' >&2; exit 1; }
fi
echo "PASS $repo runner prerequisites; $(getconf _NPROCESSORS_ONLN) logical CPUs; $(df -h . | tail -1 | awk '{print $4}') free"
