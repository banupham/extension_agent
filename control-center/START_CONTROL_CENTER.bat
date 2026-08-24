@echo off
setlocal
cd /d "%~dp0"
echo [V3.8] Stopping previous Control Center/Broker instances on ports 8788 and 3000...
for %%P in (8788 3000) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr :%%P ^| findstr LISTENING') do taskkill /PID %%A /F >nul 2>nul
)
timeout /t 1 /nobreak >nul
echo [V3.8] Starting Browser Debug Agent Control Center...
start "Control Center V3.8" /min cmd /c "node manager\control_center.js >> manager\data\launcher.log 2>&1"
timeout /t 2 /nobreak >nul
start "" "http://127.0.0.1:8788"
echo Dashboard: http://127.0.0.1:8788
endlocal
