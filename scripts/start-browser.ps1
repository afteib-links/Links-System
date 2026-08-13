# Links-System をブラウザで開く（Docker 優先、なければ UI プレビュー）
$ErrorActionPreference = 'Stop'
$Root = Split-Path -Parent $PSScriptRoot
Set-Location $Root

$Port = if ($env:APP_PORT) { [int]$env:APP_PORT } else { 8080 }
$Url = "http://localhost:$Port"

function Resolve-Docker {
  $cmd = Get-Command docker -ErrorAction SilentlyContinue
  if ($cmd) { return $cmd.Source }
  $candidates = @(
    "${env:ProgramFiles}\Docker\Docker\resources\bin\docker.exe",
    "${env:ProgramFiles}\Docker\Docker\resources\docker.exe"
  )
  foreach ($p in $candidates) {
    if (Test-Path $p) { return $p }
  }
  return $null
}

function Ensure-EnvFile {
  if (-not (Test-Path (Join-Path $Root '.env'))) {
    Copy-Item (Join-Path $Root '.env.example') (Join-Path $Root '.env')
    Write-Host '[start-browser] .env を .env.example から作成しました'
  }
}

function Start-DockerStack {
  param([string]$DockerExe)
  Ensure-EnvFile
  Write-Host '[start-browser] Docker Compose を起動しています…'
  & $DockerExe compose up --build -d
  if ($LASTEXITCODE -ne 0) {
    throw 'docker compose up に失敗しました'
  }
  $deadline = (Get-Date).AddMinutes(3)
  do {
    Start-Sleep -Seconds 2
    try {
      $r = Invoke-WebRequest -Uri "$Url/api/health" -UseBasicParsing -TimeoutSec 5
      if ($r.StatusCode -eq 200) {
        $body = $r.Content | ConvertFrom-Json
        if ($body.ok -and $body.db -eq 'up') {
          Write-Host '[start-browser] API + DB 準備完了'
          return $true
        }
      }
    } catch {
      # 起動待ち
    }
  } while ((Get-Date) -lt $deadline)
  Write-Warning '[start-browser] ヘルスチェックがタイムアウトしました。画面は開きますが API が未準備の可能性があります。'
  return $true
}

function Start-PreviewServer {
  $backend = Join-Path $Root 'backend'
  if (-not (Test-Path (Join-Path $backend 'node_modules'))) {
    Write-Host '[start-browser] backend の npm install を実行…'
    Push-Location $backend
    npm install
    Pop-Location
  }
  Write-Host '[start-browser] UI プレビューサーバー起動（DB なし）…'
  $env:APP_PORT = "$Port"
  Start-Process -FilePath 'npm' -ArgumentList @('run', 'preview') -WorkingDirectory $backend -WindowStyle Minimized
  Start-Sleep -Seconds 2
}

Ensure-EnvFile
$docker = Resolve-Docker
$fullStack = $false

if ($docker) {
  try {
    $fullStack = Start-DockerStack -DockerExe $docker
  } catch {
    Write-Warning "[start-browser] Docker 起動に失敗: $_"
    Write-Host '[start-browser] UI プレビューに切り替えます'
    Start-PreviewServer
  }
} else {
  Write-Host '[start-browser] docker コマンドが見つかりません。UI プレビューのみ起動します。'
  Write-Host '  ログインまで使う場合: Docker Desktop をインストールし README の手順を実行してください。'
  Start-PreviewServer
}

Start-Process $Url
Write-Host "[start-browser] ブラウザを開きました: $Url"
if (-not $fullStack) {
  Write-Host '  ※ プレビューモード: 画面レイアウトのみ。ログインは Docker 起動後に再度このスクリプトを実行してください。'
}
