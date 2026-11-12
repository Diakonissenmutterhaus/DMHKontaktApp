# Runs the exact workflow script against a fake GitHub API. Never publishes.
$ErrorActionPreference = 'Stop'
$root = Split-Path $PSScriptRoot -Parent
$lines = Get-Content -LiteralPath (Join-Path $root '.github/workflows/ki-rollout.yml')
$start = [Array]::IndexOf($lines, '        run: |')
if ($start -lt 0) { throw 'Workflow script missing' }
$code = ($lines[($start + 1)..($lines.Length - 1)] | ForEach-Object { $_ -replace '^          ', '' }) -join "`n"
$scriptBlock = [ScriptBlock]::Create($code)
$keys = @('GH_TOKEN','REPOSITORY','ROLLOUT_MODE','ACTIVATE_AT','GITHUB_STEP_SUMMARY')
$previous = @{}
foreach ($key in $keys) { $previous[$key] = [Environment]::GetEnvironmentVariable($key) }
$summary = Join-Path ([IO.Path]::GetTempPath()) ('ki-rollout-test-' + [Guid]::NewGuid() + '.md')
try {
  $env:GH_TOKEN = 'fake-token-not-used-on-network'
  $env:REPOSITORY = 'Diakonissenmutterhaus/DMHKontaktApp'
  $env:GITHUB_STEP_SUMMARY = $summary
  foreach ($existing in @($false, $true)) {
    foreach ($mode in @('disabled','immediate','scheduled')) {
      $calls = [Collections.Generic.List[object]]::new()
      $env:ROLLOUT_MODE = $mode
      $env:ACTIVATE_AT = if ($mode -eq 'scheduled') { '2099-12-01T08:00:00+01:00' } else { '' }
      function Invoke-RestMethod {
        param($Method, $Uri, $Headers, $ErrorAction, $Body, $ContentType)
        if ($Uri -notlike 'https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/git/*') { throw 'Unexpected API' }
        $payload = if ($Body) { $Body | ConvertFrom-Json } else { $null }
        $calls.Add(@{ Method=$Method; Uri=$Uri; Payload=$payload })
        if ($Method -eq 'GET' -and $Uri.EndsWith('/git/ref/heads/feature-flags')) { return @{ object=@{ sha=$(if ($existing) { 'old-head' } else { $null }) } } }
        if ($Method -eq 'GET') { return @{ tree=@{ sha='old-tree' } } }
        return @{ sha='new-object' }
      }
      & $scriptBlock
      $blob = @($calls | Where-Object { $_.Uri.EndsWith('/git/blobs') })[0].Payload.content | ConvertFrom-Json
      if ($blob.schemaVersion -ne 1 -or $blob.enabled -ne ($mode -ne 'disabled')) { throw 'Wrong policy' }
      if ($mode -eq 'scheduled' -and ([DateTimeOffset]$blob.activateAt).UtcDateTime -ne [DateTime]::new(2099,12,1,7,0,0)) { throw 'Wrong timezone conversion' }
      if ($mode -ne 'scheduled' -and $null -ne $blob.activateAt) { throw 'Unexpected schedule' }
      $commit = @($calls | Where-Object { $_.Method -eq 'POST' -and $_.Uri.EndsWith('/git/commits') })[0].Payload
      if (@($commit.parents).Count -ne [int]$existing) { throw 'Wrong commit parents' }
      $last = $calls[$calls.Count - 1]
      if ($existing) {
        if ($last.Method -ne 'PATCH' -or -not $last.Uri.EndsWith('/git/refs/heads/feature-flags') -or $last.Payload.force) { throw 'Wrong branch update' }
      } elseif ($last.Payload.ref -ne 'refs/heads/feature-flags') { throw 'Wrong initial branch' }
    }
  }
  foreach ($invalid in @(@('scheduled','2099-12-01T08:00:00'), @('scheduled','2020-01-01T08:00:00Z'), @('immediate','2099-12-01T08:00:00Z'), @('invalid',''))) {
    $env:ROLLOUT_MODE=$invalid[0]; $env:ACTIVATE_AT=$invalid[1]
    $calls.Clear()
    $rejected=$false
    try { & $scriptBlock } catch { $rejected=$true }
    if (-not $rejected -or $calls.Count -ne 0) { throw 'Invalid request reached GitHub' }
  }
  Write-Output 'Passed: 6 publication simulations and 4 invalid requests; no network calls.'
} finally {
  foreach ($key in $keys) { [Environment]::SetEnvironmentVariable($key, $previous[$key]) }
  if (Test-Path -LiteralPath $summary) { Remove-Item -LiteralPath $summary }
}
