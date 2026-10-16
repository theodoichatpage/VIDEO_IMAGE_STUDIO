$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Windows.Forms
try {
 $sourceRoot=$PSScriptRoot
 $settingsFolder=Join-Path $env:LOCALAPPDATA 'VIDEO_IMAGE_STUDIO'
 $settingsFile=Join-Path $settingsFolder 'install_path.txt'
 $target=$null
 if (Test-Path (Join-Path $sourceRoot '.venv\Scripts\python.exe')) { $target=$sourceRoot }
 elseif (Test-Path $settingsFile) {
  $saved=(Get-Content -LiteralPath $settingsFile -Raw).Trim()
  if ((Test-Path (Join-Path $saved '.venv\Scripts\python.exe')) -and (Test-Path (Join-Path $saved 'server.py'))) { $target=$saved }
 }
 if (!$target) {
  $answer=[System.Windows.Forms.MessageBox]::Show('Ban da co thu muc Studio cu? Yes: chon thu muc cu de giu du lieu. No: cai moi tai thu muc nay.','VIDEO IMAGE STUDIO','YesNoCancel')
  if ($answer -eq 'Cancel') { exit 0 }
  if ($answer -eq 'Yes') {
   $picker=New-Object System.Windows.Forms.FolderBrowserDialog
   $picker.Description='Chon thu muc Studio cu co projects va .venv'
   if ($picker.ShowDialog() -ne 'OK') { exit 0 }
   $target=$picker.SelectedPath
   if (!(Test-Path (Join-Path $target 'server.py'))) { throw 'Thu muc duoc chon khong co server.py.' }
  } else { $target=$sourceRoot }
 }
 $target=[IO.Path]::GetFullPath($target)
 $sourceRoot=[IO.Path]::GetFullPath($sourceRoot)
 $port=Get-NetTCPConnection -LocalPort 7871 -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1
 if ($port) {
  $process=Get-CimInstance Win32_Process -Filter "ProcessId=$($port.OwningProcess)"
  $expected=Join-Path $target 'server.py'
  if ($process.Name -notmatch '^python(w)?\.exe$' -or !$process.CommandLine -or $process.CommandLine.IndexOf($expected,[StringComparison]::OrdinalIgnoreCase) -lt 0) { throw 'Cong 7871 dang duoc ung dung/ban Studio o thu muc khac su dung. Dong cua so do roi chay lai file nay.' }
  if ($target -eq $sourceRoot) {
   $diskVersion=[regex]::Match((Get-Content -LiteralPath (Join-Path $target 'server.py') -Raw),"VERSION='([^']+)'").Groups[1].Value
   $sameVersion=$false
   try { $page=Invoke-WebRequest -UseBasicParsing -Uri 'http://127.0.0.1:7871/' -TimeoutSec 3;$sameVersion=$diskVersion -and $page.Content.Contains($diskVersion) } catch { $sameVersion=$false }
   if ($sameVersion) { Start-Process 'http://127.0.0.1:7871';exit 0 }
  }
  Write-Host 'Dang dong ban Studio cu de cap nhat...'
  Stop-Process -Id $port.OwningProcess -ErrorAction Stop
  for ($i=0;$i -lt 30;$i++) {
   if (!(Get-NetTCPConnection -LocalPort 7871 -State Listen -ErrorAction SilentlyContinue)) { break }
   Start-Sleep -Milliseconds 100
  }
  if (Get-NetTCPConnection -LocalPort 7871 -State Listen -ErrorAction SilentlyContinue) { throw 'Studio cu chua dong xong. Hay thu lai.' }
 }
 if ($target -ne $sourceRoot) {
  Write-Host "Cap nhat vao: $target"
  # Copy application files only. Never overwrite projects, virtualenv or pairing config.
  $files=@('server.py','video_builder.py','video_routes.py','video_editor.html','core.py','scene_analysis.py','analysis_pipeline.py','connection_config.py','download_watch.py','index.html','split_ui.html','mo_studio.ps1','MO_VIDEO_IMAGE_STUDIO.bat','khoi_dong.ps1','cap_nhat.ps1','CAP_NHAT_BAN_CU.bat','0_VIDEO_IMAGE_STUDIO.bat','1_CAI_DAT.bat','2_MO_UNG_DUNG.bat','HUONG_DAN.txt','HUONG_DAN.html')
  foreach ($name in $files) {
   $inputFile=Join-Path $sourceRoot $name
   if (!(Test-Path $inputFile)) { throw "Goi cap nhat thieu $name. Giai nen day du truoc." }
  }
  foreach ($name in $files) { Copy-Item -LiteralPath (Join-Path $sourceRoot $name) -Destination (Join-Path $target $name) -Force }
  Get-ChildItem -LiteralPath $sourceRoot -Filter 'CAP_NHAT_*.txt' | Copy-Item -Destination $target -Force
  foreach ($folder in @('extension','SAM2_Tach_Anh')) {
   Copy-Item -LiteralPath (Join-Path $sourceRoot $folder) -Destination $target -Recurse -Force
  }
 }
 $python=Join-Path $target '.venv\Scripts\python.exe'
 if (!(Test-Path $python)) {
  Write-Host 'Dang tao moi truong Python (chi lan dau)...'
  & py -3.11 -m venv (Join-Path $target '.venv')
  if ($LASTEXITCODE -ne 0) { throw 'Can cai Python 3.11 va Python Launcher (py) truoc.' }
 }
 & $python -c "import importlib.util,sys;sys.exit(0 if importlib.util.find_spec('flask') and importlib.util.find_spec('PIL') and importlib.util.find_spec('imageio_ffmpeg') else 1)"
 if ($LASTEXITCODE -ne 0) {
  Write-Host 'Dang cai thu vien con thieu...'
  & $python -m pip install 'flask>=3,<4' 'pillow>=10' 'imageio-ffmpeg==0.6.0'
  if ($LASTEXITCODE -ne 0) { throw 'Chua cai duoc thu vien. Kiem tra Internet va thu lai.' }
 }
 New-Item -ItemType Directory -Path $settingsFolder -Force | Out-Null
 [IO.File]::WriteAllText($settingsFile,$target)
 Set-Location -LiteralPath $target
 Write-Host 'Studio dang chay. De cua so nay mo khi su dung.'
 & $python (Join-Path $target 'server.py')
 if ($LASTEXITCODE -ne 0) { throw 'Studio da dung do loi. Xem thong bao phia tren.' }
 exit 0
} catch {
 Write-Host ('LOI: '+$_.Exception.Message) -ForegroundColor Red
 exit 1
}
