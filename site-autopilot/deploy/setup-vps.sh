#!/usr/bin/env bash
# =============================================================================
#  Site Autopilot - Chuẩn bị VPS Ubuntu MỚI TOANH (chạy một lần, bằng root)
#
#  Việc script làm:
#   1. Cập nhật hệ thống, cài công cụ cơ bản, múi giờ Việt Nam, đồng bộ giờ
#   2. Tạo swap 2 GB nếu chưa có (VPS ít RAM sẽ ổn định hơn)
#   3. fail2ban chống dò mật khẩu SSH, tự cập nhật bản vá bảo mật
#   4. Cài aaPanel không cần trả lời câu hỏi, cài Nginx
#   5. Bật API của aaPanel, tạo API key, whitelist 127.0.0.1 và IP của VPS
#   6. Tường lửa UFW chỉ mở SSH, 80, 443 và cổng panel
#   7. Ghi toàn bộ thông tin đăng nhập vào /root/site-autopilot-credentials.txt
#
#  Cách chạy:   bash setup-vps.sh
#  Tùy chọn:    PANEL_PORT=31750 NGINX_VERSION=1.26 bash setup-vps.sh
# =============================================================================
set -euo pipefail

PANEL_USER="${PANEL_USER:-autopilot}"
PANEL_PORT="${PANEL_PORT:-$(( (RANDOM % 40000) + 20000 ))}"
NGINX_VERSION="${NGINX_VERSION:-1.26}"
TIMEZONE="${TIMEZONE:-Asia/Ho_Chi_Minh}"
CRED_FILE=/root/site-autopilot-credentials.txt
LOG_FILE=/root/setup-vps.log

exec > >(tee -a "$LOG_FILE") 2>&1

log() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\n\033[1;33m!!  %s\033[0m\n' "$*"; }

[ "$(id -u)" -eq 0 ] || { echo "Hãy chạy bằng root: sudo bash setup-vps.sh"; exit 1; }
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ]; then
  warn "Script viết cho Ubuntu, bạn đang dùng ${PRETTY_NAME:-không rõ}. Tiếp tục nhưng có thể gặp khác biệt."
fi
export DEBIAN_FRONTEND=noninteractive
# Ubuntu 22.04+ có needrestart hỏi "restart services?" giữa chừng; đặt tự động để script không dừng
export NEEDRESTART_MODE=a
export NEEDRESTART_SUSPEND=1
START_TS=$(date +%s)

# -----------------------------------------------------------------------------
log "1/7 Cập nhật hệ thống và cài công cụ cơ bản"
apt-get update -y
apt-get -o Dpkg::Options::="--force-confold" upgrade -y
apt-get install -y curl wget git unzip tar rsync ufw fail2ban unattended-upgrades htop ca-certificates gnupg lsb-release openssl python3

timedatectl set-timezone "$TIMEZONE" || true
timedatectl set-ntp true || true
echo "Múi giờ: $(timedatectl show -p Timezone --value 2>/dev/null || echo "$TIMEZONE")"

# -----------------------------------------------------------------------------
log "2/7 Swap"
if swapon --show 2>/dev/null | grep -q .; then
  echo "Đã có swap, bỏ qua."
else
  RAM_MB=$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)
  if [ "$RAM_MB" -lt 8192 ]; then
    SWAP_MB=2048
    if ! fallocate -l "${SWAP_MB}M" /swapfile 2>/dev/null; then
      dd if=/dev/zero of=/swapfile bs=1M count="$SWAP_MB" status=none
    fi
    chmod 600 /swapfile
    mkswap /swapfile >/dev/null
    swapon /swapfile
    grep -q '^/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' >> /etc/fstab
    echo 'vm.swappiness=10' > /etc/sysctl.d/99-site-autopilot.conf
    sysctl -q -p /etc/sysctl.d/99-site-autopilot.conf || true
    echo "Đã tạo swap ${SWAP_MB} MB (RAM ${RAM_MB} MB)."
  else
    echo "RAM ${RAM_MB} MB, không cần swap."
  fi
fi

# -----------------------------------------------------------------------------
log "3/7 fail2ban và tự cập nhật bảo mật"
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 1h
findtime = 10m
maxretry = 5
backend  = systemd

[sshd]
enabled = true
EOF
systemctl enable --now fail2ban >/dev/null 2>&1 || warn "fail2ban chưa khởi động được, kiểm tra: systemctl status fail2ban"

cat > /etc/apt/apt.conf.d/20auto-upgrades <<'EOF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
EOF

# -----------------------------------------------------------------------------
log "4/7 aaPanel"
PANEL_PASS=""
SAFE_PATH=""
if [ -d /www/server/panel ] && [ -f /www/server/panel/data/port.pl ]; then
  echo "aaPanel đã được cài trước đó, giữ nguyên."
  PANEL_PORT=$(cat /www/server/panel/data/port.pl)
  SAFE_PATH=$(cat /www/server/panel/data/admin_path.pl 2>/dev/null | sed 's|^/||')
else
  PANEL_PASS=$(openssl rand -hex 10)
  SAFE_PATH=$(openssl rand -hex 4)
  cd /root
  URL=https://www.aapanel.com/script/install_panel_en.sh
  curl -ksSO "$URL" || wget --no-check-certificate -O install_panel_en.sh "$URL"
  echo "Cài aaPanel (khoảng 2 đến 5 phút)..."
  bash install_panel_en.sh -y -u "$PANEL_USER" -p "$PANEL_PASS" -P "$PANEL_PORT" --safe-path "$SAFE_PATH"
  PANEL_PORT=$(cat /www/server/panel/data/port.pl 2>/dev/null || echo "$PANEL_PORT")
  SAFE_PATH=$(cat /www/server/panel/data/admin_path.pl 2>/dev/null | sed 's|^/||' || echo "$SAFE_PATH")
fi
PANEL_SCHEME=https
[ -f /www/server/panel/data/ssl.pl ] || PANEL_SCHEME=http

# -----------------------------------------------------------------------------
log "5/7 Nginx qua aaPanel"
if [ -x /www/server/nginx/sbin/nginx ]; then
  echo "Nginx đã có, bỏ qua."
else
  mkdir -p /www/server/panel/install
  cd /www/server/panel/install
  [ -f install_soft.sh ] || curl -ksSO https://node.aapanel.com/install/install_soft.sh
  # Kiểu 1 = gói đóng sẵn (vài phút). Nếu hệ điều hành không có gói sẵn thì kiểu 0 = biên dịch (10 đến 20 phút).
  echo "Thử cài gói Nginx ${NGINX_VERSION} đóng sẵn..."
  if ! bash install_soft.sh 1 install nginx "$NGINX_VERSION" || [ ! -x /www/server/nginx/sbin/nginx ]; then
    warn "Không có gói đóng sẵn, chuyển sang biên dịch từ mã nguồn (10 đến 20 phút)."
    if ! bash install_soft.sh 0 install nginx "$NGINX_VERSION" || [ ! -x /www/server/nginx/sbin/nginx ]; then
      warn "Cài Nginx tự động thất bại. Hãy đăng nhập panel → App Store → Nginx → Install, rồi chạy lại script này."
    fi
  fi
fi
[ -x /www/server/nginx/sbin/nginx ] && /www/server/nginx/sbin/nginx -v 2>&1 | head -1 || true

# -----------------------------------------------------------------------------
log "6/7 Bật API aaPanel và whitelist IP"
PUBLIC_IP=$(curl -4 -s --max-time 10 https://api.ipify.org || curl -4 -s --max-time 10 https://ifconfig.me || hostname -I | awk '{print $1}')
PUBLIC_IP=${PUBLIC_IP:-$(hostname -I | awk '{print $1}')}
echo "IP public: $PUBLIC_IP"

PANEL_PY=/www/server/panel/pyenv/bin/python3
[ -x "$PANEL_PY" ] || PANEL_PY=python3
API_KEY=""
if [ -d /www/server/panel/class ]; then
  API_KEY=$(cd /www/server/panel && "$PANEL_PY" - "$PUBLIC_IP" <<'PY' 2>/dev/null || true
import os, sys, json
os.chdir('/www/server/panel')
sys.path.insert(0, '/www/server/panel')
sys.path.insert(0, '/www/server/panel/class')
ip = sys.argv[1]
try:
    import public, panelApi
    api = panelApi.panelApi()
    data = api.get_api_config()
    token = public.GetRandomString(32)
    data['open'] = True
    data['token'] = public.md5(token)
    crypt = public.en_crypt(data['token'], token)
    data['token_crypt'] = crypt.decode('utf-8') if isinstance(crypt, bytes) else crypt
    data['limit_addr'] = ['127.0.0.1', ip]
    api.save_api_config(data)
    print(token)
except Exception as e:
    sys.stderr.write('panel python route failed: %s\n' % e)
    sys.exit(1)
PY
)
fi
if [ -z "$API_KEY" ]; then
  warn "Không bật được API bằng module của panel, dùng cách ghi file trực tiếp."
  API_KEY=$(openssl rand -hex 16)
  TOKEN_MD5=$(printf '%s' "$API_KEY" | md5sum | awk '{print $1}')
  mkdir -p /www/server/panel/config
  cp -f /www/server/panel/config/api.json /www/server/panel/config/api.json.bak 2>/dev/null || true
  printf '{"open": true, "token": "%s", "limit_addr": ["127.0.0.1", "%s"], "binds": [], "apps": []}\n' "$TOKEN_MD5" "$PUBLIC_IP" > /www/server/panel/config/api.json
  chmod 600 /www/server/panel/config/api.json
  warn "Lưu ý: nếu sau này bạn mở Settings → API trong panel, panel có thể tạo key mới. Khi đó cập nhật lại AAPANEL_API_KEY trong .env."
fi
bt restart >/dev/null 2>&1 || bt 1 >/dev/null 2>&1 || true

# -----------------------------------------------------------------------------
log "7/7 Tường lửa UFW"
SSH_PORT=$(grep -E '^\s*Port\s+[0-9]+' /etc/ssh/sshd_config 2>/dev/null | awk '{print $2}' | head -1)
SSH_PORT=${SSH_PORT:-22}
ufw --force reset >/dev/null
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" comment 'SSH' >/dev/null
ufw allow 80/tcp comment 'HTTP' >/dev/null
ufw allow 443/tcp comment 'HTTPS' >/dev/null
ufw allow "${PANEL_PORT}/tcp" comment 'aaPanel' >/dev/null
ufw --force enable >/dev/null
ufw status | sed 's/^/   /'

# -----------------------------------------------------------------------------
PANEL_URL="${PANEL_SCHEME}://${PUBLIC_IP}:${PANEL_PORT}/${SAFE_PATH}"
{
  echo "# Site Autopilot - thông tin VPS (tạo lúc $(date '+%Y-%m-%d %H:%M:%S'))"
  echo "# GIỮ KÍN FILE NÀY. Xem lại bằng: cat $CRED_FILE"
  echo "PUBLIC_IP=$PUBLIC_IP"
  echo "SSH_PORT=$SSH_PORT"
  echo "AAPANEL_URL=${PANEL_SCHEME}://${PUBLIC_IP}:${PANEL_PORT}"
  echo "AAPANEL_LOGIN_URL=$PANEL_URL"
  echo "AAPANEL_USER=$PANEL_USER"
  if [ -n "$PANEL_PASS" ]; then echo "AAPANEL_PASSWORD=$PANEL_PASS"; else echo "AAPANEL_PASSWORD=(đã cài trước, xem bằng: bt default)"; fi
  echo "AAPANEL_API_KEY=$API_KEY"
  echo "AAPANEL_API_WHITELIST=127.0.0.1,$PUBLIC_IP"
} > "$CRED_FILE"
chmod 600 "$CRED_FILE"

ELAPSED=$(( $(date +%s) - START_TS ))
printf '\n\033[1;32m================= XONG sau %d phút =================\033[0m\n' $(( ELAPSED / 60 ))
echo "aaPanel:      $PANEL_URL"
echo "Tài khoản:    $PANEL_USER"
if [ -n "$PANEL_PASS" ]; then echo "Mật khẩu:     $PANEL_PASS"; fi
echo "API key:      $API_KEY"
echo "Đã lưu tại:   $CRED_FILE"
echo
echo "Bước tiếp theo: cài Site Autopilot"
echo "   cd /root/site-autopilot && bash deploy/install.sh && bash deploy/configure.sh"
echo
if [ -f /var/run/reboot-required ]; then
  read -r -p "Hệ thống cần khởi động lại để áp dụng cập nhật. Khởi động lại ngay? [y/N] " ANSWER || ANSWER=""
  case "${ANSWER:-N}" in
    y|Y) echo "Đang khởi động lại, đăng nhập lại sau khoảng 1 phút."; sleep 2; reboot ;;
    *) echo "Nhớ chạy 'reboot' khi thuận tiện." ;;
  esac
fi
