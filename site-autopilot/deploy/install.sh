#!/usr/bin/env bash
# =============================================================================
#  Cài Site Autopilot lên VPS (Ubuntu/Debian), chạy bằng root sau khi đã giải nén mã nguồn:
#     cd /root && tar xzf site-autopilot.tar.gz && bash site-autopilot/deploy/install.sh
#  Cài Node.js 24, PM2, build ứng dụng vào /opt/site-autopilot và chạy nền.
#  Chạy lại script này mỗi khi cập nhật mã nguồn (tải tar.gz mới lên rồi chạy lại).
# =============================================================================
set -euo pipefail

APP_DIR="${APP_DIR:-/opt/site-autopilot}"
SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
[ "$(id -u)" -eq 0 ] || { echo "Hãy chạy bằng root"; exit 1; }
export DEBIAN_FRONTEND=noninteractive

log "Node.js 24"
NEED_NODE=1
if command -v node >/dev/null 2>&1; then
  MAJOR=$(node -v | sed 's/^v//' | cut -d. -f1)
  [ "$MAJOR" -ge 24 ] && NEED_NODE=0
fi
if [ "$NEED_NODE" -eq 1 ]; then
  apt-get install -y curl ca-certificates >/dev/null
  curl -fsSL https://deb.nodesource.com/setup_24.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v), npm $(npm -v)"

log "PM2"
command -v pm2 >/dev/null 2>&1 || npm install -g pm2 >/dev/null

log "Sao chép mã nguồn vào $APP_DIR"
mkdir -p "$APP_DIR"
if [ "$SRC_DIR" != "$APP_DIR" ]; then
  command -v rsync >/dev/null 2>&1 || apt-get install -y rsync >/dev/null
  rsync -a --delete --exclude node_modules --exclude data --exclude dist --exclude .env --exclude secrets "$SRC_DIR/" "$APP_DIR/"
fi
cd "$APP_DIR"
mkdir -p data secrets
chmod 700 secrets

log "Cài thư viện và build"
npm ci --no-audit --no-fund
npm run build

if [ ! -f secrets/id_ed25519 ]; then
  log "Tạo khóa SSH để dashboard tự đăng nhập vào chính server này"
  ssh-keygen -t ed25519 -N "" -f secrets/id_ed25519 -C "site-autopilot" >/dev/null
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
  cat secrets/id_ed25519.pub >> /root/.ssh/authorized_keys
fi

log "Khởi động bằng PM2"
if pm2 describe site-autopilot >/dev/null 2>&1; then
  pm2 restart site-autopilot >/dev/null
else
  pm2 start deploy/ecosystem.config.cjs >/dev/null
fi
pm2 save >/dev/null
pm2 startup systemd -u root --hp /root >/dev/null 2>&1 || true

echo
echo "Xong. Ứng dụng ở $APP_DIR, chạy nền tại http://127.0.0.1:3000 (chỉ nội bộ)."
if [ ! -f .env ]; then
  echo "Chưa có file .env. Bước tiếp theo:"
  echo "   cd $APP_DIR && bash deploy/configure.sh"
else
  echo "Xem log: pm2 logs site-autopilot"
fi
