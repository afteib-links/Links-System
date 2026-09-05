@echo off
setlocal EnableExtensions EnableDelayedExpansion

rem Links-System: ローカル Docker から QNAP NAS へ移行する補助スクリプト
rem
rem 移行できるもの:
rem   - DB 業務データ … mysqldump + マニフェスト（scripts/nas-db-export.sh）
rem   - 添付・PDF … data\uploads, data\pdf（--with-files 指定時）
rem   - アプリ … NAS 上で同一 Git コミットを checkout し docker compose up --build
rem
rem そのままコピーできないもの:
rem   - 実行中コンテナ / Docker イメージ本体
rem   - data\mysql の生ファイル（OS差異のため。SQL ダンプを使う）
rem   - .env の本番秘密情報（NAS 側で別途設定）
rem
rem 用法:
rem   nas-migrate-from-local.bat                 エクスポート + NAS へ転送
rem   nas-migrate-from-local.bat --with-files    上記 + uploads/pdf も転送
rem   nas-migrate-from-local.bat --restore       上記 + NAS 上で DB 完全置換まで実行
rem   nas-migrate-from-local.bat --export-only   ローカル export のみ
rem
rem 参照: docs\development\NAS_DB_REPLACEMENT.md
rem       docs\NAS_Docker導入・運用手順.md

chcp 65001 >nul
title Links-System ローカル → QNAP NAS 移行

rem ===== ここを環境に合わせて編集 =====
set "NAS_HOST=(NAS-HonbanIP)"
set "NAS_SSH_USER=admin"
set "NAS_SSH_PORT=22"
set "NAS_PROJECT_PATH=/share/Container/Links-System"
rem ====================================

set "ROOT=%~dp0.."
cd /d "%ROOT%" || (
  echo [nas-migrate] リポジトリルートへ移動できませんでした
  exit /b 1
)

set "WITH_FILES=0"
set "DO_RESTORE=0"
set "EXPORT_ONLY=0"
:parse_args
if "%~1"=="" goto args_done
if /i "%~1"=="--with-files" set "WITH_FILES=1"
if /i "%~1"=="--restore" set "DO_RESTORE=1"
if /i "%~1"=="--export-only" set "EXPORT_ONLY=1"
shift
goto parse_args
:args_done

if /i "%NAS_HOST%"=="(NAS-HonbanIP)" (
  echo [nas-migrate] 先頭の設定で NAS_HOST を実 IP に変更してください。
  exit /b 1
)

call :find_docker
if errorlevel 1 exit /b 1

call :find_bash
if errorlevel 1 exit /b 1

call :find_ssh_tools
if errorlevel 1 exit /b 1

echo.
echo ===== Links-System ローカル → QNAP 移行 =====
echo ローカル: %CD%
echo NAS SSH : %NAS_SSH_USER%@%NAS_HOST%:%NAS_SSH_PORT%
echo NAS パス: %NAS_PROJECT_PATH%
echo 移行後 URL: http://%NAS_HOST%:8080
echo ヘルス確認: http://%NAS_HOST%:8080/api/health
echo.

for /f "delims=" %%c in ('git rev-parse HEAD 2^>nul') do set "LOCAL_GIT_COMMIT=%%c"
if not defined LOCAL_GIT_COMMIT (
  echo [nas-migrate] git rev-parse に失敗しました。Git リポジトリ内で実行してください。
  exit /b 1
)
echo ローカル Git コミット: !LOCAL_GIT_COMMIT!
echo.
echo 注意:
echo   - エクスポート中はアプリ入力・締め・帳票発行を止めてください。
echo   - NAS 側 .env は本番用の値を別途設定してください（ローカル .env の丸コピー非推奨）。
echo   - --restore は NAS 上の既存 DB を完全置換します。
echo.

set /p CONFIRM=続行しますか？ [y/N]: 
if /i not "!CONFIRM!"=="y" (
  echo 中止しました。
  exit /b 0
)

set "APP_STOPPED=0"
call :stop_app
if errorlevel 1 goto cleanup_and_exit

echo [nas-migrate] DB エクスポートを実行しています...
"%BASH_EXE%" "%ROOT%\scripts\nas-db-export.sh" backups
if errorlevel 1 (
  echo [nas-migrate] nas-db-export.sh に失敗しました。
  goto cleanup_and_exit
)

set "DUMP_FILE="
set "MANIFEST_FILE="
for /f "delims=" %%f in ('dir /b /o-d "%ROOT%\backups\links_*.sql" 2^>nul') do (
  set "DUMP_FILE=%ROOT%\backups\%%f"
  set "MANIFEST_FILE=%ROOT%\backups\%%~nf.manifest"
  goto dump_found
)
echo [nas-migrate] エクスポート SQL が見つかりません。
goto cleanup_and_exit
:dump_found

if not exist "!MANIFEST_FILE!" (
  echo [nas-migrate] マニフェストが見つかりません: !MANIFEST_FILE!
  goto cleanup_and_exit
)

for /f "usebackq delims=" %%h in (`powershell -NoProfile -Command "(Get-FileHash -Algorithm SHA256 -LiteralPath '!DUMP_FILE!').Hash.ToLower()"`) do set "LOCAL_SHA256=%%h"
echo [nas-migrate] ダンプ: !DUMP_FILE!
echo [nas-migrate] SHA-256: !LOCAL_SHA256!

call :start_app

if "%EXPORT_ONLY%"=="1" (
  echo.
  echo [nas-migrate] エクスポートのみ完了。
  echo 次の手順は docs\development\NAS_DB_REPLACEMENT.md を参照してください。
  exit /b 0
)

echo.
echo [nas-migrate] NAS へ SSH 接続確認...
ssh -p %NAS_SSH_PORT% -o BatchMode=yes -o ConnectTimeout=10 -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "echo NAS接続OK"
if errorlevel 1 (
  echo [nas-migrate] NAS へ SSH 接続できません。ユーザー・IP・ポート・公開鍵を確認してください。
  exit /b 1
)

echo [nas-migrate] NAS 側 import ディレクトリを作成...
ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "mkdir -p %NAS_PROJECT_PATH%/backups/import && chmod 700 %NAS_PROJECT_PATH%/backups/import"
if errorlevel 1 (
  echo [nas-migrate] NAS 側ディレクトリ作成に失敗しました。初回は docs\NAS_Docker導入・運用手順.md の 4.3 を先に実施してください。
  exit /b 1
)

for %%f in ("!DUMP_FILE!" "!MANIFEST_FILE!") do (
  echo [nas-migrate] 転送: %%~nxf
  scp -P %NAS_SSH_PORT% -o StrictHostKeyChecking=yes "%%~f" %NAS_SSH_USER%@%NAS_HOST%:%NAS_PROJECT_PATH%/backups/import/
  if errorlevel 1 (
    echo [nas-migrate] scp に失敗しました: %%~nxf
    exit /b 1
  )
)

for /f "delims=" %%n in ("!DUMP_FILE!") do set "DUMP_BASENAME=%%~nxn"
for /f "delims=" %%n in ("!MANIFEST_FILE!") do set "MANIFEST_BASENAME=%%~nxn"

echo [nas-migrate] NAS 側 SHA-256 を確認...
ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "sha256sum %NAS_PROJECT_PATH%/backups/import/!DUMP_BASENAME!"
if errorlevel 1 exit /b 1

if "%WITH_FILES%"=="1" (
  echo [nas-migrate] data\uploads と data\pdf を転送しています...
  if exist "data\uploads" (
    scp -P %NAS_SSH_PORT% -r -o StrictHostKeyChecking=yes "data\uploads" %NAS_SSH_USER%@%NAS_HOST%:%NAS_PROJECT_PATH%/data/
    if errorlevel 1 (
      echo [nas-migrate] uploads 転送に失敗しました。
      exit /b 1
    )
  ) else (
    echo [nas-migrate] data\uploads は存在しないためスキップ
  )
  if exist "data\pdf" (
    scp -P %NAS_SSH_PORT% -r -o StrictHostKeyChecking=yes "data\pdf" %NAS_SSH_USER%@%NAS_HOST%:%NAS_PROJECT_PATH%/data/
    if errorlevel 1 (
      echo [nas-migrate] pdf 転送に失敗しました。
      exit /b 1
    )
  ) else (
    echo [nas-migrate] data\pdf は存在しないためスキップ
  )
)

if "%DO_RESTORE%"=="0" (
  echo.
  echo ===== 転送完了 =====
  echo NAS 上で次を実行してください:
  echo   cd %NAS_PROJECT_PATH%
  echo   git fetch origin ^&^& git checkout !LOCAL_GIT_COMMIT!
  echo   git rev-parse HEAD   # !LOCAL_GIT_COMMIT! と一致すること
  echo   cp .env.example .env   # 初回のみ。本番値を設定
  echo   docker compose up --build -d
  echo   bash scripts/nas-db-replace.sh backups/import/!DUMP_BASENAME! backups/import/!MANIFEST_BASENAME! --confirm-replace
  echo.
  echo 確認 URL: http://%NAS_HOST%:8080
  echo 再実行で NAS 側まで自動化: nas-migrate-from-local.bat --restore
  exit /b 0
)

echo.
echo [nas-migrate] NAS 上で Docker 起動と DB 完全置換を実行します...
set /p RESTORE_CONFIRM=NAS の既存 DB を上書きします。よろしいですか？ [y/N]: 
if /i not "!RESTORE_CONFIRM!"=="y" (
  echo 転送のみ完了。NAS 側 restore は手動で実行してください。
  exit /b 0
)

ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "cd %NAS_PROJECT_PATH% && git fetch origin && git checkout !LOCAL_GIT_COMMIT! && git rev-parse HEAD"
if errorlevel 1 (
  echo [nas-migrate] NAS 側 Git 更新に失敗しました。
  exit /b 1
)

ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "cd %NAS_PROJECT_PATH% && test -f .env || cp .env.example .env"
if errorlevel 1 (
  echo [nas-migrate] NAS 側 .env 準備に失敗しました。
  exit /b 1
)

ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "cd %NAS_PROJECT_PATH% && docker compose up --build -d"
if errorlevel 1 (
  echo [nas-migrate] NAS 側 docker compose up に失敗しました。
  exit /b 1
)

ssh -p %NAS_SSH_PORT% -o StrictHostKeyChecking=yes %NAS_SSH_USER%@%NAS_HOST% "cd %NAS_PROJECT_PATH% && bash scripts/nas-db-replace.sh backups/import/!DUMP_BASENAME! backups/import/!MANIFEST_BASENAME! --confirm-replace"
if errorlevel 1 (
  echo [nas-migrate] NAS 側 DB 完全置換に失敗しました。NAS の backups/ を確認してください。
  exit /b 1
)

echo.
echo ===== 移行完了 =====
echo 画面: http://%NAS_HOST%:8080
echo ヘルス: http://%NAS_HOST%:8080/api/health
echo 全利用者は再ログインが必要です。
exit /b 0

:cleanup_and_exit
if "%APP_STOPPED%"=="1" call :start_app
exit /b 1

:find_docker
set "DOCKER=docker"
where docker >nul 2>&1
if errorlevel 1 (
  if exist "%ProgramFiles%\Docker\Docker\resources\bin\docker.exe" (
    set "DOCKER=%ProgramFiles%\Docker\Docker\resources\bin\docker.exe"
  ) else if exist "%ProgramFiles%\Docker\Docker\resources\docker.exe" (
    set "DOCKER=%ProgramFiles%\Docker\Docker\resources\docker.exe"
  ) else (
    echo [nas-migrate] docker コマンドが見つかりません。Docker Desktop を起動してください。
    exit /b 1
  )
)
exit /b 0

:find_bash
set "BASH_EXE="
if exist "%ProgramFiles%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles%\Git\bin\bash.exe"
if not defined BASH_EXE if exist "%ProgramFiles(x86)%\Git\bin\bash.exe" set "BASH_EXE=%ProgramFiles(x86)%\Git\bin\bash.exe"
where bash >nul 2>&1
if not defined BASH_EXE (
  for /f "delims=" %%b in ('where bash 2^>nul') do set "BASH_EXE=%%b"
)
if not defined BASH_EXE (
  echo [nas-migrate] Git Bash が見つかりません。nas-db-export.sh 実行のため Git for Windows をインストールしてください。
  exit /b 1
)
exit /b 0

:find_ssh_tools
where ssh >nul 2>&1
if errorlevel 1 (
  echo [nas-migrate] ssh コマンドが見つかりません。Windows の OpenSSH Client を有効化してください。
  exit /b 1
)
where scp >nul 2>&1
if errorlevel 1 (
  echo [nas-migrate] scp コマンドが見つかりません。Windows の OpenSSH Client を有効化してください。
  exit /b 1
)
exit /b 0

:stop_app
echo [nas-migrate] ローカル app コンテナを一時停止...
"%DOCKER%" compose ps
"%DOCKER%" compose stop app
if errorlevel 1 (
  echo [nas-migrate] docker compose stop app に失敗しました。
  exit /b 1
)
set "APP_STOPPED=1"
exit /b 0

:start_app
if "%APP_STOPPED%"=="0" exit /b 0
echo [nas-migrate] ローカル app コンテナを再開...
"%DOCKER%" compose start app
set "APP_STOPPED=0"
exit /b 0
