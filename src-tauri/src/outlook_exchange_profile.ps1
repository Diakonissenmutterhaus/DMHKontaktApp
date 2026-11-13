# Embedded by the native app. Input is JSON on a private stdin pipe, never code.
# No credentials, registry profile edits, or forced process exits. Graceful Quit
# is allowed only for the exact process launched by this setup, without edits.
param([string]$RequestJson)
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

function Get-OutlookProfileNames {
    # Incomplete profiles can be absent from MAPI's profile table, but still
    # reserve their names. Read names only; never read account/credential values.
    $paths = @(
        'HKCU:\Software\Microsoft\Office\16.0\Outlook\Profiles',
        'HKCU:\Software\Microsoft\Office\15.0\Outlook\Profiles',
        'HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows Messaging Subsystem\Profiles'
    )
    $names = @()
    foreach ($path in $paths) {
        if (Test-Path -LiteralPath $path -ErrorAction Stop) {
            $names += @(Get-ChildItem -LiteralPath $path -ErrorAction Stop | Select-Object -ExpandProperty PSChildName)
        }
    }
    return @($names | Sort-Object -Unique)
}

function Get-WindowsPrimarySmtp {
    # ZeroConfigExchange chooses the AD primary SMTP identity, not a Graph token.
    # Never enable it when that identity differs from the account chosen in DMH.
    try {
        $policy = Get-ItemProperty -LiteralPath 'HKCU:\Software\Policies\Microsoft\Office\16.0\Outlook\AutoDiscover' -ErrorAction SilentlyContinue
        if ($null -ne $policy -and $null -ne $policy.ZeroConfigExchange -and [int]$policy.ZeroConfigExchange -eq 0) { return '' }
        Add-Type -AssemblyName System.DirectoryServices.AccountManagement
        $user = [System.DirectoryServices.AccountManagement.UserPrincipal]::Current
        try { return ([string]$user.EmailAddress).Trim() } finally { if ($null -ne $user) { $user.Dispose() } }
    } catch { return '' }
}

function Open-OfficeIdentityRoot {
    param([string]$Version, [string]$View)
    # HKCU belongs to the signed-in application user, including local accounts.
    # Explicit views avoid inheriting the architecture of powershell.exe.
    $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey(
        [Microsoft.Win32.RegistryHive]::CurrentUser,
        [Microsoft.Win32.RegistryView]::$View
    )
    try { return $base.OpenSubKey("Software\Microsoft\Office\$Version\Common\Identity") }
    finally { $base.Dispose() }
}

function Read-OfficeAccounts {
    # Metadata only: no Office tokens, cookies, credentials or license files.
    # A missing registry entry does not mean Excel is signed out.
    $accounts = @(); $preferred = @(); $readSucceeded = $true; $sources = @()
    foreach ($version in @('16.0', '15.0')) {
        foreach ($view in @('Registry64', 'Registry32')) {
            $root = $null; $identities = $null
            $source = @{ version = $version; view = $view; state = 'missing'; identityCount = 0 }
            try {
                $root = Open-OfficeIdentityRoot -Version $version -View $view
                if ($null -eq $root) { continue }
                $source.state = 'read'
                $candidate = ([string]$root.GetValue('ADUserName')).Trim()
                if ($candidate.Length -le 254 -and $candidate -match '^[^\s@]+@[^\s@]+$') { $preferred += $candidate }
                $identities = $root.OpenSubKey('Identities')
                if ($null -eq $identities) { continue }
                $names = @($identities.GetSubKeyNames())
                $source.identityCount = $names.Count
                if ($names.Count -gt 64) { throw 'identity_limit' }
                foreach ($name in $names) {
                    $entry = $identities.OpenSubKey($name)
                    if ($null -eq $entry) { throw 'identity_disappeared' }
                    try {
                        $displayName = [string]$entry.GetValue('FriendlyName')
                        foreach ($field in @('EmailAddress', 'PreferredUsername', 'SigninName')) {
                            $email = ([string]$entry.GetValue($field)).Trim()
                            if ($email.Length -gt 254 -or $email -notmatch '^[^\s@]+@[^\s@]+$') { continue }
                            if (@($accounts | Where-Object { $_.email -ieq $email }).Count -eq 0) {
                                $accounts += @{ email = $email; displayName = $displayName }
                            }
                        }
                    } finally { $entry.Dispose() }
                }
            } catch {
                $readSucceeded = $false
                $source.state = 'unreadable'
            } finally {
                if ($null -ne $identities) { $identities.Dispose() }
                if ($null -ne $root) { $root.Dispose() }
                $sources += $source
            }
        }
    }
    foreach ($email in @($preferred | Select-Object -Unique)) {
        if (@($accounts | Where-Object { $_.email -ieq $email }).Count -eq 0) { $accounts += @{ email = $email; displayName = '' } }
    }
    $suggested = if ($preferred.Count) { $preferred[0] } elseif ($accounts.Count -eq 1) { $accounts[0].email } else { '' }
    return @{ accounts = @($accounts); suggestedEmail = $suggested; readSucceeded = $readSucceeded; sources = @($sources) }
}

function Open-OutlookStartupPreferences {
    return [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Office\16.0\Outlook\AutoDiscover')
}

function Start-OutlookProfile {
    param([string]$Executable, [string]$Profile, [string]$Email, [bool]$WindowsSso, [bool]$Background = $false)
    $style = if ($Background) { 'Hidden' } else { 'Normal' }
    if (-not $WindowsSso) {
        $process = Start-Process -FilePath $Executable -ArgumentList @('/profile', ('"' + $Profile + '"')) -WindowStyle $style -PassThru
        try { if ($Background) { return @{ processId = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o') } } } finally { $process.Dispose() }
        return
    }
    $primarySmtp = Get-WindowsPrimarySmtp
    if ([string]::IsNullOrWhiteSpace($Email) -or [string]::IsNullOrWhiteSpace($primarySmtp) -or $primarySmtp -ine $Email) { throw 'WINDOWS_ACCOUNT_MISMATCH' }
    $key = Open-OutlookStartupPreferences
    $hadValue = $key.GetValueNames() -contains 'ZeroConfigExchange'
    $previousValue = $key.GetValue('ZeroConfigExchange')
    $previousKind = if ($hadValue) { $key.GetValueKind('ZeroConfigExchange') } else { $null }
    try {
        # Scoped startup preference only. Do not edit company policies, Office
        # credentials, other profiles, or any authentication/security setting.
        $key.SetValue('ZeroConfigExchange', 1, [Microsoft.Win32.RegistryValueKind]::DWord)
        $process = Start-Process -FilePath $Executable -ArgumentList @('/profile', ('"' + $Profile + '"')) -WindowStyle $style -PassThru
        $identity = @{ processId = $process.Id; startedAt = $process.StartTime.ToUniversalTime().ToString('o') }
        try {
            # Keep the hint until Outlook has initialized its profile UI. This
            # wait is bounded and does not interact with any authentication UI.
            try {
                $idleTimeout = if ($Background) { 500 } else { 10000 }
                [void]$process.WaitForInputIdle($idleTimeout)
            } catch { }
            if ($Background) {
                # Do not call Outlook COM during launch: startup can block it
                # indefinitely. Return the process identity so Rust can persist
                # ownership and start the separate visibility watcher.
                Start-Sleep -Milliseconds 1500
            } else { Start-Sleep -Milliseconds 1500 }
        } finally { $process.Dispose() }
        if ($Background) { return $identity }
    } finally {
        if ($hadValue) { $key.SetValue('ZeroConfigExchange', $previousValue, $previousKind) }
        else { $key.DeleteValue('ZeroConfigExchange', $false) }
        $key.Dispose()
    }
}

function Get-OwnedOutlookSetupProcess {
    param([int]$ExpectedId, [string]$StartedAt)
    $processes = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
    if ($processes.Count -ne 1 -or $ExpectedId -le 0 -or -not $StartedAt) { return $null }
    $process = $processes[0]
    if ($process.Id -ne $ExpectedId -or $process.StartTime.ToUniversalTime().ToString('o') -cne $StartedAt) { return $null }
    return $process
}

function Get-RunningOutlookApplication {
    return [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
}

function Release-OutlookSetupObject {
    param($Object)
    if ($null -ne $Object) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($Object) }
}

function Hide-OutlookSetupExplorer {
    param([int]$ExpectedId, [string]$StartedAt, [string]$Profile, [bool]$Authorized = $false)
    $process = Get-OwnedOutlookSetupProcess -ExpectedId $ExpectedId -StartedAt $StartedAt
    # A resumed, explicitly authorized migration may attach the matching profile
    # even if Outlook replaced its splash process. No other profile is hidden.
    if ($null -eq $process -and $Authorized) {
        $processes = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
        if ($processes.Count -eq 1) { $process = $processes[0] }
    }
    if ($null -eq $process) { return }
    $app = $null; $session = $null; $explorers = $null
    try {
        $app = Get-RunningOutlookApplication
        $session = $app.Session
        if ([string]$session.CurrentProfileName -ine $Profile) { return }
        if ($Authorized) {
            $inspectors = $null
            try { $inspectors = $app.Inspectors; if ($inspectors.Count -gt 0) { return } }
            finally { Release-OutlookSetupObject $inspectors }
        }
        if (-not ('DmhOutlookSetupWindow' -as [type])) {
            Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public static class DmhOutlookSetupWindow { [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr hwnd, int show); }'
        }
        $explorers = $app.Explorers
        for ($i = 1; $i -le $explorers.Count; $i++) {
            $explorer = $null
            try {
                $explorer = $explorers.Item($i)
                if ($Authorized) {
                    $inline = $null
                    try { $inline = $explorer.ActiveInlineResponse; if ($null -ne $inline) { return } }
                    finally { Release-OutlookSetupObject $inline }
                }
                # Only the Inbox explorer is hidden. Authentication, MFA and
                # account-setup dialogs are separate windows and remain usable.
                [void][DmhOutlookSetupWindow]::ShowWindowAsync([IntPtr]$explorer.HWND, 0)
            } finally { Release-OutlookSetupObject $explorer }
        }
    } catch { } finally {
        foreach ($object in @($explorers, $session, $app)) { Release-OutlookSetupObject $object }
        $process.Dispose()
    }
}

function Close-OutlookSetupProcess {
    param([int]$ExpectedId, [string]$StartedAt, [string]$Profile, [int]$WaitMs = 8000)
    $process = Get-OwnedOutlookSetupProcess -ExpectedId $ExpectedId -StartedAt $StartedAt
    if ($null -eq $process) { return @{ closed = $false; reason = 'not_owned' } }
    $app = $null; $session = $null; $inspectors = $null; $explorers = $null
    try {
        $app = Get-RunningOutlookApplication
        $session = $app.Session
        if ([string]$session.CurrentProfileName -ine $Profile) { return @{ closed = $false; reason = 'not_owned' } }
        $inspectors = $app.Inspectors
        if ($inspectors.Count -gt 0) { return @{ closed = $false; reason = 'user_work'; evidence = 'inspectors'; inspectorCount = $inspectors.Count; processId = $ExpectedId; profile = $Profile } }
        $explorers = $app.Explorers
        for ($i = 1; $i -le $explorers.Count; $i++) {
            $explorer = $null; $inline = $null
            try {
                $explorer = $explorers.Item($i)
                $inline = $explorer.ActiveInlineResponse
                if ($null -ne $inline) { return @{ closed = $false; reason = 'user_work'; evidence = 'inline_response'; processId = $ExpectedId; profile = $Profile } }
            } finally {
                Release-OutlookSetupObject $inline
                Release-OutlookSetupObject $explorer
            }
        }
        # Recheck identity immediately before graceful shutdown. Never kill or
        # close an Outlook the user already had open or restarted themselves.
        if ($null -eq (Get-OwnedOutlookSetupProcess -ExpectedId $ExpectedId -StartedAt $StartedAt)) { return @{ closed = $false; reason = 'not_owned' } }
        $app.Quit()
    } catch { return @{ closed = $false; reason = 'not_ready'; hresult = $_.Exception.HResult; exceptionType = $_.Exception.GetType().FullName; scriptLine = $_.InvocationInfo.ScriptLineNumber; processId = $ExpectedId } }
    finally {
        foreach ($object in @($explorers, $inspectors, $session, $app)) { Release-OutlookSetupObject $object }
        $process.Dispose()
    }
    # Release COM before waiting for Outlook to finish flushing the profile.
    $remaining = Get-Process -Id $ExpectedId -ErrorAction SilentlyContinue
    if ($null -eq $remaining) { return @{ closed = $true } }
    try { return @{ closed = $remaining.WaitForExit($WaitMs); reason = 'closing' } } finally { $remaining.Dispose() }
}

function Close-OutlookForMigration {
    param([bool]$Authorized, [string]$ExpectedProfile = '')
    if (-not $Authorized) { return @{ closed = $false; reason = 'not_authorized' } }
    $processes = @(Get-Process -Name OUTLOOK -ErrorAction SilentlyContinue)
    if ($processes.Count -eq 0) { return @{ closed = $true } }
    if ($processes.Count -ne 1) { return @{ closed = $false; reason = 'not_owned'; processCount = $processes.Count; processIds = @($processes | ForEach-Object { $_.Id }) } }
    $app = $null; $session = $null
    try {
        $process = $processes[0]
        $expectedId = $process.Id
        $startedAt = $process.StartTime.ToUniversalTime().ToString('o')
        $app = Get-RunningOutlookApplication
        $session = $app.Session
        $profile = [string]$session.CurrentProfileName
        if (-not $profile) { return @{ closed = $false; reason = 'not_ready' } }
        if ($ExpectedProfile -and $profile -ine $ExpectedProfile) { return @{ closed = $false; reason = 'not_owned' } }
    } catch { return @{ closed = $false; reason = 'not_ready'; hresult = $_.Exception.HResult; exceptionType = $_.Exception.GetType().FullName; scriptLine = $_.InvocationInfo.ScriptLineNumber; processId = $expectedId } }
    finally {
        foreach ($object in @($session, $app)) { Release-OutlookSetupObject $object }
        foreach ($candidate in $processes) { $candidate.Dispose() }
    }
    # Explicit migration click permits graceful shutdown of the existing session.
    # Reuse exact process/start/profile checks and protect inspectors/inline drafts.
    return Close-OutlookSetupProcess -ExpectedId $expectedId -StartedAt $startedAt -Profile $profile -WaitMs 20000
}

function Open-ExistingOutlookProfile {
    param([string]$Profile, [bool]$Running)
    if (-not $Profile -or $Profile -match '["\\/\x00-\x1f]' -or $Profile.Length -gt 64 -or @(Get-OutlookProfileNames) -notcontains $Profile) { throw 'INVALID_PROFILE' }
    $selection = Get-OutlookStartupSelection
    if (-not (Test-OutlookUsableProfile -Root $selection.root -Name $Profile)) { throw 'PROFILE_NO_LONGER_AVAILABLE' }
    if ($Running) {
        return @{ message = 'Outlook ist bereits geöffnet. Zum Profilwechsel zuerst Ihre Arbeit speichern und Outlook schließen.' }
    }
    $executable = Find-ClassicOutlook
    if (-not $executable) { throw 'CLASSIC_OUTLOOK_MISSING' }
    # /profile selects only this launch. No default/profile preference is written.
    Start-OutlookProfile -Executable $executable -Profile $Profile -Email '' -WindowsSso $false
    return @{ message = ('Outlook wurde mit „' + $Profile + '“ geöffnet.') }
}

function Read-AccountString {
    param($Key, [string]$Name, [switch]$Ansi)
    $value = $Key.GetValue($Name)
    if ($value -is [byte[]]) {
        if ($Ansi) { return [Text.Encoding]::Default.GetString($value).Trim([char]0) }
        return [Text.Encoding]::Unicode.GetString($value).Trim([char]0)
    }
    return ([string]$value).Trim([char]0)
}

function Get-OutlookStartupSelection {
    $result = @{ root = ''; defaultProfile = ''; promptForProfile = $false }
    foreach ($version in @('16.0', '15.0')) {
        $root = "HKCU:\Software\Microsoft\Office\$version\Outlook"
        if (-not (Test-Path -LiteralPath "$root\Profiles")) { continue }
        $result.root = $root
        $value = Get-ItemPropertyValue -LiteralPath $root -Name DefaultProfile -ErrorAction SilentlyContinue
        if ($null -ne $value -and (Test-OutlookUsableProfile -Root $root -Name ([string]$value))) { $result.defaultProfile = [string]$value }
        break
    }
    $prompt = Get-ItemPropertyValue -LiteralPath 'HKCU:\Software\Microsoft\Exchange\Client\Options' -Name PickLogonProfile -ErrorAction SilentlyContinue
    $result.promptForProfile = [string]$prompt -eq '1'
    return $result
}

function Test-OutlookUsableProfile {
    param([string]$Root, [string]$Name)
    return ($Name -and (Test-Path -LiteralPath "$Root\Profiles\$Name") -and -not (Test-Path -LiteralPath "$Root\Deleted Profiles\$Name"))
}

function Open-OutlookProfilePromptPreferences {
    return [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey('Software\Microsoft\Exchange\Client\Options')
}

function Set-OutlookAutomaticStartup {
    param([string]$Profile)
    $selection = Get-OutlookStartupSelection
    if (-not $Profile -or $selection.defaultProfile -ine $Profile) { throw 'DEFAULT_PROFILE_NOT_VERIFIED' }
    # This is the user preference "Always use this profile", not profile data.
    $key = Open-OutlookProfilePromptPreferences
    try { $key.SetValue('PickLogonProfile', '0', [Microsoft.Win32.RegistryValueKind]::String) } finally { $key.Dispose() }
    $after = Get-OutlookStartupSelection
    if ($after.promptForProfile -or $after.defaultProfile -ine $Profile) { throw 'AUTOMATIC_START_NOT_SAVED' }
    return @{ ok = $true; defaultProfile = $after.defaultProfile; promptForProfile = $false }
}

function ConvertTo-OutlookServerName {
    param([string]$Server)
    $uri = $null
    if ($Server -match '^https?://' -and [Uri]::TryCreate($Server, [UriKind]::Absolute, [ref]$uri)) { return $uri.DnsSafeHost }
    return $Server
}

function Read-OutlookRegisteredProfile {
    param([string]$Root, [string]$Name)
    $result = @{ name = $Name; source = 'registered'; accounts = @(); stores = @(); note = 'Gespeicherte Konfiguration. Weitere freigegebene Postfächer und der tatsächliche Zugriff sind erst im geöffneten Profil prüfbar.' }
    $path = "$Root\Profiles\$Name"
    $accountPath = "$path\9375CFF0413111d3B88A00104B2A6676"
    if (Test-Path -LiteralPath $accountPath) {
        foreach ($entry in @(Get-ChildItem -LiteralPath $accountPath -ErrorAction Stop)) {
            $key = Get-Item -LiteralPath $entry.PSPath -ErrorAction Stop
            try {
                $email = Read-AccountString $key 'Email'
                if (-not $email) { $email = Read-AccountString $key 'Account Name' }
                if ($email -notmatch '^[^\s@]+@[^\s@]+$') { continue }
                $server = Read-AccountString $key 'IMAP Server'
                $type = 'IMAP'
                $user = Read-AccountString $key 'IMAP User'
                if (-not $server) { $server = Read-AccountString $key 'POP3 Server'; $type = 'POP3'; $user = Read-AccountString $key 'POP3 User' }
                if ($server) { $result.accounts += @{ email = $email; user = $user; name = (Read-AccountString $key 'Display Name'); accountType = $type; server = $server } }
            } finally { $key.Dispose() }
        }
    }
    foreach ($entry in @(Get-ChildItem -LiteralPath $path -ErrorAction Stop)) {
        $key = Get-Item -LiteralPath $entry.PSPath -ErrorAction Stop
        try {
            $email = (Read-AccountString $key '001f6641') -replace '^(=)?SMTP:', ''
            if ($email -match '^[^\s@]+@[^\s@]+$' -and -not @($result.accounts | Where-Object { $_.email -ieq $email -and $_.accountType -eq 'Exchange' }).Count) {
                $result.accounts += @{ email = $email; user = $email; name = (Read-AccountString $key '001f3001'); accountType = 'Exchange'; server = '' }
            }
            foreach ($property in @('001f6700', '001e6700', '001f6610', '001e6610')) {
                $file = Read-AccountString -Key $key -Name $property -Ansi:($property.StartsWith('001e'))
                if ($file -notmatch '(?i)\.(pst|ost)$' -or @($result.stores | Where-Object { $_.path -ieq $file }).Count) { continue }
                $result.stores += @{ name = [IO.Path]::GetFileName($file); kind = [IO.Path]::GetExtension($file).TrimStart('.').ToUpperInvariant(); path = $file; inbox = '' }
            }
        } finally { $key.Dispose() }
    }
    return $result
}

function Read-OutlookProfileCatalog {
    $selection = Get-OutlookStartupSelection
    $result = @{ defaultProfile = $selection.defaultProfile; activeProfile = ''; promptForProfile = $selection.promptForProfile; profiles = @() }
    if ($selection.root) {
        foreach ($entry in @(Get-ChildItem -LiteralPath ($selection.root + '\Profiles') -ErrorAction Stop)) {
            if (-not (Test-OutlookUsableProfile -Root $selection.root -Name $entry.PSChildName)) { continue }
            try { $result.profiles += Read-OutlookRegisteredProfile -Root $selection.root -Name $entry.PSChildName }
            catch { $result.profiles += @{ name = $entry.PSChildName; source = 'registered'; accounts = @(); stores = @(); note = 'Profilinformationen nicht vollständig lesbar.' } }
        }
    }
    $app = $null; $session = $null; $accounts = $null; $stores = $null
    try {
        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $session = $app.Session
        $result.activeProfile = [string]$session.CurrentProfileName
        $current = @($result.profiles | Where-Object { $_.name -ieq $result.activeProfile })
        if ($current.Count -ne 1) { return $result }
        $current = $current[0]
        $current.source = 'active'; $current.note = 'Im geöffneten Outlook bestätigt.'
        $current.accounts = @(); $current.stores = @()
        $accounts = $session.Accounts
        for ($i = 1; $i -le $accounts.Count; $i++) {
            $account = $null
            try {
                $account = $accounts.Item($i)
                $email = [string]$account.SmtpAddress
                $type = switch ([int]$account.AccountType) { 0 { 'Exchange' } 1 { 'IMAP' } 2 { 'POP3' } default { 'Other' } }
                $server = ''
                if ($type -eq 'Exchange') { try { $server = ConvertTo-OutlookServerName ([string]$account.ExchangeMailboxServerName) } catch {} }
                elseif ($email) {
                    $saved = @(Read-RegisteredMailAccounts -Profile $result.activeProfile -Email $email | Where-Object accountType -eq $type)
                    if ($saved.Count -eq 1) { $server = [string]$saved[0].server }
                }
                $current.accounts += @{ email = $email; user = [string]$account.UserName; name = [string]$account.DisplayName; accountType = $type; server = $server }
            } catch { $current.note = 'Einige Kontodetails konnten nicht gelesen werden.' }
            finally { if ($null -ne $account) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($account) } }
        }
        $stores = $session.Stores
        for ($i = 1; $i -le $stores.Count; $i++) {
            $store = $null; $inbox = $null
            try {
                $store = $stores.Item($i)
                $file = [string]$store.FilePath
                $kind = if ($file -match '(?i)\.(pst|ost)$') { [IO.Path]::GetExtension($file).TrimStart('.').ToUpperInvariant() } else { 'Postfach' }
                $inboxPath = ''
                try { $inbox = $store.GetDefaultFolder(6); if ($null -ne $inbox) { $inboxPath = [string]$inbox.FolderPath } } catch {}
                $current.stores += @{ name = [string]$store.DisplayName; kind = $kind; path = $file; inbox = $inboxPath }
            } catch { $current.note = 'Einige Postfächer oder Datendateien konnten nicht gelesen werden.' }
            finally {
                if ($null -ne $inbox) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($inbox) }
                if ($null -ne $store) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($store) }
            }
        }
    } catch { }
    finally {
        if ($null -ne $stores) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($stores) }
        if ($null -ne $accounts) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($accounts) }
        if ($null -ne $session) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($session) }
        if ($null -ne $app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
    }
    return $result
}

function Read-RegisteredMailAccounts {
    param([string]$Profile, [string]$Email)
    # Only read whitelisted configuration fields; never enumerate/read passwords.
    foreach ($version in @('16.0', '15.0')) {
        $path = "HKCU:\Software\Microsoft\Office\$version\Outlook\Profiles\$Profile\9375CFF0413111d3B88A00104B2A6676"
        if (-not (Test-Path -LiteralPath $path)) { continue }
        foreach ($account in @(Get-ChildItem -LiteralPath $path -ErrorAction Stop)) {
            $key = Get-Item -LiteralPath $account.PSPath -ErrorAction Stop
            try {
                if ((Read-AccountString $key 'Email') -ine $Email) { continue }
                $imap = Read-AccountString $key 'IMAP Server'
                $pop = Read-AccountString $key 'POP3 Server'
                if ($imap) { @{ accountType = 'IMAP'; server = $imap } }
                elseif ($pop) { @{ accountType = 'POP3'; server = $pop } }
            } finally { $key.Dispose() }
        }
        # The selected profile belongs to the first Office version where it exists.
        return
    }
}

function Read-OutlookAccountConfiguration {
    param([string]$Email, [bool]$Running)
    $selection = Get-OutlookStartupSelection
    $result = @{ email = $Email; profile = ''; source = 'unavailable'; accounts = @(); message = ''; defaultProfile = $selection.defaultProfile; activeProfile = ''; promptForProfile = $selection.promptForProfile }
    if ([string]::IsNullOrWhiteSpace((Find-ClassicOutlook))) {
        $result.message = 'Outlook Classic ist nicht installiert.'
        return $result
    }
    if (-not $Running) {
        $result.profile = $selection.defaultProfile
        if ($result.profile) {
            $result.source = 'default'
            $registered = Read-OutlookRegisteredProfile -Root $selection.root -Name $result.profile
            $result.accounts = @($registered.accounts | Where-Object { $_.email -ieq $Email } | ForEach-Object { @{ accountType = $_.accountType; server = $_.server } })
        }
        $result.message = if ($result.accounts.Count) { 'Outlook geschlossen · gespeichertes Standardprofil' } else { 'Outlook Classic öffnen, um Kontotyp und Server zu prüfen.' }
        return $result
    }
    $app = $null
    $session = $null
    $accounts = $null
    try {
        # Attach only. This status request never launches Outlook or logs on.
        $app = [Runtime.InteropServices.Marshal]::GetActiveObject('Outlook.Application')
        $session = $app.Session
        $result.profile = [string]$session.CurrentProfileName
        $result.activeProfile = $result.profile
        $result.source = 'active'
        $accounts = $session.Accounts
        for ($index = 1; $index -le $accounts.Count; $index++) {
            $account = $null
            try {
                $account = $accounts.Item($index)
                if ([string]$account.SmtpAddress -ine $Email) { continue }
                $type = switch ([int]$account.AccountType) { 0 { 'Exchange' } 1 { 'IMAP' } 2 { 'POP3' } default { 'Other' } }
                $server = ''
                if ($type -eq 'Exchange') {
                    try { $server = ConvertTo-OutlookServerName ([string]$account.ExchangeMailboxServerName) } catch { }
                } elseif ($type -eq 'IMAP' -or $type -eq 'POP3') {
                    $registered = @(Read-RegisteredMailAccounts -Profile $result.profile -Email $Email | Where-Object accountType -eq $type)
                    if ($registered.Count -eq 1) { $server = [string]$registered[0].server }
                }
                $result.accounts += @{ accountType = $type; server = $server }
            } finally { if ($null -ne $account) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($account) } }
        }
        if (-not $result.accounts.Count) { $result.message = 'Diese E-Mail-Adresse ist im geöffneten Outlook-Profil nicht eingerichtet.' }
    } catch {
        $result.source = 'unavailable'
        $result.accounts = @()
        $result.message = 'Outlook-Konfiguration momentan nicht lesbar. Offene Outlook-Dialoge schließen und erneut prüfen.'
        # Office may not publish its running COM object until it loses focus.
        # Keep the verified stored default visible, without claiming it is active.
        if ($selection.defaultProfile) {
            try {
                $registered = Read-OutlookRegisteredProfile -Root $selection.root -Name $selection.defaultProfile
                $result.profile = $selection.defaultProfile
                $result.source = 'default'
                $result.accounts = @($registered.accounts | Where-Object { $_.email -ieq $Email } | ForEach-Object { @{ accountType = $_.accountType; server = $_.server } })
                $result.message = 'Gespeicherte Konfiguration des Standardprofils.'
            } catch { }
        }
    } finally {
        if ($null -ne $accounts) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($accounts) }
        if ($null -ne $session) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($session) }
        if ($null -ne $app) { [void][Runtime.InteropServices.Marshal]::ReleaseComObject($app) }
    }
    return $result
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
    $requestText = if ($PSBoundParameters.ContainsKey('RequestJson')) { $RequestJson } else { [Console]::In.ReadToEnd() }
    $request = $requestText | ConvertFrom-Json
    $running = @(Get-Process -Name 'OUTLOOK' -ErrorAction SilentlyContinue).Count -gt 0
    switch ([string]$request.operation) {
        'transport-check' { $result = @{ ok = $true; echo = $request.echo } }
        'office-accounts' { $result = Read-OfficeAccounts }
        'close-for-migration' { $result = Close-OutlookForMigration -Authorized ([bool]$request.authorized) -ExpectedProfile ([string]$request.profile) }
        'hide-setup-process' {
            Hide-OutlookSetupExplorer -ExpectedId ([int]$request.processId) -StartedAt ([string]$request.startedAt) -Profile ([string]$request.profile) -Authorized ([bool]$request.authorized)
            $result = @{ ok = $true }
        }
        'watch-setup-process' {
            # Continuous, bounded visibility guard. Startup-only hiding and
            # four-second status polls leave late Explorer windows visible.
            # Match the exact setup-owned process before touching any window;
            # Hide-OutlookSetupExplorer additionally verifies the profile and
            # only hides Explorers, never authentication/MFA dialogs.
            $owner = Get-Process -Id ([int]$request.ownerProcessId) -ErrorAction Stop
            $until = [DateTime]::UtcNow.AddSeconds(240)
            try {
                while ([DateTime]::UtcNow -lt $until -and -not $owner.HasExited) {
                    $owned = Get-OwnedOutlookSetupProcess -ExpectedId ([int]$request.processId) -StartedAt ([string]$request.startedAt)
                    if ($null -eq $owned) { break }
                    $owned.Dispose()
                    Hide-OutlookSetupExplorer -ExpectedId ([int]$request.processId) -StartedAt ([string]$request.startedAt) -Profile ([string]$request.profile) -Authorized $true
                    Start-Sleep -Milliseconds 150
                    $owner.Refresh()
                }
            } finally { $owner.Dispose() }
            $result = @{ ok = $true }
        }
        'close-setup-process' {
            $result = Close-OutlookSetupProcess -ExpectedId ([int]$request.processId) -StartedAt ([string]$request.startedAt) -Profile ([string]$request.profile)
        }
        'automatic-startup' {
            if ($running) { throw 'OUTLOOK_MUST_BE_CLOSED' }
            $result = Set-OutlookAutomaticStartup -Profile ([string]$request.profile)
        }
        'profile-catalog' { $result = Read-OutlookProfileCatalog }
        'open-default-profile' {
            $selection = Get-OutlookStartupSelection
            $result = Open-ExistingOutlookProfile -Profile ([string]$selection.defaultProfile) -Running $running
        }
        'open-selected-profile' { $result = Open-ExistingOutlookProfile -Profile ([string]$request.profile) -Running $running }
        'account-configuration' {
            $result = Read-OutlookAccountConfiguration -Email ([string]$request.email) -Running $running
        }
        'inventory' {
            $result = @{ executable = (Find-ClassicOutlook); running = $running; windowsPrimarySmtp = (Get-WindowsPrimarySmtp); profileNames = @(Get-OutlookProfileNames) }
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
                if ([string]::IsNullOrWhiteSpace($profile) -or $profile.Length -gt 64 -or $profile -match '[\x00-\x1f"\\/]') { throw 'INVALID_PROFILE_NAME' }
                # Start hidden; authentication/MFA dialogs remain interactive.
                $identity = Start-OutlookProfile -Executable $executable -Profile $profile -Email ([string]$request.email) -WindowsSso ([bool]$request.windowsSso) -Background $true
                # Visibility is managed independently after ownership is saved.
                $result = @{ launched = $true; processId = $identity.processId; startedAt = $identity.startedAt }
            }
        }
        default { throw 'INVALID_OPERATION' }
    }
    [Console]::Write(($result | ConvertTo-Json -Depth 6 -Compress))
} catch {
    [Console]::Write((@{ error = 'Outlook Classic konnte nicht angesprochen werden. Bitte Outlook-Dialoge schließen und erneut versuchen.'; diagnostic = @{
        operation = [string]$request.operation; hresult = $_.Exception.HResult; exceptionType = $_.Exception.GetType().FullName; scriptLine = $_.InvocationInfo.ScriptLineNumber
    } } | ConvertTo-Json -Depth 3 -Compress))
    exit 1
}
