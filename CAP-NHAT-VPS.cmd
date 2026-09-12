@echo off
chcp 65001 >nul
title Site Autopilot - Cap nhat ban moi len VPS
set "VPS=169.58.153.3"
set "REPO=https://github.com/toilaheosua/website"

echo ==============================================
echo   Cap nhat Site Autopilot tren VPS %VPS%
echo   Nguon: %REPO%
echo ==============================================
echo.
echo Dashboard se tat vai giay trong luc cai. Du lieu site, khoa API, mat khau giu nguyen.
echo Neu hoi mat khau, nhap mat khau root cua VPS.
echo.

ssh root@%VPS% "cd /root && rm -rf website && git clone -q %REPO% && bash website/site-autopilot/deploy/install.sh"
if errorlevel 1 (
  echo.
  echo Cap nhat gap loi. Doc thong bao phia tren hoac gui anh chup man hinh nay.
  pause
  exit /b 1
)

echo.
echo Cap nhat xong. Mo dashboard bang MO-DASHBOARD.cmd (neu dang mo thi nhan Ctrl+F5 de tai lai).
pause
