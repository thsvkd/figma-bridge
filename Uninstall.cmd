@echo off
rem ===========================================================================
rem  Uninstall.cmd - remove shortcuts, MCP entries, socket, installed files.
rem  ASCII only, no BOM.
rem ===========================================================================
setlocal
set "PS1=%~dp0Install.ps1"

if not exist "%PS1%" (
  echo Install.ps1 not found next to Uninstall.cmd: "%PS1%"
  exit /b 1
)

powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%PS1%" -Uninstall %*
set FB_RC=%ERRORLEVEL%
if "%~1"=="" (
  echo.
  pause
)
exit /b %FB_RC%
