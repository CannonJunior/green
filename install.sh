#!/usr/bin/env bash
# Green install script
# Sets up dependencies, copies config, and symlinks the workspace into OpenClaw.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "==> Installing Node dependencies"
npm install

echo "==> Copying config (if not already present)"
if [[ ! -f config.yml ]]; then
  echo "    config.yml already exists — skipping"
fi
if [[ ! -f .env ]]; then
  cp .env.example .env
  echo "    Created .env — add your ANTHROPIC_API_KEY before starting"
fi

echo ""
echo "==> OpenClaw workspace symlink"
OPENCLAW_WORKSPACE="${HOME}/.openclaw/workspace"
if [[ -d "$OPENCLAW_WORKSPACE" ]]; then
  echo "    OpenClaw workspace exists at $OPENCLAW_WORKSPACE"
  echo "    Skipping symlink — manually copy or merge workspace/ into it if needed."
else
  echo "    OpenClaw not yet installed at $OPENCLAW_WORKSPACE"
  echo "    After installing OpenClaw, run:"
  echo "      ln -sf $SCRIPT_DIR/workspace $OPENCLAW_WORKSPACE"
fi

echo ""
echo "==> Done."
echo ""
echo "Next steps:"
echo ""
echo "  1. Add your ANTHROPIC_API_KEY to .env"
echo ""
echo "  2. Test locally (no iMessage required):"
echo "       npm run dev:local"
echo ""
echo "  3. To connect iMessage:"
echo "       a. Install BlueBubbles Server on a Mac with your Apple ID:"
echo "            https://bluebubbles.app"
echo "       b. Install OpenClaw on this Linux machine:"
echo "            curl -fsSL https://openclaw.sh | bash"
echo "            openclaw onboard"
echo "       c. In OpenClaw settings, enable only the BlueBubbles channel."
echo "          Point it at your BlueBubbles server URL and API key."
echo "       d. Add your phone number to config.yml under imessage.approved_numbers"
echo "       e. Symlink the workspace:"
echo "            ln -sf $SCRIPT_DIR/workspace ~/.openclaw/workspace"
echo "       f. Start Green:"
echo "            npm run dev"
echo ""
echo "  4. Send yourself an iMessage: 'hey green, what projects do you know about?'"
