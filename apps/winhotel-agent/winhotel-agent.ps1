<#
.SYNOPSIS
  ALiSiO Winhotel-Agent: nächtlicher Schnappschuss der Winhotel.MX-Datenbank
  (Firebird 3) und Upload zu ALiSiO.

.DESCRIPTION
  Läuft auf dem Winhotel-Server (Windows). Ablauf:
    1. gbak.exe und die Datenbank finden;
    2. Schnappschuss-Modus wählen (in dieser Reihenfolge, wird protokolliert):
       (a) fertiges .fbk aus dem Winhotel-Backup-Ordner (-BackupDir), wenn es
           jünger als 24 Stunden ist;
       (b) gbak -b mit Passwort: SYSDBA.password im Firebird-Ordner, dann
           -Password, dann "masterkey";
       (c) Kopie der winhotel.fdb — NUR wenn Winhotel geschlossen ist
           (die Datei lässt sich exklusiv zum Schreiben öffnen);
    3. gzip, SHA-256, POST an {AlisioUrl}/api/apps/winhotel-import/snapshots
       mit "Authorization: Bearer <Token>" (3 Versuche);
    4. temporäre Dateien löschen. Im Winhotel-Ordner wird NICHTS verändert
       oder gelöscht.

  Exit-Code 0 nur bei Antwort 201 (neuer Schnappschuss) oder 200 (derselbe
  Schnappschuss war schon da). Alles andere: Exit-Code ≠ 0, damit die
  Aufgabenplanung rot wird.

.PARAMETER AlisioUrl
  Basis-URL, z. B. https://pms.example.com (ohne Pfad).
.PARAMETER Token
  Agent-Token aus der ALiSiO-Karte "Import aus Winhotel". Alternativ die Datei
  agent.token neben dem Skript (nur für Administratoren lesbar!).
.PARAMETER Database
  Pfad zur winhotel.fdb. Standard: C:\winhotelmx\daten\winhotel.fdb
.PARAMETER BackupDir
  Ordner, in den Winhotel selbst .fbk-Sicherungen schreibt (Modus a).
.PARAMETER Password
  SYSDBA-Passwort für gbak -b (Modus b), falls keine SYSDBA.password-Datei.
.PARAMETER FirebirdDir
  Ordner mit gbak.exe. Standard: wird gesucht (Programme, Registry, Winhotel).
.PARAMETER LogFile
  Protokoll. Standard: winhotel-agent.log neben dem Skript.

.EXAMPLE
  .\winhotel-agent.ps1 -AlisioUrl https://pms.example.com -BackupDir D:\Backup
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$AlisioUrl,
  [string]$Token = '',
  [string]$Database = 'C:\winhotelmx\daten\winhotel.fdb',
  [string]$BackupDir = '',
  [string]$Password = '',
  [string]$FirebirdDir = '',
  [string]$LogFile = ''
)

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
if (-not $LogFile) { $LogFile = Join-Path $ScriptDir 'winhotel-agent.log' }

function Write-Log {
  param([string]$Message)
  $line = '{0} {1}' -f (Get-Date -Format 'yyyy-MM-dd HH:mm:ss'), $Message
  Write-Host $line
  Add-Content -Path $LogFile -Value $line -Encoding UTF8
}

function Fail {
  param([string]$Message, [int]$Code = 1)
  Write-Log ('FEHLER: ' + $Message)
  exit $Code
}

# ── Token ─────────────────────────────────────────────────────────────────
if (-not $Token) {
  $tokenFile = Join-Path $ScriptDir 'agent.token'
  if (Test-Path $tokenFile) { $Token = (Get-Content -Path $tokenFile -Raw).Trim() }
}
if (-not $Token) { Fail 'Kein Token: -Token angeben oder agent.token neben das Skript legen.' 2 }
# Das Token selbst wird nie protokolliert.
Write-Log ('Start; Token vorhanden (' + $Token.Length + ' Zeichen)')

# ── gbak.exe finden ───────────────────────────────────────────────────────
function Find-Gbak {
  $candidates = @()
  if ($FirebirdDir) { $candidates += (Join-Path $FirebirdDir 'gbak.exe') }
  $candidates += 'C:\Program Files\Firebird\Firebird_3_0\gbak.exe'
  $candidates += 'C:\Program Files (x86)\Firebird\Firebird_3_0\gbak.exe'
  foreach ($key in @('HKLM:\SOFTWARE\Firebird Project\Firebird Server\Instances',
                     'HKLM:\SOFTWARE\WOW6432Node\Firebird Project\Firebird Server\Instances')) {
    try {
      $root = (Get-ItemProperty -Path $key -ErrorAction Stop).DefaultInstance
      if ($root) { $candidates += (Join-Path $root 'gbak.exe') }
    } catch { }
  }
  $candidates += (Join-Path (Split-Path -Parent $Database) '..\gbak.exe')
  $candidates += (Join-Path (Split-Path -Parent $Database) 'gbak.exe')
  foreach ($c in $candidates) { if ($c -and (Test-Path $c)) { return (Resolve-Path $c).Path } }
  return $null
}

$Gbak = Find-Gbak
if ($Gbak) { Write-Log ('gbak: ' + $Gbak) } else { Write-Log 'gbak.exe nicht gefunden — Modus (b) entfällt' }
if (-not (Test-Path $Database)) { Fail ('Datenbank nicht gefunden: ' + $Database) 2 }

# ── Arbeitsordner ─────────────────────────────────────────────────────────
$Work = Join-Path $env:TEMP ('winhotel-agent-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $Work | Out-Null
$Snapshot = $null   # Pfad zur .fbk oder .fdb im Arbeitsordner
$Mode = $null       # backup | gbak | copy

try {
  # ── (a) fertiges Backup ─────────────────────────────────────────────────
  if ($BackupDir -and (Test-Path $BackupDir)) {
    $latest = Get-ChildItem -Path $BackupDir -Filter '*.fbk' -File -ErrorAction SilentlyContinue |
      Sort-Object LastWriteTime -Descending | Select-Object -First 1
    if ($latest -and $latest.LastWriteTime -gt (Get-Date).AddHours(-24)) {
      $Snapshot = Join-Path $Work 'snapshot.fbk'
      Copy-Item -Path $latest.FullName -Destination $Snapshot
      $Mode = 'backup'
      Write-Log ('Modus (a): fertiges Backup ' + $latest.Name + ' vom ' + $latest.LastWriteTime.ToString('yyyy-MM-dd HH:mm'))
    } else {
      Write-Log 'Modus (a): kein .fbk jünger als 24 h im Backup-Ordner'
    }
  } else {
    Write-Log 'Modus (a): kein -BackupDir angegeben'
  }

  # ── (b) gbak -b mit Passwort ────────────────────────────────────────────
  if (-not $Snapshot -and $Gbak) {
    $passwords = @()
    $pwFile = Join-Path (Split-Path -Parent $Gbak) 'SYSDBA.password'
    if (Test-Path $pwFile) {
      $m = Select-String -Path $pwFile -Pattern 'ISC_PASSWORD\s*=\s*(\S+)' | Select-Object -First 1
      if ($m) { $passwords += @{ Name = 'SYSDBA.password-Datei'; Value = $m.Matches[0].Groups[1].Value } }
    }
    if ($Password) { $passwords += @{ Name = '-Password'; Value = $Password } }
    $passwords += @{ Name = 'Standardpasswort'; Value = 'masterkey' }
    foreach ($pw in $passwords) {
      $target = Join-Path $Work 'snapshot.fbk'
      Write-Log ('Modus (b): gbak -b, Passwort aus ' + $pw.Name)
      $env:ISC_USER = 'SYSDBA'
      $env:ISC_PASSWORD = $pw.Value
      try {
        $out = & $Gbak -b -t -user SYSDBA ('localhost:' + $Database) $target 2>&1
        $code = $LASTEXITCODE
      } finally {
        Remove-Item Env:\ISC_PASSWORD -ErrorAction SilentlyContinue
      }
      if ($code -eq 0 -and (Test-Path $target)) {
        $Snapshot = $target
        $Mode = 'gbak'
        Write-Log ('Modus (b): gbak -b erfolgreich, ' + [math]::Round((Get-Item $target).Length / 1MB) + ' MB')
        break
      }
      Write-Log ('Modus (b): gbak -b fehlgeschlagen (Exit ' + $code + '): ' + (($out | Select-Object -Last 2) -join ' | '))
      Remove-Item -Path $target -ErrorAction SilentlyContinue
    }
  }

  # ── (c) Dateikopie, nur wenn Winhotel geschlossen ist ───────────────────
  if (-not $Snapshot) {
    $exclusive = $null
    try {
      $exclusive = [System.IO.File]::Open($Database, 'Open', 'ReadWrite', 'None')
      $exclusive.Close()
      $Snapshot = Join-Path $Work 'snapshot.fdb'
      Copy-Item -Path $Database -Destination $Snapshot
      $Mode = 'copy'
      Write-Log ('Modus (c): Winhotel ist geschlossen, Datei kopiert, ' + [math]::Round((Get-Item $Snapshot).Length / 1MB) + ' MB')
    } catch {
      Write-Log 'Modus (c): winhotel.fdb ist in Benutzung (Winhotel oder Firebird läuft) — keine Kopie'
    }
  }

  if (-not $Snapshot) { Fail 'Kein Schnappschuss möglich: kein frisches Backup, gbak -b fehlgeschlagen, Datei in Benutzung.' 3 }

  # ── gzip + SHA-256 ──────────────────────────────────────────────────────
  $gz = $Snapshot + '.gz'
  $in = [System.IO.File]::OpenRead($Snapshot)
  $outStream = [System.IO.File]::Create($gz)
  $gzip = New-Object System.IO.Compression.GZipStream($outStream, [System.IO.Compression.CompressionLevel]::Optimal)
  try { $in.CopyTo($gzip) } finally { $gzip.Dispose(); $outStream.Dispose(); $in.Dispose() }
  Remove-Item -Path $Snapshot -ErrorAction SilentlyContinue
  $sha = (Get-FileHash -Path $gz -Algorithm SHA256).Hash.ToLower()
  $size = (Get-Item $gz).Length
  Write-Log ('gzip: ' + [math]::Round($size / 1MB, 1) + ' MB, sha256 ' + $sha.Substring(0, 12) + '…')

  # ── Upload, 3 Versuche ──────────────────────────────────────────────────
  $url = $AlisioUrl.TrimEnd('/') + '/api/apps/winhotel-import/snapshots'
  $headers = @{
    'Authorization'       = 'Bearer ' + $Token
    'Content-Type'        = 'application/gzip'
    'X-Winhotel-Sha256'   = $sha
    'X-Winhotel-Mode'     = $Mode
    'X-Winhotel-Taken-At' = (Get-Date).ToUniversalTime().ToString('yyyy-MM-ddTHH:mm:ssZ')
    'X-Winhotel-Hostname' = $env:COMPUTERNAME
  }
  $attempt = 0
  $done = $false
  while (-not $done -and $attempt -lt 3) {
    $attempt++
    try {
      [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
      $resp = Invoke-WebRequest -Uri $url -Method Post -Headers $headers -InFile $gz -UseBasicParsing -TimeoutSec 900
      $status = [int]$resp.StatusCode
      if ($status -eq 201 -or $status -eq 200) {
        Write-Log ('Upload OK (' + $status + '): ' + $resp.Content)
        $done = $true
      } else {
        Write-Log ('Upload: unerwartete Antwort ' + $status + ': ' + $resp.Content)
      }
    } catch {
      $detail = $_.Exception.Message
      $code = ''
      try { $code = [int]$_.Exception.Response.StatusCode } catch { }
      try {
        $reader = New-Object System.IO.StreamReader($_.Exception.Response.GetResponseStream())
        $detail = $reader.ReadToEnd()
      } catch { }
      Write-Log ('Upload-Versuch ' + $attempt + ' fehlgeschlagen' + $(if ($code) { ' (' + $code + ')' } else { '' }) + ': ' + $detail)
      # 401/404/400/409 sind Antworten, kein Netzfehler: erneut senden ändert nichts.
      if ($code -in 400, 401, 404, 409) { break }
      if ($attempt -lt 3) { Start-Sleep -Seconds (60 * $attempt) }
    }
  }
  if (-not $done) { Fail 'Upload nicht gelungen — siehe Protokoll.' 4 }
  Write-Log 'Fertig.'
  exit 0
} finally {
  # Eigene temporäre Dateien weg; der Winhotel-Ordner bleibt unberührt.
  Remove-Item -Path $Work -Recurse -Force -ErrorAction SilentlyContinue
}
