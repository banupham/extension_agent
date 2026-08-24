@echo off
cd /d "%~dp0"
call STOP_CONTROL_CENTER.bat >nul 2>&1
timeout /t 1 /nobreak >nul
start "Browser Debug Agent Control Center V3.10" /min node manager\control_center.js
timeout /t 2 /nobreak >nul
start "" http://127.0.0.1:8788
