#!/bin/bash
# §12.5: Swap configuration for Hostinger KVM VPS
# Creates 2GB swapfile with swappiness=10
# Usage: sudo bash infra/swap.sh
set -euo pipefail

SWAPFILE=/swapfile
SWAP_SIZE=2G

echo "=== Configuring swap ==="

if [ -f "$SWAPFILE" ]; then
    echo "Swap file already exists, removing..."
    swapoff "$SWAPFILE" 2>/dev/null || true
    rm -f "$SWAPFILE"
fi

# Create swap file
fallocate -l "$SWAP_SIZE" "$SWAPFILE"
chmod 600 "$SWAPFILE"
mkswap "$SWAPFILE"
swapon "$SWAPFILE"

# Persist across reboots
grep -q "$SWAPFILE" /etc/fstab || echo "$SWAPFILE none swap sw 0 0" >> /etc/fstab

# Low swappiness — prefer RAM, use swap only under pressure
sysctl vm.swappiness=10
grep -q "vm.swappiness" /etc/sysctl.conf || echo "vm.swappiness=10" >> /etc/sysctl.conf

echo "=== Swap configured ==="
free -h
