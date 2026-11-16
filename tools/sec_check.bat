@echo off
chcp 65001 >nul
echo SEC 접근 점검 - 앱이름과 연락처 이메일을 한 줄로 입력하세요 (예: puddle-trader 내이메일@example.com)
set /p SEC_USER_AGENT=^> 
python "%~dp0sec_check.py"
pause
