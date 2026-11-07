@echo off
title AUTONEXIS Assistant
echo ===================================================
echo   Starting AUTONEXIS Assistant (Unified App)...
echo ===================================================
cd /d "%~dp0"
if exist backend\venv\Scripts\python.exe (
    backend\venv\Scripts\python.exe run.py
) else (
    python run.py
)
pause
