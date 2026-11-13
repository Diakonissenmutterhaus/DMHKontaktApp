# Read-only allowlisted metadata. Never enumerate credential/token file contents.
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
function Read-IdentityMetadata {
    $sources = @()
    foreach ($view in @('Registry64', 'Registry32')) {
        $base = [Microsoft.Win32.RegistryKey]::OpenBaseKey([Microsoft.Win32.RegistryHive]::CurrentUser, [Microsoft.Win32.RegistryView]::$view)
        try {
            foreach ($path in @('Software\Microsoft\Office\16.0\Common\Identity', 'Software\Microsoft\Office\15.0\Common\Identity', 'Software\Microsoft\Windows NT\CurrentVersion\WorkplaceJoin\JoinInfo')) {
                $source = @{ path = ('HKCU\' + $path); view = $view; state = 'missing'; accounts = @() }
                $key = $null; $entries = $null
                try {
                    $key = $base.OpenSubKey($path)
                    if ($null -eq $key) { continue }
                    $source.state = 'read'
                    $mail = [string]$key.GetValue('ADUserName')
                    if ($mail -match '^[^\s@]+@[^\s@]+$' -and $mail.Length -le 254) { $source.accounts += @{ field = 'ADUserName'; email = $mail; path = $source.path } }
                    $entries = if ($path.EndsWith('Identity')) { $key.OpenSubKey('Identities') } else { $key }
                    if ($null -eq $entries) { continue }
                    $names = @($entries.GetSubKeyNames())
                    $source.entryCount = $names.Count
                    foreach ($name in ($names | Select-Object -First 64)) {
                        $entry = $entries.OpenSubKey($name)
                        try {
                            if ($null -eq $entry) { continue }
                            foreach ($field in @('EmailAddress', 'PreferredUsername', 'SigninName', 'UserEmail')) {
                                $mail = [string]$entry.GetValue($field)
                                if ($mail -match '^[^\s@]+@[^\s@]+$' -and $mail.Length -le 254) {
                                    $source.accounts += @{ field = $field; email = $mail; path = ('HKEY_CURRENT_USER\' + $entry.Name.Substring('HKEY_CURRENT_USER\'.Length)) }
                                }
                            }
                        } finally { if ($entry) { $entry.Dispose() } }
                    }
                } catch { $source.state = 'unreadable'; $source.hresult = $_.Exception.HResult }
                finally {
                    if ($entries -and $entries -ne $key) { $entries.Dispose() }
                    if ($key) { $key.Dispose() }
                    $sources += $source
                }
            }
        } finally { $base.Dispose() }
    }
    return @($sources)
}
function Read-SsoFlags {
    $result = @{ state = 'unavailable'; flags = @{} }
    $reader = New-Object Diagnostics.Process
    try {
        $reader.StartInfo.FileName = Join-Path $env:WINDIR 'System32\dsregcmd.exe'
        $reader.StartInfo.Arguments = '/status'
        $reader.StartInfo.UseShellExecute = $false
        $reader.StartInfo.CreateNoWindow = $true
        $reader.StartInfo.RedirectStandardOutput = $true
        $reader.StartInfo.RedirectStandardError = $true
        if (-not $reader.Start()) { return $result }
        $stdout = $reader.StandardOutput.ReadToEndAsync()
        $stderr = $reader.StandardError.ReadToEndAsync()
        if (-not $reader.WaitForExit(7000)) { $reader.Kill(); $result.state = 'timeout'; return $result }
        if ($reader.ExitCode -ne 0) { return $result }
        $result.state = 'read'
        foreach ($line in ($stdout.GetAwaiter().GetResult() -split "`r?`n")) {
            if ($line -match '^\s*(AzureAdJoined|EnterpriseJoined|DomainJoined|WorkplaceJoined|WamDefaultSet|AzureAdPrt|EnterprisePrt|DeviceAuthStatus)\s*:\s*(YES|NO|SUCCESS|FAILED|ERROR)\b') { $result.flags[$matches[1]] = $matches[2] }
        }
    } catch { $result.hresult = $_.Exception.HResult }
    finally { $reader.Dispose() }
    return $result
}
function Read-Processes {
    $rows = @()
    # No command lines or window titles (they may contain message subjects).
    foreach ($process in @(Get-Process -Name OUTLOOK, EXCEL, WINWORD -ErrorAction SilentlyContinue | Select-Object -First 40)) {
        $row = @{ name = $process.ProcessName; processId = $process.Id; state = 'partial'; owner = 'unreadable' }
        try {
            $row.sessionId = $process.SessionId
            $row.sameSession = $process.SessionId -eq [Diagnostics.Process]::GetCurrentProcess().SessionId
            $row.path = $process.Path
            $row.hasMainWindow = $process.MainWindowHandle -ne [IntPtr]::Zero
            $row.startedAt = $process.StartTime.ToUniversalTime().ToString('o')
            $row.state = 'read'
        } catch { $row.hresult = $_.Exception.HResult }
        finally { $process.Dispose() }
        $rows += $row
    }
    # Owner resolution is separate: one inaccessible process must not erase the list.
    try {
        $items = @(Get-CimInstance Win32_Process -Filter "Name='OUTLOOK.EXE'" -OperationTimeoutSec 2)
        foreach ($item in ($items | Select-Object -First 4)) {
            try {
                $owner = Invoke-CimMethod -InputObject $item -MethodName GetOwner -OperationTimeoutSec 1
                if ($owner.ReturnValue -eq 0) { foreach ($row in $rows) { if ($row.processId -eq $item.ProcessId) { $row.owner = ($owner.Domain + '\' + $owner.User) } } }
            } catch { }
        }
    } catch { }
    return @($rows)
}
function Read-OfficeVersion {
    $path = 'HKLM:\SOFTWARE\Microsoft\Office\ClickToRun\Configuration'
    try {
        $key = Get-Item -LiteralPath $path -ErrorAction Stop
        try { return @{ path = $path; version = [string]$key.GetValue('VersionToReport'); platform = [string]$key.GetValue('Platform') } }
        finally { $key.Dispose() }
    } catch { return @{ path = $path; state = 'unavailable'; hresult = $_.Exception.HResult } }
}
function Read-ProfileNames {
    $path = 'HKCU:\Software\Microsoft\Office\16.0\Outlook'
    $key = $null; $profiles = $null
    try {
        $key = Get-Item -LiteralPath $path -ErrorAction Stop
        $profiles = $key.OpenSubKey('Profiles')
        return @{ path = $path; defaultProfile = [string]$key.GetValue('DefaultProfile'); profiles = @(if ($profiles) { $profiles.GetSubKeyNames() | Select-Object -First 64 }) }
    } catch { return @{ path = $path; state = 'unavailable'; hresult = $_.Exception.HResult } }
    finally { if ($profiles) { $profiles.Dispose() }; if ($key) { $key.Dispose() } }
}
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
$report = [ordered]@{
    computer = $env:COMPUTERNAME
    windowsUser = $identity.Name
    userSid = $identity.User.Value
    localWindowsUser = ($identity.Name.Split('\')[0] -ieq $env:COMPUTERNAME)
    elevated = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
    sessionId = [Diagnostics.Process]::GetCurrentProcess().SessionId
    windowsVersion = [Environment]::OSVersion.VersionString
    powershellVersion = $PSVersionTable.PSVersion.ToString()
    identitySources = @(Read-IdentityMetadata)
    officeInstallation = Read-OfficeVersion
    outlookProfiles = Read-ProfileNames
    processes = @(Read-Processes)
    windowsSso = Read-SsoFlags
    accountMetadataDirectories = @('Microsoft\OneAuth', 'Microsoft\IdentityCache', 'Packages\Microsoft.AAD.BrokerPlugin_cw5n1h2txyewy') | ForEach-Object {
        $location = Join-Path $env:LOCALAPPDATA $_
        @{ path = $location; exists = [IO.Directory]::Exists($location); contentsRead = $false }
    }
}
[Console]::Write(($report | ConvertTo-Json -Depth 9 -Compress))
