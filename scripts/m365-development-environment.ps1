# Only public application/tenant identifiers are cached. Never persist tokens.
function Import-M365DevelopmentEnvironment {
    param([Parameter(Mandatory = $true)][string]$ProjectRoot)

    $names = @('M365_CLIENT_ID', 'M365_TENANT_ID')
    $configPath = Join-Path $ProjectRoot '.local-m365.json'
    $localConfig = @{}
    if (Test-Path -LiteralPath $configPath -PathType Leaf) {
        try {
            $document = Get-Content -LiteralPath $configPath -Raw | ConvertFrom-Json -ErrorAction Stop
            foreach ($name in $names) {
                if ($document.PSObject.Properties[$name]) { $localConfig[$name] = [string]$document.$name }
            }
        } catch {
            throw "Die lokale Microsoft-365-Konfiguration ist kein gueltiges JSON: $configPath"
        }
    }

    $values = @{}
    $missing = @()
    foreach ($name in $names) {
        $value = [Environment]::GetEnvironmentVariable($name, 'Process')
        if ([string]::IsNullOrWhiteSpace($value)) { $value = $localConfig[$name] }
        if ([string]::IsNullOrWhiteSpace($value)) {
            $missing += $name
        } else {
            $values[$name] = $value.Trim()
        }
    }

    if ($missing.Count -gt 0) {
        # Prefer an existing gh session. Never initiate an interactive login.
        if (Get-Command gh -ErrorAction SilentlyContinue) {
            foreach ($name in @($missing)) {
                try {
                    $result = & gh variable get $name --repo Diakonissenmutterhaus/DMHKontaktApp 2>$null
                    if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace([string]$result)) {
                        $values[$name] = ([string]$result).Trim()
                    }
                } catch {
                    # Windows PowerShell treats native stderr as an error record.
                    # An unauthenticated gh must still allow the Git fallback.
                }
            }
            $missing = @($missing | Where-Object { -not $values.ContainsKey($_) })
        }

        if ($missing.Count -gt 0 -and (Get-Command git -ErrorAction SilentlyContinue)) {
            # Reuse Git's authenticated GitHub session for this read-only API call.
            # Disable credential dialogs so an unauthenticated machine fails clearly.
            $previousPrompt = $env:GIT_TERMINAL_PROMPT
            $previousInteractive = $env:GCM_INTERACTIVE
            $credentialLines = $null
            $password = $null
            $headers = $null
            try {
                $env:GIT_TERMINAL_PROMPT = '0'
                $env:GCM_INTERACTIVE = 'Never'
                $credentialLines = "protocol=https`nhost=github.com`n`n" | & git -c credential.interactive=never credential fill 2>$null
                if ($LASTEXITCODE -eq 0) {
                    foreach ($line in $credentialLines) {
                        if ($line.StartsWith('password=')) { $password = $line.Substring(9) }
                    }
                    if ($password) {
                        $headers = @{
                            Authorization = "Bearer $password"
                            Accept = 'application/vnd.github+json'
                            'X-GitHub-Api-Version' = '2022-11-28'
                        }
                        foreach ($name in $missing) {
                            $variable = Invoke-RestMethod -Uri "https://api.github.com/repos/Diakonissenmutterhaus/DMHKontaktApp/actions/variables/$name" -Headers $headers -TimeoutSec 20 -ErrorAction Stop
                            $values[$name] = [string]$variable.value
                        }
                    }
                }
            } catch {
                # Do not echo HTTP requests or credential-helper output.
                Write-Verbose 'GitHub-Variablen konnten mit der vorhandenen Git-Sitzung nicht gelesen werden.'
            } finally {
                $credentialLines = $null
                $password = $null
                $headers = $null
                [Environment]::SetEnvironmentVariable('GIT_TERMINAL_PROMPT', $previousPrompt, 'Process')
                [Environment]::SetEnvironmentVariable('GCM_INTERACTIVE', $previousInteractive, 'Process')
            }
        }
    }

    # Validate the complete pair before changing the environment or writing a file.
    foreach ($name in $names) {
        $value = [string]$values[$name]
        if ([string]::IsNullOrWhiteSpace($value)) {
            throw "$name fehlt. In .local-m365.json beide IDs aus den GitHub Actions Variables eintragen (siehe .local-m365.example.json), oder gh auth login ausfuehren und den Start wiederholen."
        }
        $id = [Guid]::Empty
        if ($value -notmatch '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' -or -not [Guid]::TryParse($value, [ref]$id) -or $id -eq [Guid]::Empty) {
            throw "$name muss eine gueltige, nicht leere GUID sein. Bitte Umgebungsvariable bzw. .local-m365.json korrigieren."
        }
        $values[$name] = $id.ToString()
    }

    # Allow a read-only checkout when both IDs are already supplied by the shell.
    try {
        $values | ConvertTo-Json | Set-Content -LiteralPath $configPath -Encoding UTF8 -ErrorAction Stop
    } catch {
        Write-Warning 'Die oeffentlichen Microsoft-365-IDs konnten nicht lokal zwischengespeichert werden.'
    }
    foreach ($name in $names) { [Environment]::SetEnvironmentVariable($name, $values[$name], 'Process') }
    Write-Host 'Microsoft-365-Client-ID und Mandanten-ID fuer den lokalen Build geladen.'
}
