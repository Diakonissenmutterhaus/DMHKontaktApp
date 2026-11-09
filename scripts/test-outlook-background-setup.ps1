$ErrorActionPreference = 'Stop'
# In-memory process/COM doubles only. Never launches or closes real Outlook.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source).ProviderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'PowerShell syntax error' }
foreach ($name in @('Get-OwnedOutlookSetupProcess', 'Close-OutlookSetupProcess')) {
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
