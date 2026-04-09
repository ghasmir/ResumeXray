#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — 2GB Swap Setup (Hostinger KVS 2 VPS)
# ═══════════════════════════════════════════════════════════════
# Usage: sudo bash deploy/swap-setup.sh
# Run once after initial server provisioning.
#
# Why: 8GB RAM is tight with 2 PM2 workers (750MB each) + Caddy + PG.
# 2GB swap provides a safety net without impacting normal performance.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SWAPFILE="/swapfile"
SWAP_SIZE="2G"

if [ -f "$SWAPFILE" ]; then
  echo "Swap file already exists:"
  swapon --show
  exit 0
fi

echo "🔧 Creating ${SWAP_SIZE} swap file..."

# Create swap file
fallocate -l "$SWAP_SIZE" "$SWAPFILE"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

# Make persistent
echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab

# Tune swappiness (low = prefer RAM, only swap under pressure)
sysctl vm.swappiness=10
echo "vm.swappiness=10" >> /etc/sysctl.conf

# Tune vfs_cache_pressure (keep inode/dentry caches longer)
sysctl vm.vfs_cache_pressure=50
echo "vm.vfs_cache_pressure=50" >> /etc/sysctl.conf

echo ""
echo "✅ Swap configured:"
swapon --show
echo ""
echo "Swappiness: $(cat /proc/sys/vm/swappiness)"
echo "VFS cache pressure: $(cat /proc/sys/vm/vfs_cache_pressure)"
