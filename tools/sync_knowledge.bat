@echo off
rem 새 영상 자막을 이어받아 분석하고 GitHub 에 반영합니다(PC 가 켜져 있을 때 예약 작업으로 실행).
chcp 65001 >nul
set PATH=%PATH%;C:\Program Files\Git\cmd;C:\Program Files\GitHub CLI
cd /d "%~dp0\.."
set SUBS=%USERPROFILE%\puddle-data
python tools\collect_subs.py "%SUBS%" 3
python tools\build_knowledge.py "%SUBS%"
git add data/knowledge.json
git diff --cached --quiet && goto :eof
git -c user.name=puddle-trader -c user.email=noreply@users.noreply.github.com commit -q -m "영상 지식 자동 갱신" -m "Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
git pull -q --rebase origin main
git push -q origin main
