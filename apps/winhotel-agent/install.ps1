<#
.SYNOPSIS
  Registriert den ALiSiO Winhotel-Agenten als geplante Aufgaben: nächtlicher
  Schnappschuss (täglich 03:00) und Tagesdelta (alle 15 Minuten, -Mode Delta).

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
  [string]$TaskName = 'ALiSiO Winhotel-Agent',
  [int]$DeltaMinutes = 15,
  [string]$DeltaTaskName = 'ALiSiO Winhotel-Delta',
  [switch]$NoDelta
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Agent = Join-Path $ScriptDir 'winhotel-agent.ps1'
if (-not (Test-Path $Agent)) { throw ('winhotel-agent.ps1 nicht gefunden in ' + $ScriptDir) }

# ── Token-Datei: nur Administratoren und SYSTEM ────────────────────────────
#
# Die Konten werden über ihre SID benannt, nicht über den Namen. Well-known
# accounts heißen in jeder Windows-Sprache anders — 'BUILTIN\Administrators'
# ist auf einem deutschen Windows 'VORDEFINIERT\Administratoren' und
# 'NT AUTHORITY\SYSTEM' ist 'NT-AUTORITÄT\SYSTEM'. Der englische Name lässt
# sich dort nicht auflösen: IdentityNotMappedException, und die Installation
# bricht ab, bevor irgendetwas eingerichtet ist (Schlossberghotel, 18.09.2026).
# Die SID ist in allen Sprachen dieselbe:
#   S-1-5-32-544  Administratoren (lokale Gruppe)
#   S-1-5-18      SYSTEM
$tokenFile = Join-Path $ScriptDir 'agent.token'
Set-Content -Path $tokenFile -Value $Token -Encoding ASCII -NoNewline
$acl = Get-Acl $tokenFile
$acl.SetAccessRuleProtection($true, $false)
foreach ($who in @([Security.Principal.SecurityIdentifier]'S-1-5-32-544',
                   [Security.Principal.SecurityIdentifier]'S-1-5-18')) {
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
# Auch hier die SID und nicht der Name: 'NT AUTHORITY\SYSTEM' wäre der
# nächste Schritt gewesen, der auf einem deutschen Windows abbricht.
$principal = New-ScheduledTaskPrincipal -UserId 'S-1-5-18' -LogonType ServiceAccount -RunLevel Highest

if (Get-ScheduledTask -TaskName $TaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $TaskName -Confirm:$false
}
Register-ScheduledTask -TaskName $TaskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal | Out-Null
Write-Host ('Aufgabe "' + $TaskName + '" registriert: täglich ' + $Time + '. Test: Start-ScheduledTask -TaskName "' + $TaskName + '"')

# ── Tagesdelta: alle N Minuten, nur lesen (Kiosk sieht Buchungen des Tages) ──
if (Get-ScheduledTask -TaskName $DeltaTaskName -ErrorAction SilentlyContinue) {
  Unregister-ScheduledTask -TaskName $DeltaTaskName -Confirm:$false
}
if (-not $NoDelta) {
  $deltaArgs = @(
    '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', ('"' + $Agent + '"'),
    '-AlisioUrl', ('"' + $AlisioUrl + '"'),
    '-Database', ('"' + $Database + '"'),
    '-Mode', 'Delta'
  )
  if ($Password) { $deltaArgs += @('-Password', ('"' + $Password + '"')) }
  $deltaAction = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument ($deltaArgs -join ' ') -WorkingDirectory $ScriptDir
  $deltaTrigger = New-ScheduledTaskTrigger -Once -At (Get-Date).Date -RepetitionInterval (New-TimeSpan -Minutes $DeltaMinutes) -RepetitionDuration (New-TimeSpan -Days 3650)
  $deltaSettings = New-ScheduledTaskSettingsSet -StartWhenAvailable -ExecutionTimeLimit (New-TimeSpan -Minutes 10) -MultipleInstances IgnoreNew
  Register-ScheduledTask -TaskName $DeltaTaskName -Action $deltaAction -Trigger $deltaTrigger -Settings $deltaSettings -Principal $principal | Out-Null
  Write-Host ('Aufgabe "' + $DeltaTaskName + '" registriert: alle ' + $DeltaMinutes + ' Minuten (Tagesdelta). Test: Start-ScheduledTask -TaskName "' + $DeltaTaskName + '"')
}
