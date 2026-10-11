@echo off
chcp 65001 >nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0update-and-restart.ps1" %* & pause & exit /b
