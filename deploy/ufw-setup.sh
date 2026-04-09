#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — UFW Firewall Setup (Hostinger KVS 2 VPS)
# ═══════════════════════════════════════════════════════════════
# Usage: sudo bash deploy/ufw-setup.sh
# Run once after initial server provisioning.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

echo "🔧 Setting up UFW firewall..."

# Reset (if previously configured)
ufw --force reset

# Default policies: deny all incoming, allow all outgoing
ufw default deny incoming
ufw default allow outgoing

# SSH (rate-limited — blocks IPs with >6 attempts in 30s)
ufw limit 22/tcp comment 'SSH with rate limiting'

# HTTP/HTTPS (Caddy serves on these, proxies to Node on 3000)
ufw allow 80/tcp comment 'HTTP (Caddy redirect)'
ufw allow 443/tcp comment 'HTTPS (Caddy TLS)'

# Node.js app — only accessible from localhost (Caddy proxy)
# Port 3000 is NOT exposed to the internet.

# Enable
ufw --force enable

echo ""
echo "✅ UFW configured:"
ufw status verbose

echo ""
echo "⚠️  Node.js port 3000 is NOT exposed — only Caddy (80/443) is public."
echo "⚠️  SSH is rate-limited (6 attempts/30s)."
