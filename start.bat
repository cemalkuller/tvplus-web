@echo off
title Turkcell TV+ Web Player
cd /d "%~dp0"

echo ====================================================
echo   Turkcell TV+ Benzeri Web IPTV Player Baslatiliyor
echo ====================================================
echo.

REM Bagimliliklari kontrol et ve kur
if not exist node_modules (
    echo [1/2] Gerekli paketler yukleniyor (npm install)...
    call npm install
) else (
    echo [1/2] Paketler hazir.
)

echo.
echo [2/2] Web Sunucusu Baslatiliyor: http://localhost:3000
echo.

REM Tarayicida otomatik ac
start http://localhost:3000

REM Sunucuyu calistir
node server.js

pause
