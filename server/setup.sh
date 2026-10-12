#!/usr/bin/env bash
# Разворачивает сервер синхронизации на чистой Ubuntu/Debian. Запускать от root в консоли VPS:
#   curl -fsSL https://raw.githubusercontent.com/Chichetin/conspects-online/main/server/setup.sh | bash
# Повторный запуск безопасен: обновит сервис и конфиги.
#
# Ставит: сервис sync_server.py (systemd, без своих зависимостей) за Caddy с HTTPS
# на <ip-через-дефисы>.sslip.io, файрвол ufw (22, 80, 443), вход по SSH только по ключу.
# Свой домен: DOMAIN=sync.example.ru bash setup.sh
set -euo pipefail

RAW=https://raw.githubusercontent.com/Chichetin/conspects-online/main/server
SSH_KEY="ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIEQ6QeWbCIrCp5r2x5YWtp9lKqjpE/TaY0MYzCQXAEb6 chichetin@chichetin"

[ "$(id -u)" = 0 ] || { echo "Нужно запускать от root"; exit 1; }
IP=$(ip -4 route get 1.1.1.1 | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}')
DOMAIN=${DOMAIN:-${IP//./-}.sslip.io}
step() { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }

step "Пакеты"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
apt-get install -y -q python3 ufw curl
if ! apt-get install -y -q caddy; then
  # в старых релизах Caddy нет в стандартных репозиториях — берём официальный
  apt-get install -y -q debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor --yes -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -fsSL https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -q && apt-get install -y -q caddy
fi

step "Сервис синхронизации"
install -d /opt/conspects-sync
curl -fsSL "$RAW/sync_server.py" -o /opt/conspects-sync/sync_server.py
cat > /etc/systemd/system/conspects-sync.service <<'EOF'
[Unit]
Description=conspects-online: синхронизация прогресса чтения
After=network.target

[Service]
ExecStart=/usr/bin/python3 /opt/conspects-sync/sync_server.py
Environment=SYNC_DIR=/var/lib/conspects-sync SYNC_PORT=8787
DynamicUser=yes
StateDirectory=conspects-sync
Restart=on-failure
NoNewPrivileges=yes
ProtectSystem=strict
ProtectHome=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable conspects-sync
systemctl restart conspects-sync

step "Caddy: https://$DOMAIN"
[ -f /etc/caddy/Caddyfile.orig ] || cp /etc/caddy/Caddyfile /etc/caddy/Caddyfile.orig 2>/dev/null || true
cat > /etc/caddy/Caddyfile <<EOF
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:8787
}
EOF
systemctl enable caddy
systemctl reload caddy || systemctl restart caddy

step "SSH: только по ключу"
install -d -m 700 /root/.ssh
touch /root/.ssh/authorized_keys && chmod 600 /root/.ssh/authorized_keys
grep -qF "$SSH_KEY" /root/.ssh/authorized_keys || echo "$SSH_KEY" >> /root/.ssh/authorized_keys
# 10- раньше 50-cloud-init.conf, а sshd берёт первое найденное значение
printf 'PasswordAuthentication no\nKbdInteractiveAuthentication no\nPermitRootLogin prohibit-password\n' \
  > /etc/ssh/sshd_config.d/10-keys-only.conf
sshd -t && systemctl restart ssh

step "Файрвол"
ufw allow OpenSSH >/dev/null
ufw allow 80/tcp >/dev/null
ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null
ufw status | sed -n '1,12p'

step "Проверка (сертификат может выпускаться до минуты)"
curl -fsS http://127.0.0.1:8787/health && echo " ← сервис"
for _ in $(seq 30); do
  if curl -fsS --max-time 5 "https://$DOMAIN/health" >/dev/null 2>&1; then
    printf '\n\033[1;32mГотово: https://%s/sync\033[0m\n' "$DOMAIN"
    exit 0
  fi
  sleep 3
done
printf '\n\033[1;31mHTTPS не поднялся. Последние строки журнала Caddy:\033[0m\n'
journalctl -u caddy --no-pager -n 25
exit 1
