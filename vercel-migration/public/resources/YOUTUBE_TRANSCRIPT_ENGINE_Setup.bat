@echo off
setlocal EnableExtensions
title YOUTUBE TRANSCRIPT ENGINE Setup
set "DEST=%LOCALAPPDATA%\VIDEO_IMAGE_STUDIO\YouTubeTranscriptEngine"
set "ZIP=%TEMP%\youtube_transcript_engine.zip"
set "SRC=%TEMP%\youtube_transcript_engine_src"

where python >nul 2>nul || (
  echo Python 3.11+ chua duoc cai hoac chua co trong PATH.
  echo Cai Python tu python.org, chon Add Python to PATH, sau do chay lai file nay.
  pause
  exit /b 1
)

if exist "%SRC%" rmdir /s /q "%SRC%"
if exist "%ZIP%" del /q "%ZIP%"
mkdir "%SRC%" >nul 2>nul
mkdir "%DEST%" >nul 2>nul

echo Dang tai YouTube Transcript Engine...
curl.exe -fL --retry 3 "https://github.com/theodoichatpage/YOUTUBE_TRANSCRIPT/archive/refs/heads/feature/transcript-service.zip" -o "%ZIP%" || goto :error
powershell -NoProfile -ExecutionPolicy Bypass -Command "Expand-Archive -LiteralPath '%ZIP%' -DestinationPath '%SRC%' -Force" || goto :error
xcopy "%SRC%\YOUTUBE_TRANSCRIPT-feature-transcript-service\*" "%DEST%\" /E /I /Y >nul || goto :error
cd /d "%DEST%"
if not exist ".venv\Scripts\python.exe" python -m venv .venv || goto :error
call .venv\Scripts\python.exe -m pip install --upgrade pip || goto :error
call .venv\Scripts\python.exe -m pip install -r requirements.txt || goto :error
(
 echo @echo off
 echo cd /d "%DEST%"
 echo .venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 8000
) > start_transcript_engine.bat
start "YouTube Transcript Engine" "%DEST%\start_transcript_engine.bat"
echo.
echo HOAN TAT. Transcript Engine dang khoi dong tai http://127.0.0.1:8000
echo Quay lai VIDEO IMAGE STUDIO ^> Cai dat ^> Kiem tra ket noi.
pause
exit /b 0

:error
echo.
echo KHONG THE CAI YOUTUBE TRANSCRIPT ENGINE.
pause
exit /b 1
