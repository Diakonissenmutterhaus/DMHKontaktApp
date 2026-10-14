param([Parameter(Mandatory)][string]$ConfigPath)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.Encoding]::UTF8
$config = Get-Content -LiteralPath $ConfigPath -Raw -Encoding UTF8 | ConvertFrom-Json
$sources = [Collections.Generic.List[object]]::new()
$issues = [Collections.Generic.List[string]]::new()
$folders = [Collections.Generic.List[object]]::new()
$writer = $null

function Release-Com($obj) {
  if ($null -ne $obj -and [Runtime.InteropServices.Marshal]::IsComObject($obj)) {
    [void][Runtime.InteropServices.Marshal]::ReleaseComObject($obj)
  }
}

function Read-Text($item, [string]$property) {
  try { return [string]$item.$property } catch { return '' }
}

function Get-StoreCopyKind($store, $accountType) {
  # IsDataFileStore is FALSE for IMAP, even when full messages are cached.
  # Identify IMAP via Account.DeliveryStore instead of treating it as absent.
  if ([int]$store.ExchangeStoreType -ne 3) {
    if ([bool]$store.IsCachedExchange -and [bool]$store.IsDataFileStore) { return 'Exchange' }
    return ''
  }
  if ($null -ne $accountType -and [int]$accountType -eq 1) { return 'IMAP' }
  if ([bool]$store.IsDataFileStore) {
    if ($null -ne $accountType -and [int]$accountType -eq 2) { return 'POP' }
    return 'PST'
  }
  return ''
}

function Read-FolderSortKey($folder) {
  $accessor = $null
  try {
    $accessor = $folder.PropertyAccessor
    # PR_SORT_POSITION (PT_BINARY): metadata only, never write Outlook properties.
    $bytes = $accessor.GetProperty('http://schemas.microsoft.com/mapi/proptag/0x30200102')
    return [string]$accessor.BinaryToString($bytes)
  } catch { return $null }
  finally { Release-Com $accessor }
}

function Preview-Folder($folder, [string]$storeId, [string]$path, [int]$depth = 0) {
  $children = $null
  try {
    if ($depth -gt 128 -or $folders.Count -gt 100000) { throw 'Ordnerstruktur zu groß.' }
    $folders.Add(@{sourceId=$storeId; path=$path; importedOrder=$folders.Count; sortKey=(Read-FolderSortKey $folder)})
    # Names/hierarchy only. Do not read Items or trigger a message download.
    $children = $folder.Folders
    for ($f = 1; $f -le $children.Count; $f++) {
      $child = $null
      try { $child = $children.Item($f); Preview-Folder $child $storeId ($path + '/' + [string]$child.Name) ($depth + 1) }
      finally { Release-Com $child }
    }
  } catch { $issues.Add("$path : Ordnerübersicht ist unvollständig. Bitte Outlook Classic prüfen.") }
  finally { Release-Com $children }
}

function Copy-Folder($folder, [string]$storeId, [string]$path) {
  $items = $null; $children = $null
  try {
    $folders.Add(@{sourceId=$storeId; path=$path; importedOrder=$folders.Count; sortKey=(Read-FolderSortKey $folder)})
    $items = $folder.Items
    $count = $items.Count
    for ($i = 1; $i -le $count; $i++) {
      $item = $null
      try {
        $item = $items.Item($i)
        # Include meeting invitations/responses, delivery reports and posts.
        if (@(43, 45, 46, 53, 54, 55, 56, 57) -notcontains [int]$item.Class) { continue }
        if ([int]$item.DownloadState -ne 1) {
          $issues.Add("$path : Eine Nachricht ist noch nicht vollständig heruntergeladen. Bitte in Outlook herunterladen und erneut kopieren.")
          continue
        }
        $file = [Guid]::NewGuid().ToString() + '.msg'
        $rawPath = Join-Path $config.destination $file
        $item.SaveAs($rawPath, 9)
        $attachments = [Collections.Generic.List[string]]::new()
        $collection = $null
        try {
          $collection = $item.Attachments
          for ($a = 1; $a -le $collection.Count; $a++) {
            $attachment = $null
            try { $attachment = $collection.Item($a); $attachments.Add([string]$attachment.FileName) }
            finally { Release-Com $attachment }
          }
        } finally { Release-Com $collection }
        $date = ''
        try { $date = $item.ReceivedTime.ToUniversalTime().ToString('o') } catch { }
        $body = ''
        try { $body = [string]$item.Body }
        catch { $issues.Add("$path : Der Text einer kopierten Nachricht konnte nicht gelesen werden. Die MSG-Kopie bleibt erhalten; bitte Outlook prüfen.") }
        $record = @{
          sourceId=$storeId; path=$path; nativeId=[string]$item.EntryID; rawFile=$file;
          subject=(Read-Text $item 'Subject'); sender=(Read-Text $item 'SenderName'); recipient=(Read-Text $item 'To');
          cc=(Read-Text $item 'CC'); date=$date; body=$body; html=''; attachments=@($attachments.ToArray())
        }
        $writer.WriteLine(($record | ConvertTo-Json -Depth 8 -Compress))
      } catch {
        $issues.Add("$path : Nachricht $i konnte nicht kopiert werden. Bitte Outlook prüfen und erneut kopieren.")
      } finally { Release-Com $item }
    }
    $children = $folder.Folders
    for ($f = 1; $f -le $children.Count; $f++) {
      $child = $null
      try { $child = $children.Item($f); Copy-Folder $child $storeId ($path + '/' + [string]$child.Name) }
      catch { $issues.Add("$path : Unterordner konnte nicht kopiert werden. Bitte Outlook prüfen.") }
      finally { Release-Com $child }
    }
  } catch {
    $issues.Add("$path : Ordner konnte nicht vollständig gelesen werden. Bitte Outlook prüfen und erneut kopieren.")
  } finally { Release-Com $children; Release-Com $items }
}

$outlook = $null; $session = $null; $stores = $null; $accounts = $null
try {
  # Only attach to the user's running Classic Outlook. Never start a client,
  # change its profile, call Send/Save, or modify unread/download flags.
  $outlook = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
  $session = $outlook.GetNamespace('MAPI')
  $accountTypes = @{}
  $accounts = $session.Accounts
  for ($a = 1; $a -le $accounts.Count; $a++) {
    $account = $null; $deliveryStore = $null
    try {
      $account = $accounts.Item($a)
      $deliveryStore = $account.DeliveryStore
      if ($null -ne $deliveryStore) { $accountTypes[[string]$deliveryStore.StoreID] = [int]$account.AccountType }
    } catch { $issues.Add('Ein Outlook-Kontotyp konnte nicht ermittelt werden. Bitte die Kontenauswahl prüfen.') }
    finally { Release-Com $deliveryStore; Release-Com $account }
  }
  $stores = $session.Stores
  if ($config.mode -eq 'copy') {
    $writer = [IO.StreamWriter]::new((Join-Path $config.destination 'messages.jsonl'), $false, [Text.UTF8Encoding]::new($false))
  }
  for ($s = 1; $s -le $stores.Count; $s++) {
    $store = $null; $root = $null
    try {
      $store = $stores.Item($s)
      $id = [string]$store.StoreID
      if ($config.mode -eq 'copy' -and @($config.sourceIds) -notcontains $id) { continue }
      $name = [string]$store.DisplayName
      $accountKind = Get-StoreCopyKind $store $accountTypes[$id]
      if (-not $accountKind) {
        $issues.Add("$name : Kein lokaler Outlook-Datenspeicher verfügbar. Bitte Offlinekopien in Outlook Classic einrichten.")
        continue
      }
      $sources.Add(@{id=$id; name=$name; kind='outlook'; accountKind=$accountKind; path=[string]$store.FilePath})
      if ($config.mode -eq 'scan') {
        $root = $store.GetRootFolder()
        Preview-Folder $root $id $name
      }
      if ($config.mode -eq 'copy' -and @($config.sourceIds) -contains $id) {
        $root = $store.GetRootFolder()
        Copy-Folder $root $id $name
      }
    } catch { $issues.Add('Ein Outlook-Datenspeicher konnte nicht gelesen werden. Bitte Outlook Classic prüfen.') }
    finally { Release-Com $root; Release-Com $store }
  }
} catch {
  $issues.Add('Für die Outlook-Kopie bitte Outlook Classic mit Ihrem Profil öffnen. Neues Outlook stellt diesen lokalen Zugriff nicht bereit.')
} finally {
  if ($null -ne $writer) { $writer.Dispose() }
  Release-Com $stores; Release-Com $accounts; Release-Com $session; Release-Com $outlook
}
@{sources=@($sources.ToArray()); folders=@($folders.ToArray()); issues=@($issues.ToArray())} | ConvertTo-Json -Depth 8 -Compress
