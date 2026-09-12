@echo off
chcp 65001 >nul
title Site Autopilot - Mo dashboard
set "VPS=169.58.153.3"
set "PORT=3000"

echo ==============================================
echo   Site Autopilot - mo phan quan ly (dashboard)
echo   VPS: %VPS%
echo ==============================================
echo.

rem Duong ham da mo tu truoc thi chi can mo trinh duyet
netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul
if %errorlevel%==0 (
  echo Duong ham SSH da mo san. Dang mo trinh duyet...
  start "" "http://localhost:%PORT%/"
  exit /b 0
)

echo Dang mo duong ham SSH toi VPS...
echo Neu cua so moi hoi mat khau, nhap mat khau root cua VPS roi Enter.
echo (Chay CAI-KHOA-SSH.cmd mot lan de khong phai nhap mat khau nua.)
echo.
rem Cua so nay giu duong ham, dong no la mat ket noi dashboard
start "Site Autopilot - duong ham SSH (DUNG DONG cua so nay khi dang dung dashboard)" ssh -o ServerAliveInterval=30 -o ExitOnForwardFailure=yes -N -L %PORT%:127.0.0.1:%PORT% root@%VPS%

rem Cho cong mo, toi da 60 giay (du thoi gian nhap mat khau)
for /L %%i in (1,1,60) do (
  timeout /t 1 >nul
  netstat -ano | findstr /R /C:"127.0.0.1:%PORT% .*LISTENING" >nul && goto open
)
echo.
echo Khong mo duoc duong ham sau 60 giay. Kiem tra: mat khau root, mang, VPS dang chay.
pause
exit /b 1

:open
echo Da ket noi. Dang mo trinh duyet http://localhost:%PORT%/
start "" "http://localhost:%PORT%/"
timeout /t 2 >nul
exit /b 0
