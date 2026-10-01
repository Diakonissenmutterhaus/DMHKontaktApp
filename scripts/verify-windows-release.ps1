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
$signingCertificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction Stop
if (-not $signingCertificate.HasPrivateKey) {
  throw "O certificado de assinatura não possui a chave privada no runner."
}

# Confiar apenas no usuário do runner descartável; não altera LocalMachine nem computadores dos usuários.
foreach ($store in @("Root", "TrustedPublisher")) {
  if (-not (Test-Path -LiteralPath "Cert:\CurrentUser\$store\$thumbprint")) {
    Import-Certificate -FilePath $publicCertificatePath -CertStoreLocation "Cert:\CurrentUser\$store" | Out-Null
  }
}

$kitsBin = Join-Path ${env:ProgramFiles(x86)} "Windows Kits\10\bin"
$signTool = Get-ChildItem -LiteralPath $kitsBin -Directory |
  Sort-Object Name -Descending |
  ForEach-Object { Join-Path $_.FullName "x64\signtool.exe" } |
  Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } |
  Select-Object -First 1
if (-not $signTool) {
  throw "signtool.exe x64 não foi encontrado no Windows SDK do runner."
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
  if ($signature.Status -ne "Valid" -or $signature.SignerCertificate.Thumbprint -ne $thumbprint) {
    throw "Assinatura Authenticode inválida ou certificado incorreto: '$($installer.Name)' ($($signature.Status))."
  }
  & $signTool verify /pa /sha1 $thumbprint /v $installer.FullName
  if ($LASTEXITCODE -ne 0) {
    throw "signtool verify falhou para '$($installer.Name)' (exit code $LASTEXITCODE)."
  }
  $updaterSignature = "$($installer.FullName).sig"
  if (-not (Test-Path -LiteralPath $updaterSignature -PathType Leaf) -or (Get-Item -LiteralPath $updaterSignature).Length -eq 0) {
    throw "A assinatura do updater não foi gerada para '$($installer.Name)'."
  }
}

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

$downloadDirectory = Join-Path $env:RUNNER_TEMP ("dmh-release-verify-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $downloadDirectory | Out-Null
gh release download $ReleaseTag --repo $env:GITHUB_REPOSITORY --pattern "latest.json" --dir $downloadDirectory
if ($LASTEXITCODE -ne 0) {
  throw "Não foi possível baixar latest.json da release em rascunho."
}
$latest = Get-Content -LiteralPath (Join-Path $downloadDirectory "latest.json") -Raw | ConvertFrom-Json
if ($latest.version -ne $Version) {
  throw "latest.json não corresponde à versão $Version."
}
foreach ($entry in @(
  @{ Platform = 'windows-x86_64'; File = $nsis[0] },
  @{ Platform = 'windows-x86_64-nsis'; File = $nsis[0] },
  @{ Platform = 'windows-x86_64-msi'; File = $msi[0] }
)) {
  $update = $latest.platforms.PSObject.Properties[$entry.Platform].Value
  $file = $entry.File
  $expectedSignature = (Get-Content -LiteralPath "$($file.FullName).sig" -Raw).Trim()
  $remoteAsset = $releaseAssets[$file.Name]
  if (-not $update -or $update.signature.Trim() -ne $expectedSignature -or
      $update.url -notin @($remoteAsset.apiUrl, $remoteAsset.url)) {
    throw "latest.json não aponta para o instalador e a assinatura corretos em '$($entry.Platform)'."
  }
}

"EXE, MSI, assinaturas Authenticode e manifesto do updater verificados: $ReleaseTag" |
  Tee-Object -FilePath $env:GITHUB_STEP_SUMMARY -Append
