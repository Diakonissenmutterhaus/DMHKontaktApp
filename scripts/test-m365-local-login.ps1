# Portable silent-login probe. Run from the extracted test ZIP, without elevation.
# The helper has no interactive login path. Tokens stay in private pipes/memory.
param([string]$PackageDirectory = $PSScriptRoot, [string]$ReportDirectory = $PackageDirectory)
$ErrorActionPreference = 'Stop'
$report = [ordered]@{
    schemaVersion = 1
    test = 'automatic-work-account-v4-2026-11-14'
    generatedAt = [DateTime]::UtcNow.ToString('o')
    computer = $env:COMPUTERNAME
    windowsUser = [Security.Principal.WindowsIdentity]::GetCurrent().Name
    outcome = 'not_completed'
    failedStep = $null
    errorCode = $null
    steps = @()
    note = 'Tests automatic account selection, silent login and Graph identity only. No Outlook migration, app database changes or automatic report upload.'
}
$step = 'configuration'
$tokenResponse = $null; $http = $null; $handler = $null; $request = $null; $profile = $null
function Safe-Code([string]$Value, [string]$Default = 'unknown') {
    if ($Value -match '^[A-Za-z0-9_./-]{1,160}$') { return $Value }
    return $Default
}
function Invoke-PrivateHelper($Request) {
    $process = [Diagnostics.Process]::new()
    $output = $null
    try {
        $process.StartInfo.FileName = Join-Path $PackageDirectory 'helper\dmh-m365-wam.exe'
        $process.StartInfo.WorkingDirectory = Join-Path $PackageDirectory 'helper'
        $process.StartInfo.UseShellExecute = $false
        $process.StartInfo.CreateNoWindow = $true
        $process.StartInfo.RedirectStandardInput = $true
        $process.StartInfo.RedirectStandardOutput = $true
        $process.StartInfo.RedirectStandardError = $true
        if (-not $process.Start()) { throw 'helper_start_failed' }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        $process.StandardInput.WriteLine(($Request | ConvertTo-Json -Depth 5 -Compress))
        $process.StandardInput.Close()
        if (-not $process.WaitForExit(55000)) { $process.Kill(); throw 'helper_timeout' }
        if ($process.ExitCode -ne 0) { throw 'helper_exit_failed' }
        $output = $stdout.GetAwaiter().GetResult()
        if ($output.Length -gt 262144) { throw 'helper_response_invalid' }
        try { return ($output | ConvertFrom-Json -ErrorAction Stop) }
        catch { throw 'helper_response_invalid' }
    } finally {
        $output = $null; $stdout = $null; $stderr = $null
        $process.Dispose()
    }
}
function Safe-Diagnostic($Diagnostic) {
    if ($null -eq $Diagnostic) { return $null }
    # Export only these metadata fields, never the complete response or raw exception.
    $safe = [ordered]@{}
    foreach ($field in @('clientId','tenantId')) {
        $parsedId = [Guid]::Empty
        if ([Guid]::TryParse([string]$Diagnostic.$field, [ref]$parsedId)) { $safe[$field] = $parsedId.ToString() }
    }
    foreach ($field in @('stage','selectionSource')) { $safe[$field] = Safe-Code $Diagnostic.$field }
    foreach ($field in @('officeReadComplete','windowsRegistrationReadComplete')) {
        if ($Diagnostic.$field -is [bool]) { $safe[$field] = $Diagnostic.$field }
    }
    foreach ($field in @('officeIdentityCount','availableAccountCount','tenantAccountCount','windowsRegistrationCount')) {
        $count = 0
        if ($null -ne $Diagnostic.$field -and [int]::TryParse([string]$Diagnostic.$field,[ref]$count) -and $count -ge 0 -and $count -le 10000) {
            $safe[$field] = $count
        }
    }
    $email = [string]$Diagnostic.selectedEmail
    if ($email.Length -le 254 -and $email -match '^[^\s@]+@[^\s@]+$') { $safe.selectedEmail = $email }
    $safe.attempts = @($Diagnostic.attempts | Select-Object -First 3 | ForEach-Object {
        $attempt = [ordered]@{kind=(Safe-Code $_.kind);status=(Safe-Code $_.status);errorCode=(Safe-Code $_.errorCode 'none')}
        $correlation = [Guid]::Empty
        if ([Guid]::TryParse([string]$_.correlationId,[ref]$correlation)) { $attempt.correlationId = $correlation.ToString() }
        $attempt
    })
    return $safe
}
function Add-Result([string]$Name, [string]$Status) {
    $script:report.steps += [ordered]@{ name = $Name; status = $Status }
}
try {
    Write-Host 'DMH - Teste V4: selecao automatica da conta Microsoft'
    Write-Host 'Nao instala o app nem abre ou altera o Outlook. Aguarde ate 2 minutos.'
    $principal = [Security.Principal.WindowsPrincipal]::new([Security.Principal.WindowsIdentity]::GetCurrent())
    if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'run_without_administrator' }
    $config = Get-Content -LiteralPath (Join-Path $PackageDirectory 'public-config.json') -Raw | ConvertFrom-Json
    if (-not (Test-Path -LiteralPath (Join-Path $PackageDirectory 'helper\dmh-m365-wam.exe'))) { throw 'extract_entire_zip_first' }
    Add-Type -AssemblyName System.Net.Http
    Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DmhLocalTestWindow { [DllImport("user32.dll")] public static extern IntPtr GetDesktopWindow(); }'
    $request = @{
        clientId=[Guid]::Parse($config.clientId).ToString(); tenantId=[Guid]::Parse($config.tenantId).ToString()
        scopes=@($config.scopes); windowHandle=[DmhLocalTestWindow]::GetDesktopWindow().ToInt64()
        homeAccountId=$null; loginHint=$null; allowInteractive=$false; operation=$null
    }
    $report.helperSha256 = (Get-FileHash -LiteralPath (Join-Path $PackageDirectory 'helper\dmh-m365-wam.dll') -Algorithm SHA256).Hash
    $step = 'automatic_silent_login'
    Write-Host '[1/2] Procurando a conta registrada e conectando silenciosamente...'
    $tokenResponse = Invoke-PrivateHelper $request
    $report.loginDiagnostic = Safe-Diagnostic $tokenResponse.diagnostic
    if ($tokenResponse.status -ne 'connected' -or -not $tokenResponse.accessToken -or $tokenResponse.expiresIn -le 60) {
        throw (Safe-Code $tokenResponse.errorCode 'silent_login_not_available')
    }
    Add-Result $step 'connected'
    $step = 'graph_identity'
    Write-Host '[2/2] Confirmando a identidade no Microsoft 365...'
    $handler = [Net.Http.HttpClientHandler]::new()
    $handler.AllowAutoRedirect = $false
    $http = [Net.Http.HttpClient]::new($handler)
    $http.Timeout = [TimeSpan]::FromSeconds(20)
    $http.DefaultRequestHeaders.Authorization = [Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [string]$tokenResponse.accessToken)
    $response = $null; $text = $null
    try {
        $response = $http.GetAsync('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName').GetAwaiter().GetResult()
        if (-not $response.IsSuccessStatusCode) { throw ('graph_http_' + [int]$response.StatusCode) }
        $text = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
        try { $profile = $text | ConvertFrom-Json -ErrorAction Stop } catch { throw 'graph_response_invalid' }
    } finally { $text = $null; if ($response) { $response.Dispose() } }
    if (-not $profile.id) { throw 'graph_identity_missing' }
    $expected = [string]$tokenResponse.diagnostic.selectedEmail
    if ($expected -and $expected -notin @($profile.mail,$profile.userPrincipalName)) { throw 'graph_account_mismatch' }
    $report.account = @{ email=[string]$profile.mail; userPrincipalName=[string]$profile.userPrincipalName }
    Add-Result $step 'verified'
    $report.outcome = 'automatic_login_passed'
    Write-Host 'Login automatico confirmado. O Outlook nao foi alterado.' -ForegroundColor Green
} catch {
    $report.outcome = 'needs_review'
    $report.failedStep = $step
    $report.errorCode = Safe-Code $_.Exception.Message $_.Exception.GetType().Name
    Add-Result $step 'not_completed'
    Write-Host ('Teste interrompido: '+$step+' / '+$report.errorCode) -ForegroundColor Yellow
} finally {
    if ($tokenResponse) { $tokenResponse.accessToken = $null }
    if ($http) { $http.DefaultRequestHeaders.Authorization = $null; $http.Dispose() }
    if ($handler) { $handler.Dispose() }
    $tokenResponse = $null; $request = $null; $profile = $null
    $reportFile = Join-Path $ReportDirectory ('DMH-Login-V4-'+(Get-Date -Format 'yyyyMMdd-HHmmss')+'.json')
    $report | ConvertTo-Json -Depth 10 | Set-Content -LiteralPath $reportFile -Encoding UTF8
    Write-Host ('Envie este resultado: '+$reportFile)
}
