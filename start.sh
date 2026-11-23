#!/usr/bin/env bash
# Start RestoPOS.   ./start.sh            -> default restaurant (data/)
#                   ./start.sh sharma     -> client folder clients/sharma
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 18 or newer is required: https://nodejs.org"; exit 1; }
if [ -n "$1" ]; then exec node server.js --client "$1"; else exec node server.js; fi
