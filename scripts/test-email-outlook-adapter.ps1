param()
$ErrorActionPreference = 'Stop'
# Test the actual adapter functions with fake stores and messages. No Outlook
# instance, account, message or download settings are touched by these tests.
$adapter = Join-Path $PSScriptRoot '../src-tauri/src/email_archive_outlook.ps1'
$tokens = $null; $parseErrors = $null
$ast = [Management.Automation.Language.Parser]::ParseFile($adapter, [ref]$tokens, [ref]$parseErrors)
if ($parseErrors.Count) { throw ($parseErrors | Out-String) }
foreach ($function in $ast.FindAll({ param($node) $node -is [Management.Automation.Language.FunctionDefinitionAst] }, $false)) {
  . ([scriptblock]::Create($function.Extent.Text))
}
function Assert-Equal($actual, $expected, [string]$label) {
  if ($actual -cne $expected) { throw "$label : expected '$expected', got '$actual'" }
}
class FixtureCollection {
  [object[]]$Entries
  [int]$Count
  FixtureCollection([object[]]$entries) { $this.Entries = $entries; $this.Count = $entries.Count }
  [object] Item([int]$index) { return $this.Entries[$index - 1] }
}
class FixtureMail {
  [int]$Class = 43
  [int]$DownloadState
  [string]$EntryID
  [string]$Subject = 'Fixture subject'
  [string]$SenderName = 'Fixture sender'
  [string]$To = 'reader@example.test'
  [string]$CC = ''
  [string]$Body = 'Fixture body'
  [datetime]$ReceivedTime = [datetime]'2026-10-14T10:00:00Z'
  [FixtureCollection]$Attachments = [FixtureCollection]::new(@())
  FixtureMail([string]$id, [int]$state) { $this.EntryID=$id; $this.DownloadState=$state }
  [void] SaveAs([string]$path, [int]$format) {
    if ($format -ne 9) { throw 'Expected MSG Unicode format' }
    [IO.File]::WriteAllText($path, 'fixture msg snapshot')
  }
}
$imap = [pscustomobject]@{ExchangeStoreType=3;IsDataFileStore=$false;IsCachedExchange=$false}
$exchange = [pscustomobject]@{ExchangeStoreType=0;IsDataFileStore=$true;IsCachedExchange=$true}
$online = [pscustomobject]@{ExchangeStoreType=0;IsDataFileStore=$false;IsCachedExchange=$false}
$pst = [pscustomobject]@{ExchangeStoreType=3;IsDataFileStore=$true;IsCachedExchange=$false}
Assert-Equal (Get-StoreCopyKind $imap 1) 'IMAP' 'IMAP with IsDataFileStore=false must be included'
Assert-Equal (Get-StoreCopyKind $exchange 0) 'Exchange' 'Cached Exchange'
Assert-Equal (Get-StoreCopyKind $online 0) '' 'Online-only Exchange must stay excluded'
Assert-Equal (Get-StoreCopyKind $imap $null) '' 'Unknown remote provider must stay excluded'
Assert-Equal (Get-StoreCopyKind $imap 3) '' 'HTTP provider must stay excluded'
Assert-Equal (Get-StoreCopyKind $pst 2) 'POP' 'POP local data'
Assert-Equal (Get-StoreCopyKind $pst $null) 'PST' 'Attached PST'
$fixtureRoot = Join-Path ([IO.Path]::GetTempPath()) ('dmh-email-adapter-' + [guid]::NewGuid())
[void][IO.Directory]::CreateDirectory($fixtureRoot)
$writer = $null
try {
  $config = [pscustomobject]@{destination=$fixtureRoot}
  $issues = [Collections.Generic.List[string]]::new()
  $folders = [Collections.Generic.List[object]]::new()
  $full = [FixtureMail]::new('full', 1)
  $header = [FixtureMail]::new('header', 0)
  $unknown = [FixtureMail]::new('unknown', 2)
  $child = [pscustomobject]@{Name='Work';Items=[FixtureCollection]::new(@([FixtureMail]::new('nested', 1)));Folders=[FixtureCollection]::new(@())}
  $folder = [pscustomobject]@{Name='Inbox';Items=[FixtureCollection]::new(@($full,$header,$unknown));Folders=[FixtureCollection]::new(@($child))}
  $jsonPath = Join-Path $fixtureRoot 'messages.jsonl'
  $writer = [IO.StreamWriter]::new($jsonPath, $false, [Text.UTF8Encoding]::new($false))
  Copy-Folder $folder 'imap-store' 'same@example.test/Inbox'
  $writer.Dispose(); $writer=$null
  $records = @(Get-Content -LiteralPath $jsonPath | ForEach-Object { $_ | ConvertFrom-Json })
  Assert-Equal $records.Count 2 'Only full messages are copied, including subfolders'
  Assert-Equal $records[0].nativeId 'full' 'Header-only/unknown states must not be exported'
  Assert-Equal $records[1].path 'same@example.test/Inbox/Work' 'IMAP subfolder hierarchy'
  Assert-Equal $issues.Count 2 'Skipped messages must make the copy incomplete'
  Assert-Equal @(Get-ChildItem -LiteralPath $fixtureRoot -Filter '*.msg').Count 2 'Raw copies'
  Assert-Equal $header.DownloadState 0 'No download state changes'
  Assert-Equal $full.Body 'Fixture body' 'No message edits'
} finally {
  if ($null -ne $writer) { $writer.Dispose() }
  # Exactly this newly created fixture directory; no computed client path.
  $resolvedFixture = [IO.Path]::GetFullPath($fixtureRoot)
  $resolvedTemp = [IO.Path]::GetFullPath([IO.Path]::GetTempPath())
  if (-not $resolvedFixture.StartsWith($resolvedTemp, [StringComparison]::OrdinalIgnoreCase) -or (Split-Path $resolvedFixture -Leaf) -notlike 'dmh-email-adapter-*') { throw 'Unsafe fixture cleanup path' }
  Remove-Item -LiteralPath $resolvedFixture -Recurse -Force
}
Write-Output 'Outlook adapter: IMAP/Exchange/POP/PST detection, offline guards, recursive copying and originals passed.'
