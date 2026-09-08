@echo off
rem ===========================================================================
rem  App.cmd - launch the FigmaBridge GUI (STA) or pass CLI actions through.
rem  ASCII only, no BOM.
rem ===========================================================================
setlocal
set "PS1=%~dp0App.ps1"

if not exist "%PS1%" (
  echo App.ps1 not found next to App.cmd: "%PS1%"
  exit /b 1
)

if not "%~1"=="" goto :with_args

powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%PS1%"
exit /b %ERRORLEVEL%

:with_args
powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File "%PS1%" %*
exit /b %ERRORLEVEL%
