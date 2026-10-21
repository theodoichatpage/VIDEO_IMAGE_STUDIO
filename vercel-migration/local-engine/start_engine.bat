@echo off
cd /d "%~dp0"
if not exist ".venv\Scripts\python.exe" (
  echo Local Engine chua duoc cai. Hay chay install_windows.bat truoc.
  pause
  exit /b 1
)
call .venv\Scripts\activate.bat
python app.py
pause
