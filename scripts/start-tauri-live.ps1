param([switch]$CloseRunningApps)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$databasePath = Join-Path $env:APPDATA 'de.dmh.agendakontakte\agendakontakte.sqlite'
$backupDirectory = Join-Path $projectRoot '.local-sync-test'
$backupScript = Join-Path $PSScriptRoot 'backup-calendar-sync-db.py'
$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$tauriConfig = Join-Path $projectRoot 'src-tauri\tauri.live-dev.conf.json'

if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw 'Die Tauri-CLI fehlt. Fuehren Sie zuerst npm install aus.'
}

Write-Host 'LIVE-Entwicklung: gleiche lokale Datenbank wie die installierte App; echte Microsoft-365-Synchronisierung in den konfigurierten Richtungen.'
Write-Host "Datenbank: $databasePath"

$pythonPrefix = @()
$pythonLauncher = Get-Command py -ErrorAction SilentlyContinue
if ($pythonLauncher) {
    $pythonExecutable = $pythonLauncher.Source
    $pythonPrefix = @('-3')
} else {
    $bundledPython = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe'
    if (Test-Path -LiteralPath $bundledPython -PathType Leaf) {
        $pythonExecutable = $bundledPython
    } else {
        $pythonLauncher = Get-Command python3 -ErrorAction SilentlyContinue
        if (-not $pythonLauncher) { $pythonLauncher = Get-Command python -ErrorAction SilentlyContinue }
        if (-not $pythonLauncher) { throw 'Python 3 fehlt. Die Datenbank kann nicht gesichert werden.' }
        $pythonExecutable = $pythonLauncher.Source
    }
}

# Take a consistent SQLite snapshot before closing any app or starting a build.
if (Test-Path -LiteralPath $databasePath -PathType Leaf) {
    $backupPath = (& $pythonExecutable @pythonPrefix $backupScript $databasePath $backupDirectory | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
        throw 'Die lokale Datenbanksicherung ist fehlgeschlagen. Die LIVE-Version wurde nicht gestartet.'
    }
    Write-Host "Lokale Datenbank gesichert: $backupPath"
} else {
    Write-Host 'Keine bestehende Datenbank vorhanden. Die App legt beim Start eine neue Datenbank an.'
}

$runningApps = @(Get-Process -Name 'agendakontakte' -ErrorAction SilentlyContinue)
if ($runningApps.Count -gt 0) {
    foreach ($runningApp in $runningApps) {
        $appPath = if ($runningApp.Path) { $runningApp.Path } else { 'Pfad nicht lesbar (ggf. erhoehte Rechte)' }
        Write-Host "  Noch aktiv: PID $($runningApp.Id): $appPath"
    }
    if (-not $CloseRunningApps) {
        $answer = Read-Host 'DMH Backup beenden und die LIVE-Entwicklung starten? [J/N]'
        if ($answer -notmatch '^(j|ja|y|yes)$') { throw 'Der LIVE-Start wurde abgebrochen.' }
    }
    foreach ($runningApp in $runningApps) {
        try {
            Stop-Process -Id $runningApp.Id -ErrorAction Stop
            [void]$runningApp.WaitForExit(10000)
        } catch {
            if (Get-Process -Id $runningApp.Id -ErrorAction SilentlyContinue) {
                Write-Warning "PID $($runningApp.Id) konnte nicht beendet werden: $($_.Exception.Message)"
            }
        }
    }
    $remainingApps = @(Get-Process -Name 'agendakontakte' -ErrorAction SilentlyContinue)
    if ($remainingApps.Count -gt 0) {
        Write-Host "LIVE-Start blockiert. Noch aktive PIDs: $($remainingApps.Id -join ', ')." -ForegroundColor Yellow
        Write-Host 'Beenden Sie diese Apps im Infobereich mit "Beenden". Bei Zugriff verweigert: Task-Manager als Administrator, Details, die genannten PIDs beenden.'
        exit 1
    }
}

$environmentNames = @(
    'M365_CLIENT_ID', 'CARGO_TARGET_DIR', 'DMH_M365_READ_ONLY_TEST',
    'DMH_M365_READ_ONLY_ACCOUNT_SHA256', 'VITE_DMH_M365_SAFE_IMPORT',
    'DMH_RELEASE_CHANNEL', 'VITE_APP_CHANNEL', 'VITE_SOURCE_COMMIT'
)
$previousEnvironment = @{}
foreach ($environmentName in $environmentNames) {
    $previousEnvironment[$environmentName] = [Environment]::GetEnvironmentVariable($environmentName, 'Process')
}

Push-Location $projectRoot
try {
    if ([string]::IsNullOrWhiteSpace($env:M365_CLIENT_ID)) {
        if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
            throw 'M365_CLIENT_ID fehlt. Stellen Sie die oeffentliche GitHub-Variable als Umgebungsvariable bereit.'
        }
        $publicClientId = & gh variable get M365_CLIENT_ID --repo Diakonissenmutterhaus/DMHKontaktApp 2>$null | Select-Object -Last 1
        if ($LASTEXITCODE -ne 0 -or [string]$publicClientId -notmatch '^[0-9a-fA-F-]{36}$') {
            throw 'Die oeffentliche GitHub-Variable M365_CLIENT_ID konnte nicht gelesen werden.'
        }
        $env:M365_CLIENT_ID = [string]$publicClientId
    }

    # Keep the production app identifier/database and normal account checks.
    # Clear the opt-in diagnostic flags for both Cargo and Vite subprocesses.
    $env:CARGO_TARGET_DIR = Join-Path $projectRoot 'src-tauri\target-dev'
    $env:DMH_M365_READ_ONLY_TEST = '0'
    $env:VITE_DMH_M365_SAFE_IMPORT = 'false'
    foreach ($environmentName in @('DMH_M365_READ_ONLY_ACCOUNT_SHA256', 'DMH_RELEASE_CHANNEL', 'VITE_APP_CHANNEL')) {
        [Environment]::SetEnvironmentVariable($environmentName, $null, 'Process')
    }
    $env:VITE_SOURCE_COMMIT = & git rev-parse --short HEAD
    & $tauriCli dev --config $tauriConfig
    if ($LASTEXITCODE -ne 0) { throw "Die LIVE-Entwicklung wurde mit Code $LASTEXITCODE beendet." }
} finally {
    Pop-Location
    foreach ($environmentName in $environmentNames) {
        [Environment]::SetEnvironmentVariable($environmentName, $previousEnvironment[$environmentName], 'Process')
    }
}
