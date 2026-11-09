$ErrorActionPreference = 'Stop'
# Metadata fixtures only. No real profiles, messages, credentials or files read.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null; $parseErrors = $null
$ast = [System.Management.Automation.Language.Parser]::ParseFile((Resolve-Path -LiteralPath $source).ProviderPath, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw 'PowerShell syntax error' }
foreach ($name in @('Read-AccountString', 'Read-OutlookRegisteredProfile', 'Get-OutlookStartupSelection', 'Open-ExistingOutlookProfile', 'Test-OutlookUsableProfile', 'Set-OutlookAutomaticStartup')) {
    $definition = $ast.Find({ param($node) $node -is [System.Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq $name }, $true)
    Set-Item "Function:$name" $definition.Body.GetScriptBlock()
}
$script:requestedFields = @()
function New-TestKey {
    param($Values)
    $key = [pscustomobject]@{ Values = $Values }
    $key | Add-Member ScriptMethod GetValue {
        param($Name)
        $script:requestedFields += $Name
        if ($Name -match '(?i)password|credential|token') { throw 'Credential property requested' }
        return $this.Values[$Name]
    }
    $key | Add-Member ScriptMethod Dispose {}
    return $key
}
$script:accountKey = New-TestKey @{
    Email = 'imap@example.test'; 'IMAP Server' = 'imap.example.test'; 'IMAP User' = 'anna'; 'Display Name' = 'Anna'
}
$script:providerKey = New-TestKey @{
    '001f6641' = '=SMTP:exchange@example.test'; '001f3001' = 'Exchange';
    '001f6700' = 'C:\Archive\shared.pst'; '001f6610' = 'C:\Cache\anna.ost'
}
$script:deletedProfile = ''
function Test-Path {
    param($LiteralPath, $ErrorAction)
    if ($LiteralPath -like '*\Deleted Profiles\*') { return $script:deletedProfile -and $LiteralPath.EndsWith('\' + $script:deletedProfile) }
    return $true
}
function Get-ChildItem {
    param($LiteralPath, $ErrorAction)
    if ($LiteralPath -like '*9375CFF0413111d3B88A00104B2A6676') { [pscustomobject]@{ PSPath = 'account-fixture' } }
    else { [pscustomobject]@{ PSPath = 'provider-fixture' }; [pscustomobject]@{ PSPath = 'provider-fixture' } }
}
function Get-Item {
    param($LiteralPath, $ErrorAction)
    if ($LiteralPath -eq 'account-fixture') { return $script:accountKey }
    if ($LiteralPath -eq 'provider-fixture') { return $script:providerKey }
    throw 'Unexpected registry key'
}
function Get-ItemPropertyValue {
    param($LiteralPath, $Name, $ErrorAction)
    if ($Name -eq 'DefaultProfile') { return 'Profile Exchange 2' }
    if ($Name -eq 'PickLogonProfile') { return $script:promptValue }
    throw 'Unexpected startup setting'
}
$script:promptValue = '1'
$profile = Read-OutlookRegisteredProfile -Root 'HKCU:\Fixture' -Name 'Pilot'
if ($profile.source -ne 'registered' -or $profile.accounts.Count -ne 2 -or $profile.stores.Count -ne 2) { throw 'Incorrect registered metadata or duplicate handling' }
if (-not @($profile.accounts | Where-Object { $_.accountType -eq 'IMAP' -and $_.server -eq 'imap.example.test' -and $_.user -eq 'anna' }).Count) { throw 'IMAP account metadata missing' }
if (-not @($profile.stores | Where-Object { $_.kind -eq 'PST' -and $_.path -eq 'C:\Archive\shared.pst' -and $_.inbox -eq '' }).Count) { throw 'PST must be registered without a fabricated verified inbox' }
if (-not @($profile.stores | Where-Object kind -eq 'OST').Count) { throw 'OST metadata missing' }
if ($script:requestedFields -match '(?i)password|credential|token') { throw 'Sensitive field requested' }
$selection = Get-OutlookStartupSelection
if ($selection.defaultProfile -ne 'Profile Exchange 2' -or -not $selection.promptForProfile) { throw 'Default profile or startup prompt was misidentified' }
$script:deletedProfile = 'Profile Exchange 2'
if ((Get-OutlookStartupSelection).defaultProfile) { throw 'Deleted profile reported as usable default' }
$script:deletedProfile = ''
Write-Host 'PASS: default profile, startup prompt, IMAP/Exchange accounts, usernames, PST/OST paths, deduplication, unverified inboxes, no credential reads.'

$script:launches = @()
function Get-OutlookProfileNames { return @('Profile Exchange 2', 'Pilot Other') }
function Find-ClassicOutlook { return 'OUTLOOK.EXE' }
function Start-OutlookProfile {
    param($Executable, $Profile, $Email, $WindowsSso)
    if ($WindowsSso) { throw 'A one-time launch must not configure SSO preferences' }
    $script:launches += $Profile
}
$null = Open-ExistingOutlookProfile -Profile 'Pilot Other' -Running $false
if ($script:launches.Count -ne 1 -or $script:launches[0] -ne 'Pilot Other') { throw 'Selected profile was not passed to Outlook' }
if ((Get-OutlookStartupSelection).defaultProfile -ne 'Profile Exchange 2') { throw 'Default selection changed during one-time launch' }
$null = Open-ExistingOutlookProfile -Profile 'Pilot Other' -Running $true
if ($script:launches.Count -ne 1) { throw 'Must not start another profile while Outlook is open' }
$rejected = $false
try { $null = Open-ExistingOutlookProfile -Profile 'Missing Profile' -Running $false } catch { $rejected = $true }
if (-not $rejected -or $script:launches.Count -ne 1) { throw 'Unregistered profile was launched' }
Write-Host 'PASS: selected profile launches without default/SSO changes; running Outlook and missing profiles are handled.'

$script:promptWrites = @()
function Open-OutlookProfilePromptPreferences {
    $key = [pscustomobject]@{}
    $key | Add-Member ScriptMethod SetValue {
        param($Name, $Value, $Kind)
        if ($Name -ne 'PickLogonProfile' -or $Kind -ne [Microsoft.Win32.RegistryValueKind]::String) { throw 'Unexpected startup preference write' }
        $script:promptWrites += $Value
        $script:promptValue = $Value
    }
    $key | Add-Member ScriptMethod Dispose {}
    return $key
}
$result = Set-OutlookAutomaticStartup -Profile 'Profile Exchange 2'
if (-not $result.ok -or $result.promptForProfile -or $script:promptWrites.Count -ne 1 -or $script:promptValue -ne '0') { throw 'Automatic startup was not saved and read back' }
$script:deletedProfile = 'Profile Exchange 2'
$rejected = $false
try { Set-OutlookAutomaticStartup -Profile 'Profile Exchange 2' } catch { $rejected = $true }
if (-not $rejected -or $script:promptWrites.Count -ne 1) { throw 'Deleted target accepted for automatic startup' }
Write-Host 'PASS: automatic startup writes only the profile prompt preference, verifies it, and rejects deleted targets.'
