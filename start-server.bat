@echo off
chcp 65001 >nul
title سينما همام - السيرفر
cd /d "%~dp0"
node serve.js 80
pause
