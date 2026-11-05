@echo off
setlocal
cd /d "%~dp0"
echo.
echo  牌理 · Mahjong Lab
echo  http://127.0.0.1:4173
echo.
start "" "http://127.0.0.1:4173"
node server.mjs
if errorlevel 1 pause
endlocal
