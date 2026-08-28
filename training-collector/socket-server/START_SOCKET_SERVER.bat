@echo off
setlocal
cd /d "%~dp0"

rem Optional arguments keep the existing one-click launcher reusable:
rem   START_SOCKET_SERVER.bat "<base-dataset-dir>" "<base-model.json>" [batch-threshold]
if not "%~1"=="" set "TC_STRATEGY_BASE_DATASET=%~1"
if not "%~2"=="" set "TC_STRATEGY_BASE_MODEL=%~2"
if not "%~3"=="" set "TC_STRATEGY_BATCH_THRESHOLD=%~3"
if not defined TC_STRATEGY_BATCH_THRESHOLD set "TC_STRATEGY_BATCH_THRESHOLD=100"

if not exist node_modules (
  echo Installing socket server dependencies...
  call npm install
  if errorlevel 1 exit /b 1
)

echo Starting Training Collector socket server...
echo Strategy batch threshold: %TC_STRATEGY_BATCH_THRESHOLD%
if defined TC_STRATEGY_BASE_DATASET (
  echo Strategy base dataset: %TC_STRATEGY_BASE_DATASET%
) else (
  echo Strategy base dataset: not configured - machine classification works, candidate creation waits.
)
if defined TC_STRATEGY_BASE_MODEL (
  echo Strategy base model: %TC_STRATEGY_BASE_MODEL%
) else (
  echo Strategy base model: not configured - machine classification works, candidate creation waits.
)
call npm start