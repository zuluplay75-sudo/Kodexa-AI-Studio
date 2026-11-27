# Monta o MSIX do Kodexa Conector (Windows, com o Windows SDK instalado).
#   1. node scripts/build-connector-exe.mjs          (gera dist\connector\KodexaConector.exe)
#   2. pwsh packaging/msix/build.ps1 -IdentityName ... -Publisher "CN=..." -PublisherDisplayName "..." -Version 1.0.0.0
# Para a Microsoft Store, use os valores do Partner Center (Identidade do produto) e envie o .msix sem assinar:
# a Store assina. Para instalar num computador de teste, assine com um certificado cujo assunto seja o -Publisher.
param(
  [string]$IdentityName = 'Kodexa.Conector',
  [string]$Publisher = 'CN=Kodexa',
  [string]$PublisherDisplayName = 'Kodexa',
  [string]$Version = '1.0.0.0',
  [string]$Output = ''
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+\.0$') { throw 'Use uma versão no formato 1.2.3.0 (a Store exige o último número 0).' }
if ($IdentityName -notmatch '^[A-Za-z0-9.-]{3,50}$') { throw 'IdentityName inválido (copie do Partner Center).' }

$root = (Resolve-Path (Join-Path $PSScriptRoot '..\..')).Path
$exe = Join-Path $root 'dist\connector\KodexaConector.exe'
if (-not (Test-Path $exe)) { throw 'Gere antes o executável: node scripts/build-connector-exe.mjs' }
$layout = Join-Path $root 'dist\msix\layout'
if ($Output -eq '') { $Output = Join-Path $root 'dist\msix\KodexaConector.msix' }

Remove-Item -Recurse -Force $layout -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $layout 'Assets') | Out-Null
Copy-Item $exe $layout
Copy-Item (Join-Path $PSScriptRoot 'Assets\*.png') (Join-Path $layout 'Assets')

$xml = { param($v) [System.Security.SecurityElement]::Escape($v) }
$manifest = Get-Content (Join-Path $PSScriptRoot 'AppxManifest.xml') -Raw
$manifest = $manifest.Replace('__IDENTITY_NAME__', (& $xml $IdentityName)).Replace('__PUBLISHER_DISPLAY__', (& $xml $PublisherDisplayName)).Replace('__PUBLISHER__', (& $xml $Publisher)).Replace('__VERSION__', $Version)
[System.IO.File]::WriteAllText((Join-Path $layout 'AppxManifest.xml'), $manifest, (New-Object System.Text.UTF8Encoding $false))

$kits = 'C:\Program Files (x86)\Windows Kits\10\bin'
$makeappx = Get-ChildItem $kits -Recurse -Filter makeappx.exe | Where-Object { $_.FullName -match '\\x64\\' } | Sort-Object FullName -Descending | Select-Object -First 1
if (-not $makeappx) { throw 'makeappx.exe não encontrado: instale o Windows SDK.' }
New-Item -ItemType Directory -Force (Split-Path $Output) | Out-Null
& $makeappx.FullName pack /d $layout /p $Output /o
if ($LASTEXITCODE -ne 0) { throw "makeappx falhou ($LASTEXITCODE)" }
Write-Host "MSIX: $Output"
