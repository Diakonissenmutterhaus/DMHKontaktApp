# Embedded by the native app. Input is JSON on a private stdin pipe, never code.
# No credentials, registry profile edits, Outlook Quit, or forced process exits.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)

function Find-ClassicOutlook {
    foreach ($hive in @([Microsoft.Win32.RegistryHive]::LocalMachine, [Microsoft.Win32.RegistryHive]::CurrentUser)) {
        foreach ($view in @([Microsoft.Win32.RegistryView]::Registry64, [Microsoft.Win32.RegistryView]::Registry32)) {
            $base = $null
            $key = $null
            try {
                $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey($hive, $view)
                $key = $base.OpenSubKey('SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths\OUTLOOK.EXE')
                if ($null -ne $key) {
                    $candidate = ([string]$key.GetValue('')).Trim('"')
                    if (([IO.Path]::GetFileName($candidate) -ieq 'OUTLOOK.EXE') -and [IO.File]::Exists($candidate)) {
                        return $candidate
                    }
                }
            } catch {
                # Try the other installed Office architecture.
            } finally {
                if ($null -ne $key) { $key.Dispose() }
                if ($null -ne $base) { $base.Dispose() }
            }
        }
    }
    return ''
}

function Read-ExchangeConnection {
    $app = $null
    $session = $null
    $accounts = $null
    $items = @()
    try {
        # Attach only: never instantiate Outlook or log on from a status check.
        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $session = $app.Session
        $profile = [string]$session.CurrentProfileName
        $accounts = $session.Accounts
        for ($index = 1; $index -le $accounts.Count; $index++) {
            $account = $null
            $store = $null
            try {
                $account = $accounts.Item($index)
                if ([int]$account.AccountType -ne 0) { continue }
                $store = $account.DeliveryStore
                if ($null -eq $store) { continue }
                $items += @{
                    email = [string]$account.SmtpAddress
                    accountType = [int]$account.AccountType
                    connectionMode = [int]$account.ExchangeConnectionMode
                    storeType = [int]$store.ExchangeStoreType
                }
            } catch {
                # An account still being configured is not proof of connectivity.
            } finally {
                if ($null -ne $store) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($store) }
                if ($null -ne $account) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($account) }
            }
        }
        return @{ activeProfile = $profile; accounts = @($items) }
    } catch {
        return @{ activeProfile = ''; accounts = @() }
    } finally {
        if ($null -ne $accounts) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($accounts) }
        if ($null -ne $session) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($session) }
        if ($null -ne $app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
    }
}

try {
    $request = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $running = @(Get-Process -Name 'OUTLOOK' -ErrorAction SilentlyContinue).Count -gt 0
    switch ([string]$request.operation) {
        'inventory' {
            $result = @{ executable = (Find-ClassicOutlook); running = $running }
        }
        'probe' {
            $result = Read-ExchangeConnection
        }
        'launch' {
            if ($running) {
                $result = @{ launched = $false }
            } else {
                $executable = Find-ClassicOutlook
                if ([string]::IsNullOrWhiteSpace($executable)) { throw 'CLASSIC_OUTLOOK_MISSING' }
                $profile = [string]$request.profile
                if ($profile -notmatch '^[A-Za-z0-9][A-Za-z0-9 _-]{0,63}$') { throw 'INVALID_PROFILE_NAME' }
                # This is the interactive Outlook window requested by the user.
                Start-Process -FilePath $executable -ArgumentList @('/profile', ('"' + $profile + '"')) -WindowStyle Normal | Out-Null
                $result = @{ launched = $true }
            }
        }
        default { throw 'INVALID_OPERATION' }
    }
    [Console]::Write(($result | ConvertTo-Json -Depth 6 -Compress))
} catch {
    [Console]::Write('{"error":"Outlook Classic konnte nicht angesprochen werden. Bitte Outlook-Dialoge schließen und erneut versuchen."}')
    exit 1
}
