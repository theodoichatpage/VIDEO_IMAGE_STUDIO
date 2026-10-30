@echo off
setlocal EnableExtensions DisableDelayedExpansion
pushd "%~dp0" || exit /b 1
if not exist ".venv\Scripts\python.exe" (
  py -3.11 -m venv .venv 2>nul || py -3.12 -m venv .venv
)
if not exist ".venv\Scripts\python.exe" (
  echo Can cai Python 3.11 hoac 3.12 truoc khi cai Local Engine.
  goto :error
)
"%CD%\.venv\Scripts\python.exe" "%CD%\install.py"
if errorlevel 1 goto :error
echo.
echo VIDEO IMAGE STUDIO Local Engine da cai dat xong.
popd
exit /b 0
:error
popd
pause
exit /b 1
