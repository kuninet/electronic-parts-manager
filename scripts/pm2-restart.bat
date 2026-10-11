@echo off
chcp 65001 >nul & powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "pm2 restart '%~dp0..\ecosystem.config.js'" %* & pause & exit /b
