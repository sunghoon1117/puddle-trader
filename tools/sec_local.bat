@echo off
chcp 65001 >nul
cd /d "%~dp0.."
python tools\sec_local.py
pause
