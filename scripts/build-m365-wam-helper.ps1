param([ValidateSet("debug", "release")][string]$Configuration = "debug")
$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$project = Join-Path $projectRoot "m365-wam-helper\M365WamHelper.csproj"
$output = Join-Path $projectRoot "src-tauri\resources\m365-wam"
$profile = if ($Configuration -eq "release") { "Release" } else { "Debug" }
if (-not (Get-Command dotnet -ErrorAction SilentlyContinue)) {
    throw ".NET SDK 10 fehlt. Installieren Sie das SDK zum Bauen; Endnutzer benötigen keine .NET-Installation."
}
# Ship the runtime and MSAL native broker library together. No runtime download
# or SDK installation is needed on the user's notebook.
& dotnet restore $project --runtime win-x64 --source https://api.nuget.org/v3/index.json --locked-mode
if ($LASTEXITCODE -ne 0) { throw "WAM-Abhängigkeiten konnten nicht wiederhergestellt werden." }
& dotnet publish $project --configuration $profile --runtime win-x64 --self-contained true --no-restore --output $output --nologo -v quiet
if ($LASTEXITCODE -ne 0) { throw "Microsoft-365-Windows-Anmeldung konnte nicht gebaut werden." }
& (Join-Path $output "dmh-m365-wam.exe") --self-test
if ($LASTEXITCODE -ne 0) { throw "WAM-Kontoauswahl hat die Prüfungen nicht bestanden." }
