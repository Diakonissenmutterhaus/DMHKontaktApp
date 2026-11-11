$ErrorActionPreference = 'Stop'
# Exercise startup logic with in-memory preferences and a fake process. Never
# launch Outlook, edit its registry, or interact with an authentication dialog.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null
$parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $source).ProviderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'PowerShell syntax error' }
$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Start-OutlookProfile' }, $true)
Set-Item Function:Start-OutlookProfile $definition.Body.GetScriptBlock()
$script:email = 'anna@example.test'
$script:values = @{}
$script:launches = 0
$script:opened = 0
$script:failLaunch = $false
$script:expectSso = $true
$script:lastWindowStyle = ''
$script:fakeKey = [pscustomobject]@{}
$script:fakeKey | Add-Member ScriptMethod GetValueNames { @($script:values.Keys) }
$script:fakeKey | Add-Member ScriptMethod GetValue { param($name) $script:values[$name] }
$script:fakeKey | Add-Member ScriptMethod GetValueKind { param($name) [Microsoft.Win32.RegistryValueKind]::DWord }
$script:fakeKey | Add-Member ScriptMethod SetValue { param($name, $value, $kind) $script:values[$name] = $value }
$script:fakeKey | Add-Member ScriptMethod DeleteValue { param($name, $missing) $script:values.Remove($name) }
$script:fakeKey | Add-Member ScriptMethod Dispose {}
function Open-OutlookStartupPreferences { $script:opened++; return $script:fakeKey }
function Get-WindowsPrimarySmtp { return $script:email }
function Start-Sleep { param($Milliseconds) }
$script:startupHides = 0
function Hide-OutlookSetupExplorer {
    param($ExpectedId, $StartedAt, $Profile)
    if ($ExpectedId -ne 1234 -or -not $StartedAt -or $Profile -ne 'Profile Exchange') { throw 'Wrong background startup identity' }
    if ($script:values.ZeroConfigExchange -ne 1) { throw 'Startup hint removed before hiding the Inbox' }
    $script:startupHides++
}
function Start-Process {
    param($FilePath, $ArgumentList, $WindowStyle, [switch]$PassThru)
    if ($FilePath -ne 'OUTLOOK.EXE' -or ($ArgumentList -join ' ') -ne '/profile "Profile Exchange"') { throw 'Unexpected launch target' }
    if ($script:expectSso -and $script:values.ZeroConfigExchange -ne 1) { throw 'SSO hint absent at startup' }
    if ($script:failLaunch) { throw 'Simulated process failure' }
    $script:launches++
    $script:lastWindowStyle = $WindowStyle
    $process = [pscustomobject]@{ Id = 1234; StartTime = [datetime]'2026-11-09T10:00:00Z' }
    $process | Add-Member ScriptMethod WaitForInputIdle { param($timeout) return $true }
    $process | Add-Member ScriptMethod Dispose {}
    return $process
}
function Invoke-TestLaunch {
    Start-OutlookProfile -Executable 'OUTLOOK.EXE' -Profile 'Profile Exchange' -Email 'anna@example.test' -WindowsSso $script:expectSso
}

Invoke-TestLaunch
if ($script:launches -ne 1 -or $script:values.ContainsKey('ZeroConfigExchange')) { throw 'Absent preference not restored' }
$script:values.ZeroConfigExchange = 0
Invoke-TestLaunch
if ($script:values.ZeroConfigExchange -ne 0) { throw 'Previous preference not restored' }
$script:failLaunch = $true
$rejected = $false
try { Invoke-TestLaunch } catch { $rejected = $true }
if (-not $rejected -or $script:values.ZeroConfigExchange -ne 0) { throw 'Failure did not restore preference' }
$script:failLaunch = $false
$script:email = 'different@example.test'
$opened = $script:opened
$rejected = $false
try { Invoke-TestLaunch } catch { $rejected = $true }
if (-not $rejected -or $script:opened -ne $opened) { throw 'Mismatched Windows account accessed preferences' }
$script:expectSso = $false
Invoke-TestLaunch
if ($script:opened -ne $opened) { throw 'Non-SSO startup accessed preferences' }
$script:expectSso = $true
$script:email = 'anna@example.test'
$identity = Start-OutlookProfile -Executable 'OUTLOOK.EXE' -Profile 'Profile Exchange' -Email 'anna@example.test' -WindowsSso $true -Background $true
if ($script:lastWindowStyle -ne 'Hidden' -or $identity.processId -ne 1234 -or -not $identity.startedAt) { throw 'Background startup lost process ownership or displayed Outlook' }
if ($script:startupHides -ne 6) { throw 'Inbox hiding did not run during background SSO initialization' }
Write-Host 'PASS: matching identity, exact profile launch, temporary SSO preference, restoration on success/failure, mismatched account refused, MAPI fallback.'

$definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Get-OutlookProfileNames' }, $true)
Set-Item Function:Get-OutlookProfileNames $definition.Body.GetScriptBlock()
function Test-Path { param($LiteralPath, $ErrorAction) return $LiteralPath -like '*16.0*' }
function Get-ChildItem {
    param($LiteralPath, $ErrorAction)
    [pscustomobject]@{ PSChildName = 'Outlook' }
    [pscustomobject]@{ PSChildName = 'Profile Exchange 2' }
}
$names = @(Get-OutlookProfileNames)
if ($names.Count -ne 2 -or $names -notcontains 'Profile Exchange 2') { throw 'Registry-only profile missing from inventory' }
Write-Host 'PASS: registry-only incomplete profile names are included in collision detection.'
