$ErrorActionPreference = 'Stop'
# Synthetic registry only. Does not launch Office or read any real credentials.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source).ProviderPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'PowerShell syntax error' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-OfficeAccounts' }, $true)
Set-Item Function:Read-OfficeAccounts $definition.Body.GetScriptBlock()
$script:checks = 0
function Assert($Condition, $Message) { $script:checks++; if (-not $Condition) { throw $Message } }
function New-KeyFixture($Values = @{}, $Children = @{}, $DeniedField = '', $EnumerationDenied = $false) {
    $key = [pscustomobject]@{ Values = $Values; Children = $Children; DeniedField = $DeniedField; EnumerationDenied = $EnumerationDenied }
    $key | Add-Member ScriptMethod GetValue {
        param($Name)
        if ($Name -notin @('ADUserName', 'FriendlyName', 'EmailAddress', 'PreferredUsername', 'SigninName')) { throw 'Non-identity property requested' }
        if ($Name -eq $this.DeniedField) { throw 'Access denied fixture' }
        return $this.Values[$Name]
    }
    $key | Add-Member ScriptMethod GetSubKeyNames {
        if ($this.EnumerationDenied) { throw 'Access denied fixture' }
        return @($this.Children.Keys)
    }
    $key | Add-Member ScriptMethod OpenSubKey { param($Name) return $this.Children[$Name] }
    $key | Add-Member ScriptMethod Dispose {}
    return $key
}
function Open-OfficeIdentityRoot {
    param($Version, $View)
    if ($script:denied -eq "$Version/$View") { throw 'Access denied fixture' }
    return $script:roots["$Version/$View"]
}
$script:roots = @{}; $script:denied = ''
$anna = New-KeyFixture @{ EmailAddress = 'anna@example.test'; PreferredUsername = 'ANNA@example.test'; SigninName = 'anna@example.test'; FriendlyName = 'Anna' }
$admin = New-KeyFixture @{ EmailAddress = 'admin@tenant.onmicrosoft.com' }
$entries = New-KeyFixture @{} @{ anna = $anna }
$localRoot = New-KeyFixture @{} @{ Identities = $entries }
# Local Windows login: no ADUserName; Office identity exists in only one view.
$script:roots['16.0/Registry32'] = $localRoot
$result = Read-OfficeAccounts
Assert ($result.readSucceeded -and $result.accounts.Count -eq 1 -and $result.suggestedEmail -eq 'anna@example.test') 'Local account / x86 Office not found'
Assert ($result.sources.Count -eq 4) 'Did not inspect both versions and views'
Assert (-not $result.ContainsKey('activeExcelEmail')) 'Invented proof of active Excel account'
$script:roots['16.0/Registry64'] = $localRoot
Assert ((Read-OfficeAccounts).accounts.Count -eq 1) 'Duplicate registry views create duplicate accounts'
$script:roots = @{ '15.0/Registry32' = $localRoot }
Assert ((Read-OfficeAccounts).accounts.Count -eq 1) 'Older Office identity not found'
$script:roots = @{ '16.0/Registry64' = (New-KeyFixture @{ ADUserName = 'anna@example.test' } @{ Identities = (New-KeyFixture @{} @{ anna = $anna; admin = $admin }) }) }
Assert ((Read-OfficeAccounts).accounts.Count -eq 2) 'Conflicting account was hidden'
$script:roots = @{}
$result = Read-OfficeAccounts
Assert ($result.readSucceeded -and $result.accounts.Count -eq 0 -and -not $result.suggestedEmail) 'Missing data mistaken for an account'
Assert (@($result.sources | Where-Object state -ne 'missing').Count -eq 0) 'Missing data misreported'
$script:roots['16.0/Registry32'] = $localRoot
$script:denied = '16.0/Registry64'
$result = Read-OfficeAccounts
Assert (-not $result.readSucceeded) 'A partial read was accepted'
Assert (@($result.sources | Where-Object state -eq 'unreadable').Count -eq 1) 'Read error not diagnosed'
$script:denied = ''
$many = @{}
for ($i = 0; $i -lt 65; $i++) { $many["identity-$i"] = $anna }
$script:roots = @{ '16.0/Registry32' = (New-KeyFixture @{} @{ Identities = (New-KeyFixture @{} $many) }) }
Assert (-not (Read-OfficeAccounts).readSucceeded) 'Account limit silently truncates identities'
$script:roots = @{ '16.0/Registry32' = (New-KeyFixture @{} @{ Identities = (New-KeyFixture @{} @{ vanished = $null }) }) }
Assert (-not (Read-OfficeAccounts).readSucceeded) 'Disappeared identity accepted'
$broken = New-KeyFixture @{ EmailAddress = 'anna@example.test' } @{} 'PreferredUsername'
$script:roots = @{ '16.0/Registry32' = (New-KeyFixture @{} @{ Identities = (New-KeyFixture @{} @{ broken = $broken }) }) }
Assert (-not (Read-OfficeAccounts).readSucceeded) 'Partial fields accepted'
Write-Host "PASS: $script:checks Office identity checks (local Windows, 32/64-bit, older Office, conflicts, missing/unreadable metadata)."
