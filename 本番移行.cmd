@echo off
setlocal
chcp 65001 >nul
title Links-System 本番移行
cd /d "%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\production-deploy.ps1" %*
set "RESULT=%ERRORLEVEL%"
echo.
if "%RESULT%"=="0" (
  echo [正常終了] 本番移行処理が完了しました。
) else (
  echo [失敗] 本番移行処理を完了できませんでした。終了コード: %RESULT%
)
if not "%LINKS_PRODUCTION_DEPLOY_NO_PAUSE%"=="1" pause
exit /b %RESULT%
