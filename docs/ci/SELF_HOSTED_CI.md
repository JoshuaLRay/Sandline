# Shared CI on the owner's Windows PC

Status: repository support prepared; Windows installation, live runner registration
and first successful runs remain pending. Do not call this infrastructure active
until an actual job runs on the PC and every required check succeeds.

## Design

One dedicated Ubuntu 24.04 x64 Linux guest on the Windows PC can serve **Sandline,
Hundred-Acre-Learning and Gunball**. A separate game or infrastructure repository
is unnecessary. Personal-account repositories require separate repository-scoped
runner registrations: create three services, with separate directories under
`~/project-ci-runners`, all carrying the custom label `project-ci`. The identical
setup tools in each repository can register any of the three.

Start with **one runner per repository**, not multiple runners in one directory.
The PC can execute up to three jobs concurrently; one repository's additional
matrix jobs queue. This avoids promising the hosted fleet's parallel throughput.
Add Sandline capacity only after measuring CPU/RAM and isolating each worker's
directory. Keep Gunball at one worker because its Docker smoke uses a fixed
container name and host port. More runners do not create more hardware capacity.

The recommended starting capacity is 8 logical CPUs, 16–32 GiB RAM and 100 GiB
free SSD space across the Linux guest; these are planning figures, not measured
acceptance. A smaller machine may need jobs serialized across repositories.
The runner preflight requires Linux x64, 10 GiB free, noninteractive sudo for
browser packages, and Docker access for Gunball. Node 22/pnpm/Bun and test browser
versions remain pinned by the existing workflows.

Self-hosted execution does not consume GitHub-hosted minutes. Electricity,
hardware, artifact/cache storage, GitHub availability and PC uptime still matter.
No payment method, budget, repository visibility or release approval is changed.

## 1. Prepare a dedicated Linux guest

Use a dedicated Ubuntu VM if Windows virtualization is already configured.
Alternatively, use WSL2 on a supported Windows 10/11 PC. First run in PowerShell:

```powershell
wsl --status
wsl --list --verbose
wsl --list --online
```

If Ubuntu-24.04 is **not already used for personal work**, install it in an
administrator PowerShell terminal, then reboot if Windows requests it:

```powershell
wsl --install -d Ubuntu-24.04
```

Do not convert an existing personal distro into a privileged runner. If it already
exists, use a separate imported distro (`wsl --import` with `--version 2`) or a
dedicated VM. Create a non-root `ci` Linux user on the new guest. Verify WSL version
2 with `wsl --list --verbose`. Keep checkouts on the Linux filesystem, not `/mnt/c`.

In this **dedicated guest only**, configure `/etc/wsl.conf` with systemd enabled,
Windows drive automount disabled and Windows process interoperability disabled:

```ini
[boot]
systemd=true
[automount]
enabled=false
mountFsTab=false
[interop]
enabled=false
appendWindowsPath=false
```

Preserve any required existing settings; do not overwrite another distro's file.
Restart only this guest with `wsl --terminate Ubuntu-24.04`, then reopen it.
These settings reduce accidental Windows access; WSL is not an adversarial-code
security boundary. Only trusted code belongs on this PC.

In Ubuntu, install the prerequisites and Docker from Ubuntu's package repository:

```bash
sudo apt-get update
sudo apt-get install -y git curl python3 nodejs util-linux docker.io
sudo systemctl enable --now docker
sudo usermod -aG docker ci
```

Log out/in to refresh group membership. Use `sudo visudo -f /etc/sudoers.d/project-ci`
to grant this dedicated guest's `ci` user `ci ALL=(ALL) NOPASSWD: ALL`, then validate
with `sudo visudo -c`. This allows the current browser dependency installs; Docker
membership and sudo are effectively root access **inside this trusted guest**.
Do not grant this on a personal/general-purpose Linux environment. Verify:

```bash
sudo -n true
docker info
```

Bring a reviewed checkout containing these scripts into the Linux filesystem. If
you use GitHub CLI to clone inside the guest, **log out and remove owner-level
credentials before starting runner services**. Runner jobs use their own limited
GitHub token. Keep owner administration credentials on Windows, outside the guest.

## 2. Register the three services

For each repository, open **Settings → Actions → Runners → New self-hosted runner**
and select **Linux / x64**. Copy the current runner version and SHA-256 from that
page. The installer downloads only the official Actions runner release and verifies
the supplied SHA before extraction. It prompts for that repository's short-lived
registration token without echoing it or putting it in shell history.

```bash
bash scripts/ci/install-runner.sh Sandline VERSION SHA256 pc-sandline
bash scripts/ci/install-runner.sh Hundred-Acre-Learning VERSION SHA256 pc-learning
bash scripts/ci/install-runner.sh Gunball VERSION SHA256 pc-gunball
```

Use actual values, not `VERSION`/`SHA256`. Never paste registration tokens into chat,
Git or command arguments. Reusing a configured runner directory is refused rather
than replacing its registration. An interrupted installation needs inspection;
remove a partial empty registration only after confirming no active service uses it.

These are persistent services. They update the runner automatically, but you still
maintain Ubuntu, Docker and dependencies. The runner is not installed in ChatGPT's
temporary workspace. Do not expose it to fork PRs, public repos or untrusted writers.
All three registrations trust the same guest; they are not isolated tenants.

## 3. Keep the PC available

From Windows PowerShell, after reviewing the checked-in script:

```powershell
.\scripts\ci\keep-wsl-running.ps1 -Distro Ubuntu-24.04 -LinuxUser ci
```

This creates a current-user logon task and keeps WSL alive. It requires that Windows
user to be logged in; it is not an unattended boot service. Keep the PC plugged in,
awake and connected. Set Windows sleep behavior yourself as appropriate. Logging
out, sleeping, rebooting or `wsl --shutdown` makes CI unavailable until restored.
For reliable unattended boot operation, use a dedicated VM with an approved
automatic-start configuration instead of claiming the logon task provides it.

## 4. Activate only after registration is Online

The workflows use the repository variable `CI_RUNNER_LABELS`. Unset means the
existing GitHub-hosted Ubuntu runner. Set it to this exact JSON array to opt in:

```json
["self-hosted","linux","x64","project-ci"]
```

On a trusted administrator machine with Node and GitHub CLI, check then apply:

```bash
node scripts/ci/activate.mjs Sandline
node scripts/ci/activate.mjs Sandline --apply
node scripts/ci/activate.mjs Hundred-Acre-Learning --apply
node scripts/ci/activate.mjs Gunball --apply
```

The helper refuses public/wrong repositories, missing labels and offline runners.
It reads all inventory pages. Without `--apply` it makes no change. The API needs
repository runner-administration read and Actions-variable write permissions; if
your CLI lacks those, use the repository settings UI after checking Online status.
Never move the owner's administrative token into the runner guest for this step.

For fork PRs the selector always uses GitHub-hosted Ubuntu, even after opt-in;
untrusted code never selects the PC. Their hosted quota failures remain failures.
No `pull_request_target`, automatic success, skipped test gate, or silent hosted
fallback on an offline PC is introduced. Invalid JSON fails visibly. When the PC
is offline, trusted jobs queue; return it online or explicitly roll back the variable.

Rerun the **latest PR head** after activation. Verify the runner name and completed
steps in Actions: Sandline `verify`, `streaming`, `parity-non-v8`, `mission` and
their prerequisites; learning `validate` and all three browser-smoke jobs; Gunball
`tests` including Docker and Chromium. Inspect artifacts as before. Merge only
after those checks actually pass. The earlier Gunball #33 CI exception does not
authorize merging this migration without CI.

## Maintenance, rollback and evidence

- Browser installs take a shared `flock` so concurrent services do not race on
  apt/dpkg or the common browser download cache. All test commands remain present.
- Keep existing artifacts and caches; storage quotas are separate from execution.
  Check their usage rather than deleting acceptance evidence automatically.
- Roll back routing with `gh variable delete CI_RUNNER_LABELS --repo JoshuaLRay/REPO`.
  Future runs then use hosted runners and their quota. Cancel/rerun old queued jobs
  if necessary. This does not reset used hosted minutes.
- Stop a runner with `sudo ./svc.sh stop` from its installation directory. For
  removal, uninstall the service, then use a fresh removal token as instructed by
  GitHub. Do not delete live workspaces, Docker volumes or WSL distros to clean up.
- Remove the Windows keepalive task with `Unregister-ScheduledTask -TaskName
  ProjectCI-WSL` after checking it is the task you installed.
- Run `node --test scripts/ci/runner-policy.test.mjs` and `bash -n scripts/ci/*.sh`.
  Static/mocked verification is not proof of Windows installation or a live job.

Primary references (reviewed 2026-10-18):
[runner scope](https://docs.github.com/en/actions/concepts/runners/self-hosted-runners),
[billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions),
[runner installation](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/add-runners),
[runner service](https://docs.github.com/en/actions/how-tos/manage-runners/self-hosted-runners/configure-the-application),
[WSL install](https://learn.microsoft.com/en-us/windows/wsl/install),
[WSL configuration](https://learn.microsoft.com/en-us/windows/wsl/wsl-config).
