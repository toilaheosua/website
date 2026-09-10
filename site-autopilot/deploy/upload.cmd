@echo off
chcp 65001 >nul
title Site Autopilot - tai ma nguon len VPS
echo ==============================================
echo   Site Autopilot - dong goi va tai len VPS
echo ==============================================
echo.
set "IP=%~1"
if "%IP%"=="" set /p IP=Nhap IP VPS (Enter de chi dong goi, khong tai len):
if "%IP%"=="" (
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack.ps1"
) else (
  echo Se hoi mat khau root cua VPS. Lan dau ket noi, go yes khi duoc hoi.
  echo.
  powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0pack.ps1" -Server %IP%
)
echo.
pause
