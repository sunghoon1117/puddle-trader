@echo off
rem (선택) PC 가 켜져 있을 때 매일 오전 9시에 SEC 거물 거래를 수집해 올리는 예약 작업을 등록합니다. 제거: schtasks /delete /tn PuddleTrader-SEC /f
chcp 65001 >nul
schtasks /create /tn "PuddleTrader-SEC" /sc daily /st 09:00 /tr "cmd /c cd /d \"%~dp0..\" && python tools\sec_local.py" /f
echo 등록 완료(매일 09:00). 제거하려면: schtasks /delete /tn PuddleTrader-SEC /f
pause
