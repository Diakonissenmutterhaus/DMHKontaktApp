[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$ReleaseTag
)

$ErrorActionPreference = "Stop"
if ($env:GITHUB_ACTIONS -ne "true" -or [string]::IsNullOrWhiteSpace($env:GITHUB_REPOSITORY)) {
  throw "Esta verificação deve ser executada apenas no runner do GitHub Actions."
}
if ($Version -notmatch '^\d+\.\d+\.\d+$' -or $ReleaseTag -ne "v$Version") {
  throw "Versão ou tag de release inválida."
}

$projectRoot = Split-Path -Parent $PSScriptRoot
$config = Get-Content -LiteralPath (Join-Path $projectRoot "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json
$thumbprint = [string]$config.bundle.windows.certificateThumbprint
if ($thumbprint -notmatch '^[0-9A-Fa-f]{40}$' -or $config.bundle.createUpdaterArtifacts -ne $true) {
  throw "A configuração de assinatura Windows ou dos artefatos do updater está incompleta."
}

$publicCertificatePath = Join-Path $projectRoot "certificates\public\Diakonissenmutterhaus-Aidlingen-Internal-Code-Signing.cer"
$publicCertificate = Get-PfxCertificate -FilePath $publicCertificatePath
if ($publicCertificate.Thumbprint -ne $thumbprint) {
  throw "O certificado público do projeto não corresponde ao thumbprint configurado no Tauri."
}

Write-Host "[1/3] Certificado público confirmado."
$signingCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction Stop
if (-not $signingCertificate.HasPrivateKey) {
  throw "O certificado de assinatura não possui a chave privada no runner."
}

$bundleRoot = Join-Path $projectRoot "src-tauri\target\release\bundle"
$versionMarker = "_$([regex]::Escape($Version))_"
$nsis = @(Get-ChildItem -LiteralPath (Join-Path $bundleRoot "nsis") -File -Filter "*.exe" |
  Where-Object { $_.Name -match $versionMarker })
$msi = @(Get-ChildItem -LiteralPath (Join-Path $bundleRoot "msi") -File -Filter "*.msi" |
  Where-Object { $_.Name -match $versionMarker })
if ($nsis.Count -ne 1 -or $msi.Count -ne 1) {
  throw "Esperados exatamente um instalador EXE e um MSI. EXE: $($nsis.Count); MSI: $($msi.Count)."
}

foreach ($installer in @($nsis[0], $msi[0])) {
  $signature = Get-AuthenticodeSignature -LiteralPath $installer.FullName
  # O runner descartável não contém a raiz interna da DMH. Nesse ambiente,
  # Get-AuthenticodeSignature retorna UnknownError mesmo para um arquivo
  # assinado corretamente. Ainda exigimos a assinatura embutida, o certificado
  # público configurado e rejeitamos estados que indicam alteração do arquivo.
  $permittedStatuses = @("Valid", "NotTrusted", "UnknownError")
  $hasExpectedSigner = $null -ne $signature.SignerCertificate -and
    $signature.SignerCertificate.Thumbprint -eq $thumbprint
  if ($signature.Status -notin $permittedStatuses -or -not $hasExpectedSigner) {
    throw "Assinatura Authenticode inválida ou certificado incorreto: '$($installer.Name)' ($($signature.Status))."
  }
  if ($signature.Status -eq "UnknownError") {
    Write-Host "Assinatura interna confirmada no runner sem cadeia confiável: $($installer.Name)."
  }
  $updaterSignature = "$($installer.FullName).sig"
  if (-not (Test-Path -LiteralPath $updaterSignature -PathType Leaf) -or (Get-Item -LiteralPath $updaterSignature).Length -eq 0) {
    throw "A assinatura do updater não foi gerada para '$($installer.Name)'."
  }
}
Write-Host "[2/3] EXE, MSI e assinaturas do updater confirmados localmente."

$release = gh release view $ReleaseTag --repo $env:GITHUB_REPOSITORY --json tagName,isDraft,assets | ConvertFrom-Json
if ($LASTEXITCODE -ne 0 -or $release.tagName -ne $ReleaseTag -or -not $release.isDraft) {
  throw "A release $ReleaseTag não existe como rascunho verificável."
}
$releaseAssets = @{}
foreach ($file in @($nsis[0], $msi[0])) {
  foreach ($assetName in @($file.Name, "$($file.Name).sig")) {
    # GitHub substitui espaços por pontos no nome; o label conserva o nome local.
    $matchingAssets = @($release.assets | Where-Object { $_.label -eq $assetName -or $_.name -eq $assetName })
    if ($matchingAssets.Count -ne 1) {
      throw "O arquivo '$assetName' não foi enviado para a release em rascunho."
    }
    $releaseAssets[$assetName] = $matchingAssets[0]
  }
  $remoteAsset = $releaseAssets[$file.Name]
  if ($remoteAsset.size -ne $file.Length) {
    throw "O tamanho publicado de '$($file.Name)' não corresponde ao instalador verificado."
  }
}
if (-not @($release.assets | Where-Object { $_.name -eq "latest.json" }).Count) {
  throw "O manifesto latest.json do updater não foi publicado."
}
Write-Host "[3/3] Assets assinados e latest.json confirmados no rascunho do GitHub."

"EXE, MSI, assinaturas Authenticode e manifesto do updater verificados: $ReleaseTag" |
  Tee-Object -FilePath $env:GITHUB_STEP_SUMMARY -Append
