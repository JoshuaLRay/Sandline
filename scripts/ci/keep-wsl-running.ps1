param(
  [Parameter(Mandatory=$true)][ValidatePattern('^[A-Za-z0-9._-]+$')][string]$Distro,
  [Parameter(Mandatory=$true)][ValidatePattern('^[a-z_][a-z0-9_-]*$')][string]$LinuxUser
)
$ErrorActionPreference = 'Stop'
$taskName = 'ProjectCI-WSL'
if (Get-ScheduledTask -TaskName $taskName -ErrorAction SilentlyContinue) {
  throw 'Task already exists; inspect it rather than overwriting it.'
}
$installed = ((& wsl.exe --list --quiet) -replace "`0", '') | ForEach-Object { $_.Trim() }
if ($LASTEXITCODE -ne 0 -or $Distro -notin $installed) { throw 'Install the named dedicated WSL distribution first.' }
$account = [System.Security.Principal.WindowsIdentity]::GetCurrent().Name
$action = New-ScheduledTaskAction -Execute "$env:WINDIR\System32\wsl.exe" -Argument "--distribution $Distro --user $LinuxUser --exec /bin/sleep infinity"
$trigger = New-ScheduledTaskTrigger -AtLogOn -User $account
$principal = New-ScheduledTaskPrincipal -UserId $account -LogonType Interactive -RunLevel Limited
$settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit ([TimeSpan]::Zero) -MultipleInstances IgnoreNew -RestartCount 3 -RestartInterval (New-TimeSpan -Minutes 1)
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Description 'Keep the dedicated CI Linux guest alive while this Windows user is logged on.' | Out-Null
Start-ScheduledTask -TaskName $taskName
Write-Output 'CI guest starts at user logon. Keep Windows awake and plugged in; this task does not disable sleep.'
