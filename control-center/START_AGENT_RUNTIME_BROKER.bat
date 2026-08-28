@echo off
setlocal EnableExtensions
cd /d "%~dp0"

node -e "const http=require('http');const r=http.get('http://127.0.0.1:3000/health',x=>{process.exit(x.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(800,()=>{r.destroy();process.exit(1)});" >nul 2>&1
if not errorlevel 1 (
  echo Agent Runtime Broker is already running on http://127.0.0.1:3000
  exit /b 0
)

echo Starting standalone Agent Runtime Broker...
start "Agent Runtime Broker" /min node server\server.js

for /l %%I in (1,1,10) do (
  timeout /t 1 /nobreak >nul
  node -e "const http=require('http');const r=http.get('http://127.0.0.1:3000/health',x=>{process.exit(x.statusCode===200?0:1)});r.on('error',()=>process.exit(1));r.setTimeout(800,()=>{r.destroy();process.exit(1)});" >nul 2>&1
  if not errorlevel 1 (
    echo Agent Runtime Broker ready: http://127.0.0.1:3000
    exit /b 0
  )
)

echo [FAIL] Agent Runtime Broker did not become ready.
exit /b 1
