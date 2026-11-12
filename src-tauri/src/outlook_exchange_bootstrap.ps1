# Only the compiled-in script is executable. Request values remain JSON data.
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$envelope = [Console]::In.ReadToEnd() | ConvertFrom-Json
& ([ScriptBlock]::Create([string]$envelope.script)) -RequestJson ([string]$envelope.request)
