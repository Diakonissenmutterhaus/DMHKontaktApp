$ErrorActionPreference = 'Stop'
# Registry metadata doubles only. Never opens Office or reads real credentials.
$source = Join-Path $PSScriptRoot '..\src-tauri\src\outlook_exchange_profile.ps1'
$tokens = $null; $errors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile((Resolve-Path $source).ProviderPath, [ref]$tokens, [ref]$errors)
if ($errors.Count) { throw 'PowerShell syntax error' }
$definition = $ast.Find({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] -and $node.Name -eq 'Read-OfficeAccounts' }, $true)
Set-Item Function:Read-OfficeAccounts $definition.Body.GetScriptBlock()
$script:fields = @(); $script:available = $true; $script:denied = $false
function New-KeyFixture($Values) {
    $key = [pscustomobject]@{ Values = $Values }
    $key | Add-Member ScriptMethod GetValue {
        param($Name)
        $script:fields += $Name
        if ($Name -notin @('ADUserName', 'FriendlyName', 'EmailAddress', 'PreferredUsername', 'SigninName')) { throw 'Non-identity property requested' }
        return $this.Values[$Name]
    }
    $key | Add-Member ScriptMethod Dispose {}
    return $key
}
function Test-Path { param($LiteralPath) return $script:available -and $LiteralPath -like '*16.0*' }
function Get-Item {
    param($LiteralPath, $ErrorAction)
    if ($LiteralPath -eq 'office-anna') { return New-KeyFixture @{ EmailAddress = 'anna@example.test'; PreferredUsername = 'ANNA@example.test'; SigninName = 'anna@example.test'; FriendlyName = 'Anna' } }
    if ($LiteralPath -eq 'office-admin') { return New-KeyFixture @{ EmailAddress = 'admin@tenant.onmicrosoft.com'; FriendlyName = 'Admin' } }
    return New-KeyFixture @{ ADUserName = 'anna@example.test' }
}
function Get-ChildItem {
    param($LiteralPath, $ErrorAction)
    if ($script:denied) { throw 'Access denied fixture' }
    [pscustomobject]@{ PSPath = 'office-anna' }
    [pscustomobject]@{ PSPath = 'office-admin' }
}
$result = Read-OfficeAccounts
if ($result.accounts.Count -ne 2 -or $result.suggestedEmail -ne 'anna@example.test' -or -not $result.readSucceeded) { throw 'Office identities, suggestion or deduplication incorrect' }
if ($result.ContainsKey('activeExcelEmail')) { throw 'Cached identities misrepresented as active Excel identity' }
$script:available = $false
$result = Read-OfficeAccounts
if ($result.accounts.Count -ne 0 -or $result.suggestedEmail) { throw 'Invented an identity for absent Office metadata' }
$script:available = $true; $script:denied = $true
if ((Read-OfficeAccounts).readSucceeded) { throw 'Unreadable metadata claimed to be reliable' }
Write-Host 'PASS: whitelisted Office metadata, multiple identities, deduplication, absent/unreadable registry, no invented active Excel account.'
