@echo off
title Piora desktop build
setlocal

set "LOGFILE=F:\piGUI\desktop\build-log.txt"

REM ---- Check if running as admin ----
>nul 2>&1 net session
if %errorlevel% neq 0 (
    echo ============================================
    echo  Requesting administrator privileges...
    echo  Click YES on the UAC prompt.
    echo ============================================
    echo.
    powershell -NoProfile -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    if %errorlevel% neq 0 (
        echo.
        echo ============================================
        echo  [ERROR] Elevation failed or UAC was cancelled.
        echo  Please right-click this file and choose
        echo  "Run as administrator" manually.
        echo ============================================
        echo.
        pause
    )
    exit /b
)

REM ---- Running as admin ----
echo ============================================
echo  Piora desktop build (admin)
echo  %date% %time%
echo ============================================
echo.

echo [1/4] Defender exclusion for F:\piGUI ...
powershell -NoProfile -Command "Add-MpPreference -ExclusionPath 'F:\piGUI' -ErrorAction SilentlyContinue"
echo   done.
echo.

echo [2/4] Stop Windows Search indexer ...
powershell -NoProfile -Command "Stop-Service WSearch -Force -ErrorAction SilentlyContinue"
echo   done.
echo.

echo [3/4] Clean stale dirs ...
powershell -NoProfile -Command "Remove-Item 'F:\piGUI\desktop\release2' -Recurse -Force -ErrorAction SilentlyContinue; Remove-Item 'F:\piGUI\desktop\release3' -Recurse -Force -ErrorAction SilentlyContinue"
timeout /t 2 /nobreak >nul
echo   done.
echo.

echo [4/4] electron-builder packaging ...
echo   This takes 1-3 minutes. Please wait...
echo.

set "NODE_EXE=C:\nvm6w\nodejs\node.exe"
set "NODE_OPTIONS=--require F:/piGUI/scripts/fs-retry.cjs"
cd /d F:\piGUI\desktop

echo ===== BUILD OUTPUT START =====
"%NODE_EXE%" "F:/piGUI/node_modules/electron-builder/cli.js" --config electron-builder-release3.yml --win --x64 --publish never
set "RC=%errorlevel%"
echo ===== BUILD OUTPUT END (exit code %RC%) =====
echo.

if exist "F:\piGUI\desktop\release3\*.exe" (
    echo ============================================
    echo  [SUCCESS] Portable exe built!
    echo ============================================
    dir "F:\piGUI\desktop\release3\*.exe"
) else (
    echo ============================================
    echo  [FAILED] No exe found in release3.
    echo  Exit code: %RC%
    echo ============================================
)

echo.
echo Restore later (as admin):
echo   Start-Service WSearch
echo   Remove-MpPreference -ExclusionPath "F:\piGUI"
echo.
pause
