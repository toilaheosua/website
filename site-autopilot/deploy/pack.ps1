<#
.SYNOPSIS
  Đóng gói Site Autopilot thành site-autopilot.tar.gz (bỏ node_modules, data, dist, .env, secrets) và tùy chọn tải lên VPS.

.EXAMPLE
  # chỉ đóng gói
  powershell -ExecutionPolicy Bypass -File deploy\pack.ps1

  # đóng gói và tải lên VPS (sẽ hỏi mật khẩu root)
  powershell -ExecutionPolicy Bypass -File deploy\pack.ps1 -Server 1.2.3.4

  # kiểm tra khóa máy chủ, không tải lên
  powershell -ExecutionPolicy Bypass -File deploy\pack.ps1 -Server 1.2.3.4 -DryRun
#>
param(
  [string]$Server = "",
  [string]$User = "root",
  [int]$Port = 22,
  [string]$Dest = "/root",
  [switch]$DryRun
)

# Tự kiểm tra mã thoát của lệnh ngoài, không để PowerShell 5.1 dừng vì stderr
$ErrorActionPreference = "Continue"
$appDir = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$parent = Split-Path -Parent $appDir
$name = Split-Path -Leaf $appDir
# Dùng đường dẫn dài của thư mục tạm: dạng ngắn "VIETLY~1" chứa dấu ~ làm PowerShell hiểu nhầm
$tmp = [IO.Path]::GetTempPath()
try { $tmp = (Get-Item -LiteralPath $tmp).FullName } catch { }
$out = Join-Path $tmp "site-autopilot.tar.gz"

if (Test-Path -LiteralPath $out) { Remove-Item -LiteralPath $out -Force }
Push-Location $parent
try {
  & tar -czf $out `
    --exclude "$name/node_modules" `
    --exclude "$name/data" `
    --exclude "$name/dist" `
    --exclude "$name/.env" `
    --exclude "$name/secrets" `
    --exclude "$name/.claude" `
    $name
  if ($LASTEXITCODE -ne 0) { Write-Host "tar thất bại (mã $LASTEXITCODE)" -ForegroundColor Red; exit 1 }
} finally {
  Pop-Location
}
$size = [math]::Round((Get-Item -LiteralPath $out).Length / 1KB)
Write-Host "Đã tạo $out ($size KB)"

if (-not $Server) {
  Write-Host ""
  Write-Host "Tải lên VPS bằng lệnh (thay IP):"
  Write-Host "   scp `"$out`" root@IP:/root/site-autopilot.tar.gz"
  Write-Host "hoặc chạy lại: deploy\pack.ps1 -Server IP"
  exit 0
}

# --- Kiểm tra khóa nhận dạng máy chủ trong known_hosts ---------------------------------
# VPS cài lại hoặc tạo mới với IP cũ sẽ có khóa mới; scp sẽ từ chối ("REMOTE HOST IDENTIFICATION HAS CHANGED").
$known = @(cmd /c "ssh-keygen -F $Server 2>nul" | Where-Object { $_ -and $_ -notmatch '^#' })
if ($known.Count -gt 0) {
  # Thử kết nối không mật khẩu chỉ để so khóa máy chủ (ssh-keyscan trên Windows lỗi với máy chủ mới nên không dùng)
  $probe = @(cmd /c "ssh -o BatchMode=yes -o StrictHostKeyChecking=yes -o ConnectTimeout=15 -p $Port ${User}@${Server} exit 2>&1")
  $probeText = $probe -join "`n"
  if ($probeText -match 'HOST IDENTIFICATION HAS CHANGED|Host key verification failed') {
    Write-Host ""
    Write-Host "Khóa nhận dạng của $Server đã đổi so với lần kết nối trước." -ForegroundColor Yellow
    Write-Host "Điều này bình thường nếu VPS vừa được cài lại hoặc tạo mới với IP cũ. Nếu bạn KHÔNG vừa cài lại VPS, hãy dừng và kiểm tra."
    $answer = Read-Host "Xóa khóa cũ trong known_hosts và tiếp tục? (y/n)"
    if ($answer -match '^[yY]') {
      cmd /c "ssh-keygen -R $Server >nul 2>nul"
      Write-Host "Đã xóa khóa cũ (bản sao lưu: $env:USERPROFILE\.ssh\known_hosts.old). Lần kết nối tới sẽ hỏi 'continue connecting', gõ yes."
    } else {
      Write-Host "Dừng theo yêu cầu."; exit 1
    }
  } elseif ($probeText -match 'Connection timed out|Could not resolve|No route to host|Connection refused') {
    Write-Host "Không kết nối được tới $Server cổng $Port. Kiểm tra IP, VPS đã bật và tường lửa." -ForegroundColor Yellow
  } else {
    Write-Host "Khóa máy chủ khớp với known_hosts."
  }
} else {
  Write-Host "Lần đầu kết nối tới ${Server}: sẽ hỏi 'continue connecting', gõ yes."
}

if ($DryRun) { Write-Host "DryRun: không tải lên."; exit 0 }

Write-Host "Đang tải lên ${User}@${Server}:$Dest (nhập mật khẩu root khi được hỏi, gõ không hiện ký tự)..."
& scp -P $Port $out "${User}@${Server}:$Dest/site-autopilot.tar.gz"
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "scp thất bại (mã $LASTEXITCODE)." -ForegroundColor Red
  Write-Host "Gợi ý: sai mật khẩu → chạy lại; 'Connection timed out' → kiểm tra IP và VPS đã bật; 'HOST IDENTIFICATION HAS CHANGED' → chạy: ssh-keygen -R $Server"
  exit 1
}
Write-Host ""
Write-Host "Xong. Trên VPS chạy:" -ForegroundColor Green
Write-Host "   cd /root && tar xzf site-autopilot.tar.gz && bash site-autopilot/deploy/setup-vps.sh"
