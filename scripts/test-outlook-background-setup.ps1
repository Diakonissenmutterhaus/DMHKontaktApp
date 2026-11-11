$ErrorActionPreference = 'Stop'
# In-memory process/COM doubles only. Never launches or closes real Outlook.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source).ProviderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'PowerShell syntax error' }
foreach ($name in @('Get-OwnedOutlookSetupProcess', 'Close-OutlookSetupProcess', 'Close-OutlookForMigration', 'Hide-OutlookSetupExplorer')) {
    $definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    Set-Item "Function:$name" $definition.Body.GetScriptBlock()
}
$script:quitCount = 0
$script:time = [datetime]'2026-11-09T10:00:00Z'
$script:process = [pscustomobject]@{ Id = 1234; StartTime = $script:time }
$script:process | Add-Member ScriptMethod Dispose {}
$script:process | Add-Member ScriptMethod WaitForExit { param($Timeout) return $true }
$script:app = [pscustomobject]@{
    Session = [pscustomobject]@{ CurrentProfileName = 'Profile Exchange' }
    Inspectors = [pscustomobject]@{ Count = 0 }
    Explorers = [pscustomobject]@{ Count = 0 }
}
$script:app | Add-Member ScriptMethod Quit { $script:quitCount++ }
function Get-Process { param($Name, $Id, $ErrorAction) return $script:process }
function Get-RunningOutlookApplication { return $script:app }
function Release-OutlookSetupObject { param($Object) }
function Invoke-CloseFixture {
    return Close-OutlookSetupProcess -ExpectedId 1234 -StartedAt ($script:time.ToUniversalTime().ToString('o')) -Profile 'Profile Exchange'
}

$result = Invoke-CloseFixture
if (-not $result.closed -or $script:quitCount -ne 1) { throw 'Owned setup session was not gracefully closed' }
$script:quitCount = 0
$script:process.Id = 5678
if ((Invoke-CloseFixture).reason -ne 'not_owned' -or $script:quitCount) { throw 'Unrelated Outlook was closed' }
$script:process.Id = 1234
$script:process.StartTime = $script:time.AddMinutes(1)
if ((Invoke-CloseFixture).reason -ne 'not_owned' -or $script:quitCount) { throw 'Reused process ID was accepted' }
$script:process.StartTime = $script:time
$script:app.Session.CurrentProfileName = 'Personal'
if ((Invoke-CloseFixture).reason -ne 'not_owned' -or $script:quitCount) { throw 'Wrong profile was closed' }
$script:app.Session.CurrentProfileName = 'Profile Exchange'
$script:app.Inspectors.Count = 1
if ((Invoke-CloseFixture).reason -ne 'user_work' -or $script:quitCount) { throw 'Open inspector was discarded' }
$script:app.Inspectors.Count = 0
$script:app.Explorers.Count = 1
$script:app.Explorers | Add-Member ScriptMethod Item { param($Index) return [pscustomobject]@{ ActiveInlineResponse = [pscustomobject]@{} } }
if ((Invoke-CloseFixture).reason -ne 'user_work' -or $script:quitCount) { throw 'Inline reply was discarded' }
function Get-RunningOutlookApplication { throw 'COM not ready' }
if ((Invoke-CloseFixture).reason -ne 'not_ready' -or $script:quitCount) { throw 'COM failure incorrectly reported completion' }
Write-Host 'PASS: graceful owned shutdown, exact process/start/profile binding, unrelated/restarted Outlook and drafts protected, COM failures remain pending.'

function Get-RunningOutlookApplication { return $script:app }
$script:app.Explorers.Count = 0
$script:quitCount = 0
if ((Close-OutlookForMigration -Authorized $false).reason -ne 'not_authorized' -or $script:quitCount) { throw 'Closed Outlook without migration authorization' }
if (-not (Close-OutlookForMigration -Authorized $true).closed -or $script:quitCount -ne 1) { throw 'Explicit migration did not gracefully close existing Outlook' }
$script:quitCount = 0
$script:app.Inspectors.Count = 1
if ((Close-OutlookForMigration -Authorized $true).reason -ne 'user_work' -or $script:quitCount) { throw 'Migration discarded open user work' }
$script:app.Inspectors.Count = 0
if ((Close-OutlookForMigration -Authorized $true -ExpectedProfile 'Other').reason -ne 'not_owned' -or $script:quitCount) { throw 'Migration finalization closed a different profile' }
$script:processCalls = 0
function Get-Process {
    param($Name, $Id, $ErrorAction)
    $script:processCalls++
    if ($script:processCalls -gt 1) { $script:process.Id = 5678 }
    return $script:process
}
if ((Close-OutlookForMigration -Authorized $true).reason -ne 'not_owned' -or $script:quitCount) { throw 'Migration closed an Outlook restarted during shutdown capture' }
Write-Host 'PASS: explicit migration closes existing Outlook normally; authorization, drafts, profile mismatch and process restart remain protected.'

function Get-Process { param($Name, $Id, $ErrorAction) return $script:process }
$script:process.Id = 1234
$script:app.Inspectors.Count = 0
$script:app.Explorers.Count = 1
$script:inline = $null
$script:app.Explorers | Add-Member -Force ScriptMethod Item { param($Index) return [pscustomobject]@{ ActiveInlineResponse = $script:inline; HWND = 99 } }
Add-Type -TypeDefinition 'using System; public static class DmhOutlookSetupWindow { public static int Calls = 0; public static bool ShowWindowAsync(IntPtr hwnd, int show) { Calls++; return true; } }'
Hide-OutlookSetupExplorer -ExpectedId 1234 -StartedAt ($script:time.ToUniversalTime().ToString('o')) -Profile 'Profile Exchange'
if ([DmhOutlookSetupWindow]::Calls -ne 1) { throw 'Owned Inbox was not hidden' }
Hide-OutlookSetupExplorer -ExpectedId 0 -StartedAt '' -Profile 'Personal' -Authorized $true
if ([DmhOutlookSetupWindow]::Calls -ne 1) { throw 'Another profile was hidden' }
Hide-OutlookSetupExplorer -ExpectedId 0 -StartedAt '' -Profile 'Profile Exchange' -Authorized $true
if ([DmhOutlookSetupWindow]::Calls -ne 2) { throw 'Authorized resumed profile was not hidden' }
$script:inline = [pscustomobject]@{}
Hide-OutlookSetupExplorer -ExpectedId 0 -StartedAt '' -Profile 'Profile Exchange' -Authorized $true
if ([DmhOutlookSetupWindow]::Calls -ne 2) { throw 'Inline draft was hidden during resume' }
Write-Host 'PASS: setup hides only the matching Inbox Explorer, supports a replaced splash process and preserves active user work.'
