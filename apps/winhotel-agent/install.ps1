<#
.SYNOPSIS
  Registriert den ALiSiO Winhotel-Agenten als geplante Aufgabe (täglich 03:00).

.DESCRIPTION
  Als Administrator ausführen. Legt die Aufgabe "ALiSiO Winhotel-Agent" an,
  die winhotel-agent.ps1 aus diesem Ordner mit den angegebenen Parametern
  startet. Das Token wird in agent.token neben dem Skript gespeichert und
  die Datei so berechtigt, dass nur Administratoren und SYSTEM sie lesen.

.EXAMPLE
  .\install.ps1 -AlisioUrl https://pms.example.com -Token <Token> -BackupDir D:\Backup
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AlisioUrl,
  [Parameter(Mandatory = $true)][string]$Token,
  [string]$Database = 'C:\winhotelmx\daten\winhotel.fdb',
  [string]$BackupDir = '',
  [string]$Password = '',
  [string]$Time = '03:00',
  [string]$TaskName = 'ALiSiO Winhotel-Agent'
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Agent = Join-Path $ScriptDir 'winhotel-agent.ps1'
if (-not (Test-Path $Agent)) { throw ('winhotel-agent.ps1 nicht gefunden in ' + $ScriptDir) }

# ── Token-Datei: nur Administratoren und SYSTEM ────────────────────────────
$tokenFile = Join-Path $ScriptDir 'agent.token'
Set-Content -Path $tokenFile -Value $Token -Encoding ASCII -NoNewline
$acl = Get-Acl $tokenFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in @('BUILTIN\Administrators', 'NT AUTHORITY\SYSTEM')) {
  $rule = New-Object System.Security.AccessControl.FileSystemAccessRule($who, 'FullControl', 'Allow')
  $acl.AddAccessRule($rule)
}
Set-Acl -Path $tokenFile -AclObject $acl
Write-Host ('Token gespeichert: ' + $tokenFile + ' (nur Administratoren/SYSTEM)')

# ── Geplante Aufgabe ──────────────────────────────────────────────────────
$args = @(
  '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Agent + '"'),
  '-AlisioUrl', ('"' + $AlisioUrl + '"'),
  '-Database', ('"' + $Database + '"')
)
if ($BackupDir) { $args += @('-BackupDir', ('"' + $BackupDir + '"')) }
if ($Password) { $args += @('-Password', ('"' + $Password + '"')) }

$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($args -join ' ') -WorkingDirectory $ScriptDir
$trigger = New-ScheduledTaskTrigger -Daily -At $Time
$settings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Hours 2) -MultipleInstances IgnoreNew
$principal = New-ScheduledTaskPrincipal -UserId 'NT AUTHORITY\SYSTEM' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Write-Host ('Aufgabe "' + $TaskName + '" registriert: täglich ' + $Time + '. Test: Start-ScheduledTask -TaskName "' + $TaskName + '"')
