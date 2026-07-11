@echo off
cd /d "%~dp0"
node server.js
echo.
echo Сервер остановлен. Нажмите любую клавишу, чтобы закрыть это окно.
pause >nul
