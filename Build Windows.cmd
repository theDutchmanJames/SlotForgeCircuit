@echo off
rem Builds the SlotForge Circuit Windows installer and portable app.
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
  echo Install Node.js 24 or newer from https://nodejs.org, then run this builder again.
  pause
  exit /b 1
)
node desktop\build-desktop.cjs %*
