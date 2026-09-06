@echo off
setlocal
cd /d "%~dp0"
title Links-System Docker Update

where powershell.exe >nul 2>nul
if errorlevel 1 (
    echo [FAILED] Windows PowerShell was not found.
    if not "%LINKS_DOCKER_UPDATE_NO_PAUSE%"=="1" pause
    exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\docker-update-interactive.ps1" %*
exit /b %ERRORLEVEL%
