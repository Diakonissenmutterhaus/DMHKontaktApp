$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backupDirectory = Join-Path $projectRoot '.local-sync-test'
$databasePath = Join-Path $env:APPDATA 'de.dmh.agendakontakte\agendakontakte.sqlite'
$isolatedAppData = Join-Path $env:APPDATA 'de.dmh.agendakontakte.calendar-safe'
$isolatedDatabasePath = Join-Path $isolatedAppData 'agendakontakte.sqlite'
$backupScript = Join-Path $PSScriptRoot 'backup-calendar-sync-db.py'
$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$tauriConfig = Join-Path $projectRoot 'src-tauri\tauri.calendar-safe.conf.json'

if (Get-Process -Name 'agendakontakte' -ErrorAction SilentlyContinue) {
    throw 'Schließen Sie zuerst alle DMH-Backup-Fenster. Sonst könnte eine andere Instanz Änderungen an Microsoft 365 senden.'
}
if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw 'Die Tauri-CLI fehlt. Führen Sie zuerst npm install aus.'
}

# The client ID is public but compiled into the Rust binary. Without it the
# existing Microsoft 365 connection appears disconnected in a local dev build.
if ([string]::IsNullOrWhiteSpace($env:M365_CLIENT_ID)) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'M365_CLIENT_ID fehlt. Stellen Sie die öffentliche GitHub-Variable als Umgebungsvariable bereit.'
    }
    $publicClientId = & gh variable get M365_CLIENT_ID --repo Diakonissenmutterhaus/DMHKontaktApp 2>$null | Select-Object -Last 1
    $env:M365_CLIENT_ID = [string]$publicClientId
    if ($LASTEXITCODE -ne 0 -or $env:M365_CLIENT_ID -notmatch '^[0-9a-fA-F-]{36}$') {
        throw 'Die öffentliche GitHub-Variable M365_CLIENT_ID konnte nicht gelesen werden.'
    }
}

$backupPath = (& py -3 $backupScript $databasePath $backupDirectory | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    throw 'Die lokale Datenbanksicherung ist fehlgeschlagen. Der sichere Test wurde nicht gestartet.'
}
Write-Host "Lokale Datenbank gesichert: $backupPath"

# Never open the live application's SQLite database during this diagnostic run.
# A persistent test copy keeps later test edits separate from the installed app.
if (-not (Test-Path -LiteralPath $isolatedDatabasePath -PathType Leaf)) {
    New-Item -ItemType Directory -Path $isolatedAppData -Force | Out-Null
    Copy-Item -LiteralPath $backupPath -Destination $isolatedDatabasePath -ErrorAction Stop
    Write-Host "Isolierte Testkopie erstellt: $isolatedDatabasePath"
} else {
    $isolatedBackupPath = (& py -3 $backupScript $isolatedDatabasePath $backupDirectory | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $isolatedBackupPath -PathType Leaf)) {
        throw 'Die Sicherung der isolierten Testdatenbank ist fehlgeschlagen. Der Test wurde nicht gestartet.'
    }
    Write-Host "Isolierte Testdatenbank gesichert: $isolatedBackupPath"
}

$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'src-tauri\target-dev'
$env:DMH_M365_READ_ONLY_TEST = '1'
$env:VITE_DMH_M365_SAFE_IMPORT = 'true'

Push-Location $projectRoot
try {
    & $tauriCli dev --config $tauriConfig
    if ($LASTEXITCODE -ne 0) {
        throw "Der sichere Tauri-Test wurde mit Code $LASTEXITCODE beendet."
    }
} finally {
    Pop-Location
}
