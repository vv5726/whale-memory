@echo off
cd /d "%~dp0"
node tools\check-encoding.ts
if errorlevel 1 (
  echo [FAIL] encoding check failed - U+FFFD found in src/ or data/, abort.
  exit /b 1
)
node src\bot.ts
