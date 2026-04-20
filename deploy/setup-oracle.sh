#!/usr/bin/env bash
# Oracle Ubuntu 24.04 ARM — ResumeXray setup
set -euo pipefail

echo "==========================================================="
echo " Starting ResumeXray Oracle Setup (Ubuntu ARM64)"
echo "==========================================================="

# Update package lists
sudo apt-get update
sudo DEBIAN_FRONTEND=noninteractive apt-get upgrade -y

# 1. Install Node.js 22 LTS (via NodeSource)
echo "-----------------------------------------------------------"
echo " Installing Node.js..."
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# 2. Build tools for native modules (better-sqlite3, bcrypt, sharp)
echo "-----------------------------------------------------------"
echo " Installing build tools..."
sudo apt-get install -y python3 make g++ git curl build-essential

# 3. Playwright system dependencies (Ubuntu path, NOT Alpine)
echo "-----------------------------------------------------------"
echo " Installing Playwright dependencies..."
# We install playwright temporarily just to get it to download system deps
sudo -E npx -y playwright@1.49.1 install-deps chromium
# Install the browser natively globally
sudo -E npx -y playwright@1.49.1 install chromium

# 4. Global process manager
echo "-----------------------------------------------------------"
echo " Installing PM2..."
sudo npm install -g pm2

# 5. Caddy (Reverse Proxy for Automatic HTTPS)
echo "-----------------------------------------------------------"
echo " Installing Caddy Server..."
# Install Caddy official repo securely
sudo apt-get install -y debian-keyring debian-archive-keyring apt-transport-https
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | sudo gpg --yes --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | sudo tee /etc/apt/sources.list.d/caddy-stable.list
sudo apt-get update
sudo apt-get install -y caddy

echo "==========================================================="
echo " Setup complete! Next steps:"
echo " 1. Clone your repo: git clone https://github.com/ghasmir/ResumeXray.git"
echo " 2. cd ResumeXray && npm install"
echo " 3. Copy your .env file into the folder"
echo " 4. Run: pm2 start ecosystem.config.js"
echo " 5. Start caddy: sudo systemctl restart caddy"
echo "==========================================================="
