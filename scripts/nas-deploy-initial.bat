@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Links-System: QNAP 初回配置（git / Entware 不要）
rem
rem QNAP の App Center には Entware は標準では出ません。
rem この bat は Windows からソースを SCP し、NAS 上で docker compose を起動します。
rem
rem 用法:
rem   nas-deploy-initial.bat
rem
rem 事前準備（QNAP 側）:
rem   1. Container Station を App Center からインストール
rem   2. SSH を有効化
rem   3. 共有フォルダ（例: /share/Container）を用意
rem
rem 移行後 URL: http://(NAS-HonbanIP):8080

chcp 65001 >nul
title Links-System QNAP 初回配置

rem ===== ここを環境に合わせて編集 =====
set "NAS_HOST=(NAS-HonbanIP)"
set "NAS_SSH_USER=admin"
set "NAS_SSH_PORT=22"
set "NAS_PROJECT_PATH=/share/Container/Links-System"
rem ====================================

set "ROOT=%~dp0.."
cd /d "%ROOT%" || (
  echo [nas-deploy] リポジトリルートへ移動できませんでした
  exit /b 1
)

if /i "%NAS_HOST%"=="(NAS-HonbanIP)" (
  echo [nas-deploy] 先頭の NAS_HOST を実 IP に変更してください。
  exit /b 1
)

where ssh >nul 2>&1
if errorlevel 1 (
  echo [nas-deploy] ssh コマンドが見つかりません。Windows の OpenSSH Client を有効化してください。
  exit /b 1
)
where scp >nul 2>&1
if errorlevel 1 (
  echo [nas-deploy] scp コマンドが見つかりません。Windows の OpenSSH Client を有効化してください。
  exit /b 1
)

echo.
echo ===== Links-System QNAP 初回配置 =====
echo ローカル: %CD%
echo NAS SSH : %NAS_SSH_USER%@%NAS_HOST%:%NAS_SSH_PORT%
echo NAS パス: %NAS_PROJECT_PATH%
echo 配置後 URL: http://%NAS_HOST%:8080
echo.
echo 注意:
echo   - .env は NAS 側で本番用パスワードを設定してください（自動コピーしません）。
echo   - DB 移行は別途 nas-migrate-from-local.bat を使用（NAS に git が必要な場合あり）。
echo.

set /p CONFIRM=続行しますか？ [y/N]: 
if /i not "!CONFIRM!"=="y" (
  echo 中止しました。
  exit /b 0
)

echo [nas-deploy] NAS 接続確認...
ssh -p %NAS_SSH_PORT% -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "echo NAS接続OK"
if errorlevel 1 (
  echo [nas-deploy] NAS へ SSH 接続できません。ユーザー・IP・公開鍵を確認してください。
  exit /b 1
)

echo [nas-deploy] NAS 側ディレクトリを作成...
ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "mkdir -p %NAS_PROJECT_PATH%/data/mysql %NAS_PROJECT_PATH%/data/uploads %NAS_PROJECT_PATH%/data/pdf %NAS_PROJECT_PATH%/backups/import"
if errorlevel 1 exit /b 1

call :scp_file "docker-compose.yml"
if errorlevel 1 exit /b 1
call :scp_file "Dockerfile"
if errorlevel 1 exit /b 1
call :scp_file ".dockerignore"
if errorlevel 1 exit /b 1
call :scp_file ".env.example"
if errorlevel 1 exit /b 1

call :scp_dir "backend"
if errorlevel 1 exit /b 1
call :scp_dir "frontend"
if errorlevel 1 exit /b 1
call :scp_dir "db"
if errorlevel 1 exit /b 1
call :scp_dir "scripts"
if errorlevel 1 exit /b 1

echo [nas-deploy] NAS 上で .env 準備と Docker 起動...
ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "set -e; cd %NAS_PROJECT_PATH%; test -f .env || cp .env.example .env; DOCKER_BIN=''; for p in /share/CACHEDEV1_DATA/.qpkg/container-station/bin/docker /share/ZFS*/.qpkg/container-station/bin/docker /share/*/.qpkg/container-station/bin/docker; do if [ -x \"$p\" ]; then DOCKER_BIN=\"$p\"; break; fi; done; if [ -z \"$DOCKER_BIN\" ]; then DOCKER_BIN=\"$(command -v docker 2>/dev/null || true)\"; fi; if [ -z \"$DOCKER_BIN\" ]; then echo 'docker が見つかりません。Container Station をインストールしてください。'; exit 1; fi; echo \"docker: $DOCKER_BIN\"; \"$DOCKER_BIN\" compose up --build -d; \"$DOCKER_BIN\" compose ps; \"$DOCKER_BIN\" compose logs app --tail 30"
if errorlevel 1 (
  echo [nas-deploy] NAS 側 Docker 起動に失敗しました。
  echo   - Container Station がインストール済みか確認
  echo   - NAS 上で vi %NAS_PROJECT_PATH%/.env を編集してから再実行
  exit /b 1
)

echo.
echo --- health check ---
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -Uri 'http://%NAS_HOST%:8080/api/health' -UseBasicParsing -TimeoutSec 30; Write-Host $r.Content } catch { Write-Host ('ヘルスチェック失敗: ' + $_.Exception.Message); exit 1 }"
if errorlevel 1 (
  echo [nas-deploy] ヘルスチェック失敗。NAS 側ログを確認: docker compose logs app --tail 100
  exit /b 1
)

echo.
echo ===== 初回配置完了 =====
echo 画面: http://%NAS_HOST%:8080
echo ヘルス: http://%NAS_HOST%:8080/api/health
echo.
echo 次: NAS 上で %NAS_PROJECT_PATH%/.env の本番パスワードを設定し、
echo      必要なら docker compose up -d で再起動してください。
exit /b 0

:scp_file
set "SRC=%~1"
if not exist "%SRC%" (
  echo [nas-deploy] 警告: %SRC% が見つかりません。スキップします。
  exit /b 0
)
echo [nas-deploy] 転送: %SRC%
scp -P %NAS_SSH_PORT% -o StrictHostKeyChecking=yes "%SRC%" %NAS_SSH_USER%@%NAS_HOST%:%NAS_PROJECT_PATH%/
if errorlevel 1 (
  echo [nas-deploy] scp 失敗: %SRC%
  exit /b 1
)
exit /b 0

:scp_dir
set "SRC=%~1"
if not exist "%SRC%" (
  echo [nas-deploy] 警告: %SRC% が見つかりません。スキップします。
  exit /b 0
)
echo [nas-deploy] 転送: %SRC%\
scp -P %NAS_SSH_PORT% -r -o StrictHostKeyChecking=yes "%SRC%" %NAS_SSH_USER%@%NAS_HOST%:%NAS_PROJECT_PATH%/
if errorlevel 1 (
  echo [nas-deploy] scp 失敗: %SRC%
  exit /b 1
)
exit /b 0
