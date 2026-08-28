@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"

if "%~1"=="" (
  echo Usage:
  echo   RUN_AGENT_EVALUATION.bat "C:\path\to\strategy-model.json"
  echo.
  echo This suite keeps the model frozen and runs:
  echo   - core Agent contracts
  echo   - offline Strategy decision regression
  echo   - standalone Agent Runtime broker / extension connection check
  echo   - browser-native Strategy regression gates
  exit /b 64
)

set "MODEL=%~1"
if not exist "%MODEL%" (
  echo [FATAL] Model file not found: %MODEL%
  exit /b 66
)

for /f "delims=" %%V in ('node -e "const fs=require('fs');const m=JSON.parse(fs.readFileSync(process.argv[1],'utf8'));console.log(m.modelVersion?m.modelVersion:(m.version?m.version:'unknown'))" "%MODEL%"') do set "MODEL_VERSION=%%V"
for /f "delims=" %%H in ('node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "%MODEL%"') do set "MODEL_HASH_BEFORE=%%H"

if not defined MODEL_VERSION (
  echo [FATAL] Could not read model version.
  exit /b 65
)
if not defined MODEL_HASH_BEFORE (
  echo [FATAL] Could not hash model file.
  exit /b 65
)

call START_AGENT_RUNTIME_BROKER.bat
if errorlevel 1 (
  echo [FATAL] Standalone Agent Runtime Broker is not available.
  exit /b 69
)

set /a TOTAL=0
set /a PASS=0
set /a FAIL=0
set /a SKIP=0

echo ============================================================
echo AGENT EVALUATION SUITE
echo ============================================================
echo Model: %MODEL%
echo Model version: %MODEL_VERSION%
echo Model SHA256: %MODEL_HASH_BEFORE%
echo Runtime transport: standalone broker http://127.0.0.1:3000
echo Control Center UI: NOT REQUIRED
echo.

call :run "One-action bridge + follow-live contract" node script\checks\one_action_bridge.js
call :run "Semantic action effect evaluator" node script\checks\semantic_action_effect.js
call :run "Goal Checker" node script\checks\goal_checker.js
call :run "Bounded one-step replan" node script\checks\one_step_replan.js
call :run "Tab lifecycle Agent integration" node script\checks\tab_lifecycle_agent_integration.js
call :run "Offline frozen Strategy decisions" node script\offline_strategy_fresh_unseen_decision_gate.js --model "%MODEL%"

echo.
echo ============================================================
echo AGENT RUNTIME EXTENSION CHECK
echo ============================================================
call :run "Agent Runtime connected and tabs observable" node script\agent_one_action.js --tabs

if /I "%MODEL_VERSION%"=="0.3.3" (
  call :run "Native text + submit regression (Cargo)" node script\offline_strategy_fresh_native_text_gate.js --model "%MODEL%"
  call :run "Long mission + recovery regression (Signal Relay)" node script\offline_strategy_fresh_long_mission_gate.js --model "%MODEL%"
  call :run "Long fresh-unseen historical regression (Harbor)" node script\offline_strategy_fresh_long_harbor_gate.js --model "%MODEL%"
) else (
  echo.
  echo [SKIP] Three historical native gates currently assert provider version 0.3.3.
  echo        Model version is %MODEL_VERSION%.
  echo        They are not run because a version assertion failure would not measure capability.
  set /a SKIP+=3
)

for /f "delims=" %%H in ('node -e "const fs=require('fs'),c=require('crypto');console.log(c.createHash('sha256').update(fs.readFileSync(process.argv[1])).digest('hex'))" "%MODEL%"') do set "MODEL_HASH_AFTER=%%H"

echo.
echo ============================================================
echo SUMMARY
echo ============================================================
echo PASS: !PASS!
echo FAIL: !FAIL!
echo SKIP: !SKIP!
echo RUN : !TOTAL!
echo Model SHA256 before: %MODEL_HASH_BEFORE%
echo Model SHA256 after : %MODEL_HASH_AFTER%

if /I not "%MODEL_HASH_BEFORE%"=="%MODEL_HASH_AFTER%" (
  echo [FAIL] Model file changed during evaluation.
  exit /b 2
)

if !FAIL! GTR 0 (
  echo RESULT: FAIL
  exit /b 1
)

echo RESULT: PASS
echo.
echo NOTE: Cargo / Signal Relay / Harbor are regression evidence, not new fresh-unseen intelligence evidence.
echo       The Strategy model is loaded by the evaluation runner; Agent Runtime Extension is the browser executor.
exit /b 0

:run
set /a TOTAL+=1
echo.
echo ------------------------------------------------------------
echo [!TOTAL!] %~1
echo ------------------------------------------------------------
shift
call %*
if errorlevel 1 (
  echo [FAIL] %*
  set /a FAIL+=1
) else (
  echo [PASS]
  set /a PASS+=1
)
goto :eof
