@echo off
chcp 65001 >nul
title Site Autopilot - Cai khoa SSH (chay mot lan)
set "VPS=169.58.153.3"
set "KEY=%USERPROFILE%\.ssh\id_ed25519"

echo ==============================================
echo   Cai khoa SSH de vao VPS %VPS% khong can mat khau
echo   (chi can chay mot lan tren may nay)
echo ==============================================
echo.

if not exist "%USERPROFILE%\.ssh" mkdir "%USERPROFILE%\.ssh"
if exist "%KEY%" (
  echo Da co khoa SSH tai %KEY%, dung lai khoa nay.
) else (
  echo Dang tao khoa SSH moi...
  ssh-keygen -t ed25519 -N "" -f "%KEY%" -C "site-autopilot-%COMPUTERNAME%"
  if errorlevel 1 (
    echo Tao khoa that bai. May can co OpenSSH Client (Windows 10/11 da co san).
    pause
    exit /b 1
  )
)

echo.
echo Dang gui khoa cong khai len VPS. Nhap mat khau root cua VPS khi duoc hoi (lan cuoi cung).
type "%KEY%.pub" | ssh root@%VPS% "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys && echo DA-CAI-KHOA"
if errorlevel 1 (
  echo.
  echo Gui khoa that bai. Kiem tra mat khau hoac mang roi chay lai.
  pause
  exit /b 1
)

echo.
echo Dang kiem tra dang nhap khong mat khau...
ssh -o BatchMode=yes -o ConnectTimeout=10 root@%VPS% "echo OK-KHONG-CAN-MAT-KHAU"
if errorlevel 1 (
  echo Van con hoi mat khau. Thu chay lai file nay; neu van loi, gui anh chup man hinh nay.
) else (
  echo.
  echo Xong. Tu nay MO-DASHBOARD.cmd va CAP-NHAT-VPS.cmd khong hoi mat khau nua.
)
echo.
pause
