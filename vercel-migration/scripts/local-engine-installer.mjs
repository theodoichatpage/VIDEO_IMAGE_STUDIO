export function createLocalEngineInstaller(files) {
  if (!files.includes('install_windows.bat') || !files.includes('start_engine.bat')) throw new Error('Missing Local Engine launch scripts');
  if (files.some(name => !/^[A-Za-z0-9_.-]+$/.test(name))) throw new Error('Invalid Local Engine filename');
  const lines = ['@echo off','setlocal EnableExtensions DisableDelayedExpansion','title VIDEO IMAGE STUDIO Local Engine Setup',
    'set "BASE=https://video-image-studio.vercel.app/resources/local-engine"',
    'set "DEST=%LOCALAPPDATA%\\VIDEO_IMAGE_STUDIO\\LocalEngine"',
    'if not exist "%DEST%" mkdir "%DEST%"',
    'if not exist "%DEST%" goto :error',
    'pushd "%DEST%" || goto :error'];
  for (const name of files) lines.push(
    `curl.exe -fL --retry 3 "%BASE%/${name}" -o "%DEST%\\${name}.download" || goto :error`,
    `for %%F in ("%DEST%\\${name}.download") do if %%~zF EQU 0 goto :error`,
    `move /Y "%DEST%\\${name}.download" "%DEST%\\${name}" >nul || goto :error`);
  lines.push('if not exist "%DEST%\\install_windows.bat" goto :error',
    'call "%DEST%\\install_windows.bat"', 'if errorlevel 1 goto :error',
    'start "VIDEO IMAGE STUDIO Local Engine" "%ComSpec%" /d /c call "%DEST%\\start_engine.bat"',
    'echo HOAN TAT.','popd','pause','exit /b 0',':error',
    'echo KHONG THE TAI/CAP NHAT LOCAL ENGINE.',
    'echo Thu muc cai dat: "%DEST%"','pause','exit /b 1');
  return lines.join('\r\n')+'\r\n';
}
