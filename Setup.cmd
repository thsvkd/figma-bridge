@echo off
rem ===========================================================================
rem  Setup.cmd - install FigmaBridge without fighting the execution policy.
rem  ASCII only, no BOM. cmd.exe breaks on both.
rem ===========================================================================
setlocal
set "PS1=%~dp0Install.ps1"

if not exist "%PS1%" (
  echo Install.ps1 not found next to Setup.cmd: "%PS1%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" %*
set FB_RC=%ERRORLEVEL%
if "%~1"=="" (
  echo.
  pause
)
exit /b %FB_RC%
