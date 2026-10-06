@echo off
rem Starts the whole system with an embedded database (no PostgreSQL install needed).
rem First run installs and builds everything, then opens http://localhost:3000
setlocal
cd /d "%~dp0"
title MG Inventory

where node >nul 2>nul
if errorlevel 1 (
  echo Node.js is not installed. Install Node.js 22 LTS from https://nodejs.org then run this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)
for /f "tokens=1 delims=v." %%a in ('node -v') do set NODEMAJOR=%%a
if %NODEMAJOR% LSS 22 (
  echo Node.js 22 or newer is required. Install the LTS version from https://nodejs.org then run this file again.
  start "" https://nodejs.org
  pause
  exit /b 1
)

if not exist backend\node_modules (
  echo Installing backend packages - first run only, takes a few minutes...
  call npm install --prefix backend || goto :fail
)
if not exist web\node_modules (
  echo Installing web packages - first run only...
  call npm install --prefix web || goto :fail
)
if not exist backend\dist\main.js (
  echo Building backend...
  call npm run build --prefix backend || goto :fail
)
if not exist web\dist\index.html (
  echo Building web app...
  call npm run build --prefix web || goto :fail
)

if "%PORT%"=="" set PORT=3000
echo.
echo Starting on http://localhost:%PORT%
echo Keep this window open while you use the system. Close it to stop.
start "" /min cmd /c "timeout /t 8 /nobreak >nul & start http://localhost:%PORT%"
call npm run local --prefix backend
pause
exit /b 0

:fail
echo.
echo Something failed above. Take a screenshot of this window and send it.
pause
exit /b 1
