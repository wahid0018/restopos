#!/usr/bin/env bash
# RestoPOS installer for Linux (systemd) — run:  sudo ./install.sh [client-name] [port]
set -e
[ "$(id -u)" = 0 ] || { echo "Run with sudo"; exit 1; }
CLIENT="$1"; PORT="${2:-3000}"; DIR=/opt/restopos
NODE="$(command -v node || true)"; [ -n "$NODE" ] || { echo "Install Node.js 18+ first (https://nodejs.org)"; exit 1; }
SRC="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DIR"; (cd "$SRC" && tar cf - --exclude=./data --exclude=./clients --exclude=./.git .) | tar xf - -C "$DIR"
mkdir -p "$DIR/data"; [ -n "$CLIENT" ] && mkdir -p "$DIR/clients/$CLIENT"
ARGS="server.js --port $PORT"; [ -n "$CLIENT" ] && ARGS="$ARGS --client $CLIENT"
cat > /etc/systemd/system/restopos.service <<UNIT
[Unit]
Description=RestoPOS restaurant server
After=network-online.target
[Service]
WorkingDirectory=$DIR
ExecStart=$NODE $ARGS
Restart=always
RestartSec=3
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload; systemctl enable --now restopos
command -v ufw >/dev/null && ufw allow "$PORT"/tcp >/dev/null 2>&1 || true
echo "Installed in $DIR and running. Open http://$(hostname -I | awk '{print $1}'):$PORT on tablets."
echo "Remove with: sudo systemctl disable --now restopos && sudo rm -rf /etc/systemd/system/restopos.service $DIR"
