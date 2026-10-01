[CmdletBinding()]
param()

$ErrorActionPreference = "Stop"
$projectRoot = Split-Path -Parent $PSScriptRoot
$targetDirectory = Join-Path $env:TEMP "agendakontakte-cargo-target"
$tauriConfigPath = Join-Path $projectRoot "src-tauri\tauri.conf.json"
$expectedThumbprint = (Get-Content -LiteralPath $tauriConfigPath -Raw | ConvertFrom-Json).bundle.windows.certificateThumbprint

Push-Location $projectRoot
try {
  $env:CARGO_TARGET_DIR = $targetDirectory
  & npx.cmd tauri build
  $tauriExitCode = $LASTEXITCODE

  $bundleDirectory = Join-Path $targetDirectory "release\bundle"
  $installers = @(Get-ChildItem -LiteralPath $bundleDirectory -Recurse -File -Include "*.exe", "*.msi" -ErrorAction Stop)
  if ($installers.Count -eq 0) {
    throw "Nenhum instalador EXE ou MSI foi gerado em '$bundleDirectory'."
  }

  foreach ($installer in $installers) {
    $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
    if ($null -eq $signature.SignerCertificate -or $signature.SignerCertificate.Thumbprint -ne $expectedThumbprint) {
      throw "O instalador '$($installer.FullName)' não foi assinado com o certificado interno configurado."
    }
    if ($signature.Status -notin @("Valid", "NotTrusted")) {
      throw "A assinatura do instalador '$($installer.FullName)' não passou na verificação Authenticode: $($signature.Status)."
    }
  }

  $installers | Select-Object FullName, Length, LastWriteTime | Format-Table -AutoSize

  if ($tauriExitCode -ne 0) {
    throw "O Tauri gerou instaladores Authenticode, mas terminou com exit code $tauriExitCode. Verifique a assinatura do updater (TAURI_SIGNING_PRIVATE_KEY)."
  }
} finally {
  Pop-Location
}
