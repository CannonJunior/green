#!/usr/bin/env bash
# Green install script
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing Node dependencies"
npm install

echo ""
echo "==> Config"
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    Created .env — add your ANTHROPIC_API_KEY before starting"
else
  echo "    .env already exists"
fi

echo ""
echo "================================================================"
echo " Signal setup (one-time — skip if signal-cli is already running)"
echo "================================================================"
echo ""
echo "1. Install signal-cli (requires Java 21+):"
echo ""
echo "   # Arch / Manjaro"
echo "   sudo pacman -S signal-cli"
echo ""
echo "   # Debian / Ubuntu"
echo "   sudo apt install signal-cli"
echo ""
echo "   # Or download the latest release directly:"
echo "   https://github.com/AsamK/signal-cli/releases/latest"
echo ""
echo "2. Register Green as a linked device on your existing Signal account"
echo "   (this keeps your phone number — Green appears as a secondary device):"
echo ""
echo "   signal-cli link -n \"Green\""
echo ""
echo "   Scan the printed URI as a QR code in:"
echo "     Signal app > Settings > Linked Devices > Link New Device"
echo ""
echo "   Note the account number printed after linking — you'll need it below."
echo ""
echo "3. Start the signal-cli daemon (add to systemd to auto-start on boot):"
echo ""
echo "   signal-cli -a +1XXXXXXXXXX daemon --tcp 127.0.0.1:7583"
echo ""
echo "   Replace +1XXXXXXXXXX with the account number from step 2."
echo ""
echo "4. Edit config.yml:"
echo "   - Set signal.approved_numbers to your personal phone number"
echo "     (the number you text Green from, in E.164 format: +15555550100)"
echo ""
echo "5. Create a systemd service for the Green daemon:"
echo ""
cat <<'SERVICE'
   # /etc/systemd/system/green.service
   [Unit]
   Description=Green AI assistant daemon
   After=network.target

   [Service]
   Type=simple
   User=junior
   WorkingDirectory=/home/junior/src/green
   EnvironmentFile=/home/junior/src/green/.env
   ExecStart=/usr/bin/node dist/index.js --channel signal
   Restart=on-failure
   RestartSec=5

   [Install]
   WantedBy=multi-user.target
SERVICE
echo ""
echo "   sudo systemctl daemon-reload"
echo "   sudo systemctl enable --now green"
echo ""
echo "================================================================"
echo " Quick local test (no Signal required)"
echo "================================================================"
echo ""
echo "   npm run dev:local"
echo ""
echo "   Then type a message, e.g.:"
echo "   > why is the config loader in green structured the way it is?"
echo ""
