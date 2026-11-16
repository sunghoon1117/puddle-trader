@echo off
chcp 65001 >nul
cd /d "%~dp0..\worker"
call npx wrangler deploy
pause
