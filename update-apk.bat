@echo off
chcp 65001 >nul
rem Downloads the newest APK built on GitHub into downloads\CinemaHumam.apk
cd /d "%~dp0"
set GH="C:\Program Files\GitHub CLI\gh.exe"
if exist downloads\tmp rmdir /s /q downloads\tmp
mkdir downloads\tmp 2>nul
%GH% run download -R h9p/cinemana-tv -n CinemaHumam-apk -D downloads\tmp || goto fail
move /y downloads\tmp\*.apk downloads\CinemaHumam.apk >nul || goto fail
rmdir /s /q downloads\tmp
echo.
echo   تم تحديث ملف الـ APK ✓
echo.
pause
exit /b 0
:fail
echo.
echo   فشل التحميل. تأكد من الإنترنت وتسجيل الدخول: gh auth login
echo.
pause
exit /b 1
