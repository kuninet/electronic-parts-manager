@echo off
chcp 65001 >nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0pm2-unregister.ps1" %* & pause & exit /b
