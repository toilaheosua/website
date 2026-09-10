#!/usr/bin/env bash
# =============================================================================
#  Site Autopilot - Trình hướng dẫn tạo file .env (hỏi từng mục, Enter để nhận giá trị gợi ý)
#  Chạy trong thư mục ứng dụng trên VPS:   bash deploy/configure.sh
#  Tự đọc thông tin aaPanel từ /root/site-autopilot-credentials.txt nếu có.
# =============================================================================
set -euo pipefail

APP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$APP_DIR/.env"
CRED_FILE=/root/site-autopilot-credentials.txt

cred() { grep -E "^$1=" "$CRED_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }
existing() { grep -E "^$1=" "$ENV_FILE" 2>/dev/null | head -1 | cut -d= -f2- || true; }

# ask "Câu hỏi" "giá trị mặc định" [secret]
ask() {
  local prompt="$1" default="${2:-}" secret="${3:-}" value
  if [ -n "$default" ]; then
    if [ "$secret" = "secret" ]; then prompt="$prompt [đã có, Enter để giữ]"; else prompt="$prompt [$default]"; fi
  fi
  if [ "$secret" = "secret" ]; then
    read -r -s -p "$prompt: " value </dev/tty; echo >/dev/tty
  else
    read -r -p "$prompt: " value </dev/tty
  fi
  printf '%s' "${value:-$default}"
}

hr() { printf '\n\033[1;34m%s\033[0m\n' "----- $* -----"; }

echo "Site Autopilot: tạo file cấu hình $ENV_FILE"
echo "Enter để dùng giá trị trong ngoặc. Key bí mật không hiển thị khi gõ."
[ -f "$CRED_FILE" ] && echo "Đã tìm thấy $CRED_FILE, sẽ điền sẵn thông tin aaPanel."

hr "Dashboard"
ADMIN_USER=$(ask "Tài khoản đăng nhập dashboard" "$(existing ADMIN_USER)")
ADMIN_USER=${ADMIN_USER:-admin}
echo "Mật khẩu dashboard có thể để trống: lần đầu mở dashboard sẽ hiện trang đặt mật khẩu ngay trên web."
ADMIN_PASSWORD=$(ask "Mật khẩu dashboard (Enter để đặt trên web)" "$(existing ADMIN_PASSWORD)" secret)
SESSION_SECRET=$(existing SESSION_SECRET)
[ -n "$SESSION_SECRET" ] || SESSION_SECRET=$(openssl rand -hex 32)
BASE_URL=$(ask "URL công khai của dashboard nếu dùng subdomain (để trống nếu dùng SSH tunnel)" "$(existing BASE_URL)")

hr "Khóa API (tùy chọn ở đây)"
echo "Cloudflare, Claude, Pexels, Google, Telegram có thể nhập sau trên dashboard: Cài đặt → Khóa API và dịch vụ."
echo "Khóa nhập trên dashboard được ưu tiên hơn file này. Nhấn Enter để bỏ qua từng mục."
CLOUDFLARE_API_TOKEN=$(ask "Cloudflare API Token" "$(existing CLOUDFLARE_API_TOKEN)" secret)
CLOUDFLARE_ACCOUNT_ID=$(ask "Cloudflare Account ID" "$(existing CLOUDFLARE_ACCOUNT_ID)")

hr "aaPanel (server chứa website)"
PUBLIC_IP_DEFAULT=$(cred PUBLIC_IP)
[ -n "$PUBLIC_IP_DEFAULT" ] || PUBLIC_IP_DEFAULT=$(existing AAPANEL_SERVER_IP)
[ -n "$PUBLIC_IP_DEFAULT" ] || PUBLIC_IP_DEFAULT=$(curl -4 -s --max-time 8 https://api.ipify.org || hostname -I | awk '{print $1}')
AAPANEL_SERVER_IP=$(ask "IP public của server" "$PUBLIC_IP_DEFAULT")
AAPANEL_URL_DEFAULT=$(cred AAPANEL_URL)
[ -n "$AAPANEL_URL_DEFAULT" ] || AAPANEL_URL_DEFAULT=$(existing AAPANEL_URL)
if [ -z "$AAPANEL_URL_DEFAULT" ] && [ -f /www/server/panel/data/port.pl ]; then
  SCHEME=https; [ -f /www/server/panel/data/ssl.pl ] || SCHEME=http
  AAPANEL_URL_DEFAULT="${SCHEME}://127.0.0.1:$(cat /www/server/panel/data/port.pl)"
fi
AAPANEL_URL=$(ask "URL panel kèm cổng (không kèm đường dẫn bảo mật)" "$AAPANEL_URL_DEFAULT")
AAPANEL_API_KEY_DEFAULT=$(cred AAPANEL_API_KEY)
[ -n "$AAPANEL_API_KEY_DEFAULT" ] || AAPANEL_API_KEY_DEFAULT=$(existing AAPANEL_API_KEY)
AAPANEL_API_KEY=$(ask "aaPanel API key (Settings → API Interface)" "$AAPANEL_API_KEY_DEFAULT" secret)

hr "SSH tới server (để tải file website)"
ON_SAME_SERVER=n
if [ -d /www/server/panel ]; then ON_SAME_SERVER=$(ask "Dashboard chạy trên chính server aaPanel này? (y/n)" "y"); fi
if [ "$ON_SAME_SERVER" = "y" ] || [ "$ON_SAME_SERVER" = "Y" ]; then
  SSH_HOST=127.0.0.1
  SSH_PORT=$(grep -E '^\s*Port\s+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
  SSH_PORT=${SSH_PORT:-22}
  SSH_USER=root
  SSH_KEY_PATH="$APP_DIR/secrets/id_ed25519"
  if [ ! -f "$SSH_KEY_PATH" ]; then
    mkdir -p "$APP_DIR/secrets"
    ssh-keygen -t ed25519 -N "" -f "$SSH_KEY_PATH" -C "site-autopilot" >/dev/null
  fi
  mkdir -p /root/.ssh && chmod 700 /root/.ssh
  touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
  grep -q -F "$(cut -d' ' -f2 "$SSH_KEY_PATH.pub")" /root/.ssh/authorized_keys || cat "$SSH_KEY_PATH.pub" >> /root/.ssh/authorized_keys
  SSH_PASSWORD=""
  echo "Đã tạo khóa SSH nội bộ tại $SSH_KEY_PATH và cho phép đăng nhập root từ chính máy."
else
  SSH_HOST=$(ask "SSH host" "${AAPANEL_SERVER_IP}")
  SSH_PORT=$(ask "SSH port" "22")
  SSH_USER=$(ask "SSH user" "root")
  SSH_KEY_PATH=$(ask "Đường dẫn khóa private (để trống nếu dùng mật khẩu)" "$(existing SSH_KEY_PATH)")
  SSH_PASSWORD=""
  [ -n "$SSH_KEY_PATH" ] || SSH_PASSWORD=$(ask "Mật khẩu SSH" "$(existing SSH_PASSWORD)" secret)
fi

ANTHROPIC_API_KEY=$(ask "Anthropic API key" "$(existing ANTHROPIC_API_KEY)" secret)
ANTHROPIC_MODEL=$(ask "Model Claude" "$(existing ANTHROPIC_MODEL)")
ANTHROPIC_MODEL=${ANTHROPIC_MODEL:-claude-opus-5}
PEXELS_API_KEY=$(ask "Pexels API key" "$(existing PEXELS_API_KEY)" secret)
GOOGLE_SERVICE_ACCOUNT_JSON=$(ask "Đường dẫn file JSON service account Google" "$(existing GOOGLE_SERVICE_ACCOUNT_JSON)")
GOOGLE_OWNER_EMAIL=$(ask "Gmail của bạn để làm chủ sở hữu Search Console" "$(existing GOOGLE_OWNER_EMAIL)")
TELEGRAM_BOT_TOKEN=$(ask "Telegram bot token" "$(existing TELEGRAM_BOT_TOKEN)" secret)
TELEGRAM_CHAT_ID=$(ask "Telegram chat id" "$(existing TELEGRAM_CHAT_ID)")

[ -f "$ENV_FILE" ] && cp -f "$ENV_FILE" "$ENV_FILE.bak.$(date +%s)"
cat > "$ENV_FILE" <<EOF
# Sinh bởi deploy/configure.sh lúc $(date '+%Y-%m-%d %H:%M:%S')
PORT=3000
HOST=127.0.0.1
BASE_URL=$BASE_URL
DATA_DIR=./data
SESSION_SECRET=$SESSION_SECRET
ADMIN_USER=$ADMIN_USER
ADMIN_PASSWORD=$ADMIN_PASSWORD
MOCK_MODE=0
WORKER_CONCURRENCY=3
HEALTH_CHECK_INTERVAL_MIN=15
NS_POLL_INTERVAL_MIN=5

CLOUDFLARE_API_TOKEN=$CLOUDFLARE_API_TOKEN
CLOUDFLARE_ACCOUNT_ID=$CLOUDFLARE_ACCOUNT_ID

AAPANEL_URL=$AAPANEL_URL
AAPANEL_API_KEY=$AAPANEL_API_KEY
AAPANEL_SERVER_IP=$AAPANEL_SERVER_IP
AAPANEL_PHP_VERSION=00
WEB_ROOT=/www/wwwroot

SSH_HOST=$SSH_HOST
SSH_PORT=$SSH_PORT
SSH_USER=$SSH_USER
SSH_KEY_PATH=$SSH_KEY_PATH
SSH_PASSWORD=$SSH_PASSWORD

ANTHROPIC_API_KEY=$ANTHROPIC_API_KEY
ANTHROPIC_MODEL=$ANTHROPIC_MODEL
ANTHROPIC_EDITOR_MODEL=

PEXELS_API_KEY=$PEXELS_API_KEY

GOOGLE_SERVICE_ACCOUNT_JSON=$GOOGLE_SERVICE_ACCOUNT_JSON
GOOGLE_OWNER_EMAIL=$GOOGLE_OWNER_EMAIL

TELEGRAM_BOT_TOKEN=$TELEGRAM_BOT_TOKEN
TELEGRAM_CHAT_ID=$TELEGRAM_CHAT_ID
EOF
chmod 600 "$ENV_FILE"
echo
echo "Đã ghi $ENV_FILE"

if command -v pm2 >/dev/null 2>&1; then
  (cd "$APP_DIR" && pm2 restart site-autopilot >/dev/null 2>&1 && echo "Đã khởi động lại dashboard (pm2).") || echo "Dashboard chưa chạy bằng pm2. Khởi động: cd $APP_DIR && pm2 start deploy/ecosystem.config.cjs && pm2 save"
fi

cat <<EOF

Mở dashboard bằng SSH tunnel từ máy Windows (PowerShell):
   ssh -L 3000:127.0.0.1:3000 -p $SSH_PORT root@$AAPANEL_SERVER_IP
rồi mở trình duyệt: http://localhost:3000  (đăng nhập $ADMIN_USER)

Kiểm tra kết nối ngay trên server:
   cd $APP_DIR && npm run cli -- test
EOF
