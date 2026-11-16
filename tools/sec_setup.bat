@echo off
chcp 65001 >nul
rem SEC 연락처(SEC_USER_AGENT)를 이 PC 사용자 환경변수에 한 번 등록합니다. 값은 이 PC 밖으로 저장·전송되지 않습니다.
echo 앱이름과 연락처 이메일을 한 줄로 입력하세요 (SEC 가 요구하는 형식)
set /p UA=^> 
setx SEC_USER_AGENT "%UA%" >nul
echo 등록했습니다. 새로 연 창에서 적용됩니다. 이어서 tools\sec_check.bat 또는 tools\sec_local.bat 를 실행하세요.
pause
