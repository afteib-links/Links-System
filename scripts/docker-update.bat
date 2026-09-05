@echo off
setlocal EnableExtensions

rem Links-System ローカル Docker 更新
rem 用法:
rem   docker-update.bat           現在の作業ツリーで再ビルド・再起動
rem   docker-update.bat --pull    git pull 後に再ビルド・再起動

chcp 65001 >nul
title Links-System Docker 更新

set "ROOT=%~dp0.."
cd /d "%ROOT%" || (
  echo [docker-update] リポジトリルートへ移動できませんでした
  exit /b 1
)

set "DO_GIT_PULL=0"
if /i "%~1"=="--pull" set "DO_GIT_PULL=1"
if /i "%~1"=="/pull" set "DO_GIT_PULL=1"

set "DOCKER=docker"
where docker >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" (
    set "DOCKER=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
  ) else if exist "%ProgramFiles%\Docker\Docker\resources\docker.exe" (
    set "DOCKER=%ProgramFiles%\Docker\Docker\resources\docker.exe"
  ) else (
    echo [docker-update] docker コマンドが見つかりません。Docker Desktop を起動してください。
    exit /b 1
  )
)

if not exist ".env" (
  if exist ".env.example" (
    copy /y ".env.example" ".env" >nul
    echo [docker-update] .env を .env.example から作成しました
  ) else (
    echo [docker-update] 警告: .env も .env.example も見つかりません
  )
)

if "%DO_GIT_PULL%"=="1" (
  echo [docker-update] git pull を実行しています...
  git fetch origin
  if errorlevel 1 (
    echo [docker-update] git fetch に失敗しました
    exit /b 1
  )
  git pull
  if errorlevel 1 (
    echo [docker-update] git pull に失敗しました
    exit /b 1
  )
)

echo [docker-update] ベースイメージを取得しています...
"%DOCKER%" compose pull
if errorlevel 1 (
  echo [docker-update] 警告: docker compose pull に失敗しました（続行します）
)

echo [docker-update] コンテナを再ビルド・起動しています...
"%DOCKER%" compose up --build -d
if errorlevel 1 (
  echo [docker-update] docker compose up に失敗しました
  exit /b 1
)

echo.
echo --- docker compose ps ---
"%DOCKER%" compose ps

echo.
echo --- app logs (tail 50) ---
"%DOCKER%" compose logs app --tail 50

echo.
echo --- health check ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:8080/api/health' -UseBasicParsing -TimeoutSec 15; Write-Host $r.Content } catch { Write-Host ('[docker-update] ヘルスチェック失敗: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo [docker-update] 警告: ヘルスチェックに失敗しました。上記ログを確認してください。
  exit /b 1
)

echo.
echo [docker-update] 完了: http://localhost:8080
exit /b 0
