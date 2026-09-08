@echo off
rem Double-click this file to install. Filename may be Korean; content is ASCII.
setlocal
call "%~dp0Setup.cmd" %*
exit /b %ERRORLEVEL%
