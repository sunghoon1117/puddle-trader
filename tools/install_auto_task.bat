@echo off
rem (선택) PC 가 켜져 있을 때 3시간마다 신규 영상 자막을 분석해 GitHub 에 반영하는 예약 작업을 등록합니다.
rem GitHub 서버가 이미 30분마다 새 영상을 제목·자막으로 분석하므로, 이 작업은 '자막 정밀 분석 보강'용입니다.
rem 제거: schtasks /delete /tn PuddleTrader-Knowledge /f
chcp 65001 >nul
schtasks /create /tn "PuddleTrader-Knowledge" /sc hourly /mo 3 /tr "powershell.exe -NoProfile -WindowStyle Hidden -Command \"& '%~dp0sync_knowledge.bat'\"" /f
echo 등록 완료. 제거하려면: schtasks /delete /tn PuddleTrader-Knowledge /f
pause
