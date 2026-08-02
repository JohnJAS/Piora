@echo off
title piGUI desktop build
echo ============================================
echo  piGUI desktop build (auto-fix scanner lock)
echo ============================================
echo.
>nul 2>&1 net session
if %errorlevel% neq 0 (
    echo Requesting administrator privileges (click YES on the UAC prompt)...
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)
echo [OK] Running as administrator.
echo.
echo --- 1. Exclude F:\piGUI from Windows Defender ---
powershell -NoProfile -Command "Add-MpPreference -ExclusionPath 'F:\piGUI' -ErrorAction SilentlyContinue; Write-Host 'defender exclusion added'"
echo.
echo --- 2. Stop Windows Search indexer (it holds handles on new files) ---
powershell -NoProfile -Command "Stop-Service WSearch -Force -ErrorAction SilentlyContinue; Write-Host 'search indexer stopped'"
echo.
echo --- 3. Clean stale build output dirs ---
if exist "F:\piGUI\desktop\release2" rmdir /s /q "F:\piGUI\desktop\release2"
if exist "F:\piGUI\desktop\release3" rmdir /s /q "F:\piGUI\desktop\release3"
echo cleaned.
echo.
echo --- 4. Packaging desktop app (portable exe) ---
set NODE_OPTIONS=--require F:/piGUI/scripts/fs-retry.cjs
cd /d F:\piGUI\desktop
node "F:/piGUI/node_modules/electron-builder/cli.js" --config electron-builder-release3.yml --win --x64 --publish never
echo.
echo ============================================
echo  Build finished. The portable .exe will be in:
echo  F:\piGUI\desktop\release3\
echo ============================================
echo.
echo To restore Windows Search later, run as admin:
echo   Start-Service WSearch
echo To remove the Defender exclusion later:
echo   Remove-MpPreference -ExclusionPath "F:\piGUI"
echo.
pause
