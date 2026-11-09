param([switch]$Build, [switch]$CheckConfiguration)

$ErrorActionPreference = 'Stop'
$projectRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '..')).Path
$tauriCli = Join-Path $projectRoot 'node_modules\.bin\tauri.cmd'
$environmentNames = @(
    'M365_CLIENT_ID', 'M365_TENANT_ID', 'CARGO_TARGET_DIR', 'VITE_APP_CHANNEL',
    'VITE_FEATURE_AUTHENTICATOR_DEFAULT', 'VITE_FEATURE_SERVICES_DEFAULT',
    'VITE_SOURCE_COMMIT', 'DMH_RELEASE_CHANNEL'
)
$previousEnvironment = @{}
foreach ($name in $environmentNames) {
    $previousEnvironment[$name] = [Environment]::GetEnvironmentVariable($name, 'Process')
}

Push-Location $projectRoot
try {
    . (Join-Path $PSScriptRoot 'm365-development-environment.ps1')
    Import-M365DevelopmentEnvironment -ProjectRoot $projectRoot
    if ($CheckConfiguration) { return }
    if (-not (Test-Path -LiteralPath $tauriCli -PathType Leaf)) {
        throw 'Die Tauri-CLI fehlt. Fuehren Sie zuerst npm ci aus.'
    }
    $env:CARGO_TARGET_DIR = Join-Path $env:TEMP 'agendakontakte-admin-test-cargo-target'
    $env:VITE_APP_CHANNEL = 'admin-test'
    $env:DMH_RELEASE_CHANNEL = 'admin-test'
    $env:VITE_FEATURE_AUTHENTICATOR_DEFAULT = 'false'
    $env:VITE_FEATURE_SERVICES_DEFAULT = 'false'
    $env:VITE_SOURCE_COMMIT = 'local'
    $commit = & git rev-parse --short HEAD 2>$null
    if ($LASTEXITCODE -eq 0) { $env:VITE_SOURCE_COMMIT = [string]$commit }
    $action = if ($Build) { 'build' } else { 'dev' }
    & $tauriCli $action --config src-tauri/tauri.admin-test.conf.json
    if ($LASTEXITCODE -ne 0) { throw "Der Admin-Test wurde mit Code $LASTEXITCODE beendet." }
} finally {
    Pop-Location
    foreach ($name in $environmentNames) {
        if ($null -eq $previousEnvironment[$name]) {
            Remove-Item -LiteralPath "Env:$name" -ErrorAction SilentlyContinue
        } else {
            [Environment]::SetEnvironmentVariable($name, $previousEnvironment[$name], 'Process')
        }
    }
}
