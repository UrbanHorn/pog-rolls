@echo off
cd /d "%~dp0"
"C:\Users\user\.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe" server.js
echo.
echo Сервер остановлен. Нажмите любую клавишу, чтобы закрыть это окно.
pause >nul
