@echo off
rem 새 영상 자막을 이어받고(유튜브 제한 시 자동 대기·재개) 앱의 영상 지식(data\knowledge.json)을 다시 만듭니다.
chcp 65001 >nul
cd /d "%~dp0\.."
set SUBS=%USERPROFILE%\puddle-data
python tools\collect_subs.py "%SUBS%" 4
python tools\build_knowledge.py "%SUBS%"
echo 완료. data\knowledge.json 이 갱신되었습니다. (GitHub 에 올렸다면 이 파일만 다시 업로드)
pause
