$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'm365-development-environment.ps1')

# Test in a disposable directory with mocked GitHub authentication, never with
# real credentials or Outlook profiles. Run in a separate PowerShell process.
$testRoot = Join-Path ([IO.Path]::GetTempPath()) ('dmh-m365-config-test-' + [Guid]::NewGuid().ToString('N'))
[void][IO.Directory]::CreateDirectory($testRoot)
$testRoot = (Resolve-Path -LiteralPath $testRoot).ProviderPath
$config = Join-Path $testRoot '.local-m365.json'
$client = '11111111-1111-4111-8111-111111111111'
$tenant = '22222222-2222-4222-8222-222222222222'
$otherClient = '33333333-3333-4333-8333-333333333333'
$script:gitCalls = 0
$script:apiCalls = 0
$script:allowGit = $true

function gh { throw 'No authenticated gh session' }
function git {
    $script:gitCalls++
    if (-not $script:allowGit) { throw 'No Git credentials' }
    $global:LASTEXITCODE = 0
    'password=test-token-never-cache'
}
function Invoke-RestMethod {
    param($Uri, $Headers, $TimeoutSec, $ErrorAction)
    $script:apiCalls++
    if ($Headers.Authorization -ne 'Bearer test-token-never-cache') { throw 'Wrong authentication' }
    if ($Uri -eq 'https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/actions/variables/M365_CLIENT_ID') { return @{ value = $client } }
    if ($Uri -eq 'https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/actions/variables/M365_TENANT_ID') { return @{ value = $tenant } }
    throw 'Unexpected API endpoint'
}
function Assert-Rejected {
    param([string]$Pattern)
    $rejected = $false
    try { Import-M365DevelopmentEnvironment -ProjectRoot $testRoot } catch {
        $rejected = $_.Exception.Message -like $Pattern
    }
    if (-not $rejected) { throw "Expected rejection: $Pattern" }
}

try {
    $env:M365_CLIENT_ID = $null
    $env:M365_TENANT_ID = $null
    Import-M365DevelopmentEnvironment -ProjectRoot $testRoot
    if ($env:M365_CLIENT_ID -ne $client -or $env:M365_TENANT_ID -ne $tenant -or $script:apiCalls -ne 2) { throw 'Git credential fallback failed' }
    $cached = Get-Content -LiteralPath $config -Raw
    $document = $cached | ConvertFrom-Json
    if (@($document.PSObject.Properties).Count -ne 2 -or $cached.Contains('test-token')) { throw 'Cache contains more than public IDs' }

    $env:M365_CLIENT_ID = $null
    $env:M365_TENANT_ID = $null
    Import-M365DevelopmentEnvironment -ProjectRoot $testRoot
    if ($script:apiCalls -ne 2 -or $script:gitCalls -ne 1) { throw 'Offline cache used network authentication' }
    $env:M365_CLIENT_ID = $otherClient
    Import-M365DevelopmentEnvironment -ProjectRoot $testRoot
    if ($env:M365_CLIENT_ID -ne $otherClient) { throw 'Environment must take priority' }

    $cached = Get-Content -LiteralPath $config -Raw
    $env:M365_CLIENT_ID = 'not-a-guid'
    Assert-Rejected '*GUID*'
    if ((Get-Content -LiteralPath $config -Raw) -ne $cached) { throw 'Invalid input overwrote cache' }
    $env:M365_CLIENT_ID = '00000000-0000-0000-0000-000000000000'
    Assert-Rejected '*GUID*'
    '{invalid json' | Set-Content -LiteralPath $config
    Assert-Rejected '*JSON*'

    [IO.File]::Delete($config)
    $env:M365_CLIENT_ID = $null
    $env:M365_TENANT_ID = $null
    $script:allowGit = $false
    Assert-Rejected '*M365_CLIENT_ID fehlt*'
    if (Test-Path -LiteralPath $config) { throw 'Missing configuration created a cache' }
    Write-Host 'PASS: GitHub fallback, no token cache, offline loading, environment priority, invalid/empty GUIDs, malformed JSON, missing authentication.'
} finally {
    if ([IO.File]::Exists($config)) { [IO.File]::Delete($config) }
    [IO.Directory]::Delete($testRoot)
}
