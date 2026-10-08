$ErrorActionPreference = 'Stop'

$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$backupDirectory = Join-Path $projectRoot '.local-sync-test'
$databasePath = Join-Path $env:APPDATA 'de.dmh.agendakontakte\agendakontakte.sqlite'
$isolatedAppData = Join-Path $env:APPDATA 'de.dmh.agendakontakte.calendar-safe'
$isolatedDatabasePath = Join-Path $isolatedAppData 'agendakontakte.sqlite'
$backupScript = Join-Path $PSScriptRoot 'backup-calendar-sync-db.py'
$accountCheckScript = Join-Path $PSScriptRoot 'check-calendar-safe-account.py'
$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$tauriConfig = Join-Path $projectRoot 'src-tauri\tauri.calendar-safe.conf.json'
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
        if (-not $pythonLauncher) {
            $pythonLauncher = Get-Command python -ErrorAction SilentlyContinue
        }
        if (-not $pythonLauncher) {
            throw 'Python 3 fehlt. Installieren Sie Python oder stellen Sie den Python Launcher bereit.'
        }
        $pythonExecutable = $pythonLauncher.Source
    }
}

$runningApps = @(Get-Process -Name 'agendakontakte' -ErrorAction SilentlyContinue)
if ($runningApps.Count -gt 0) {
    Write-Warning 'DMH Backup laeuft noch, moeglicherweise nur im Infobereich der Taskleiste.'
    foreach ($runningApp in $runningApps) {
        $appPath = if ($runningApp.Path) { $runningApp.Path } else { 'Pfad nicht lesbar (ggf. erhoehte Rechte)' }
        Write-Host "  PID $($runningApp.Id): $appPath"
    }

    $closeRunningApps = Read-Host 'DMH Backup jetzt sicher beenden und den Tauri-Test starten? [J/N]'
    if ($closeRunningApps -notmatch '^(j|ja|y|yes)$') {
        throw 'Der sichere Tauri-Test wurde abgebrochen. Beenden Sie DMH Backup und starten Sie den Befehl erneut.'
    }

    foreach ($runningApp in $runningApps) {
        try {
            Stop-Process -Id $runningApp.Id -ErrorAction Stop
            [void]$runningApp.WaitForExit(10000)
        } catch {
            # A process can exit between enumeration and Stop-Process. Only
            # report failures for an instance that is still running.
            if (Get-Process -Id $runningApp.Id -ErrorAction SilentlyContinue) {
                Write-Warning "DMH Backup (PID $($runningApp.Id)) konnte nicht beendet werden: $($_.Exception.Message)"
            }
        }
    }
    $remainingApps = @(Get-Process -Name 'agendakontakte' -ErrorAction SilentlyContinue)
    if ($remainingApps.Count -gt 0) {
        Write-Host ''
        Write-Host "Der sichere Tauri-Test wurde nicht gestartet. Noch aktive DMH-Backup-Prozesse: $($remainingApps.Id -join ', ')." -ForegroundColor Yellow
        Write-Host 'Beenden Sie diese Apps im Infobereich mit "Beenden". Das Schliessen des Fensters reicht eventuell nicht aus.'
        Write-Host 'Bei "Zugriff verweigert": Task-Manager als Administrator oeffnen, unter "Details" die oben genannten PIDs pruefen und diese Prozesse beenden.'
        Write-Host 'Fuehren Sie danach npm run tauri:dev:calendar-safe erneut im normalen Terminal aus.'
        exit 1
    }
}
if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
    throw 'Die Tauri-CLI fehlt. Fuehren Sie zuerst npm install aus.'
}

# The client ID is public but compiled into the Rust binary. Without it the
# existing Microsoft 365 connection appears disconnected in a local dev build.
if ([string]::IsNullOrWhiteSpace($env:M365_CLIENT_ID)) {
    if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
        throw 'M365_CLIENT_ID fehlt. Stellen Sie die oeffentliche GitHub-Variable als Umgebungsvariable bereit.'
    }
    $publicClientId = & gh variable get M365_CLIENT_ID --repo Diakonissenmutterhaus/DMHKontaktApp 2>$null | Select-Object -Last 1
    $env:M365_CLIENT_ID = [string]$publicClientId
    if ($LASTEXITCODE -ne 0 -or $env:M365_CLIENT_ID -notmatch '^[0-9a-fA-F-]{36}$') {
        throw 'Die oeffentliche GitHub-Variable M365_CLIENT_ID konnte nicht gelesen werden.'
    }
}

$backupPath = (& $pythonExecutable @pythonPrefix $backupScript $databasePath $backupDirectory | Select-Object -Last 1)
if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $backupPath -PathType Leaf)) {
    throw 'Die lokale Datenbanksicherung ist fehlgeschlagen. Der sichere Test wurde nicht gestartet.'
}
Write-Host "Lokale Datenbank gesichert: $backupPath"

# Never open the live application's SQLite database during this diagnostic run.
# A persistent test copy keeps later test edits separate from the installed app.
$isolatedBackupPath = $null
if (-not (Test-Path -LiteralPath $isolatedDatabasePath -PathType Leaf)) {
    New-Item -ItemType Directory -Path $isolatedAppData -Force | Out-Null
    Copy-Item -LiteralPath $backupPath -Destination $isolatedDatabasePath -ErrorAction Stop
    Write-Host "Isolierte Testkopie erstellt: $isolatedDatabasePath"
} else {
    $isolatedBackupPath = (& $pythonExecutable @pythonPrefix $backupScript $isolatedDatabasePath $backupDirectory | Select-Object -Last 1)
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $isolatedBackupPath -PathType Leaf)) {
        throw 'Die Sicherung der isolierten Testdatenbank ist fehlgeschlagen. Der Test wurde nicht gestartet.'
    }
    Write-Host "Isolierte Testdatenbank gesichert: $isolatedBackupPath"
}

$testSnapshot = if ($isolatedBackupPath) { $isolatedBackupPath } else { $isolatedDatabasePath }
$expectedAccountHash = (& $pythonExecutable @pythonPrefix $accountCheckScript $backupPath $testSnapshot | Select-Object -Last 1)
if ($LASTEXITCODE -eq 2 -and $isolatedBackupPath) {
    Write-Warning 'Die bisherige Testkopie gehoert zu einem anderen Microsoft-365-Konto. Sie wird aus der aktuellen Sicherung neu erstellt.'
    Write-Host "Die bisherigen Testdaten bleiben gesichert: $isolatedBackupPath"
    $expectedAccountHash = (& $pythonExecutable @pythonPrefix $accountCheckScript $backupPath $isolatedBackupPath --refresh-test-copy $isolatedDatabasePath | Select-Object -Last 1)
}
if ($LASTEXITCODE -ne 0 -or $expectedAccountHash -notmatch '^[0-9a-f]{64}$') {
    throw 'Die sichere Testkopie gehoert nicht zum Microsoft-365-Konto der Ausgangsdatenbank. Der Test wurde nicht gestartet.'
}

$env:CARGO_TARGET_DIR = Join-Path $projectRoot 'src-tauri\target-dev'
$env:DMH_M365_READ_ONLY_TEST = '1'
$env:DMH_M365_READ_ONLY_ACCOUNT_SHA256 = $expectedAccountHash
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
