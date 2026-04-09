#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — tmpfs RAM-backed Upload Directory
# ═══════════════════════════════════════════════════════════════
# Usage: sudo bash deploy/tmpfs-uploads.sh
# Run once after initial server provisioning.
#
# Why: Resume uploads are transient (parsed immediately, then discarded).
# Storing them in RAM:
#   1. Prevents resume data from persisting on disk (privacy)
#   2. Faster I/O for parse operations
#   3. noexec/nosuid prevents uploaded file execution
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

UPLOAD_DIR="/home/deploy/ats-resume-checker/tmp_uploads"
MOUNT_SIZE="500M"

# Create mount point
mkdir -p "$UPLOAD_DIR"

# Check if already mounted
if mountpoint -q "$UPLOAD_DIR" 2>/dev/null; then
  echo "✅ tmpfs already mounted at $UPLOAD_DIR"
  df -h "$UPLOAD_DIR"
  exit 0
fi

# Mount tmpfs
mount -t tmpfs -o size="$MOUNT_SIZE",noexec,nosuid,nodev,uid=1000,gid=1000 tmpfs "$UPLOAD_DIR"

# Make persistent across reboots
if ! grep -q "tmp_uploads" /etc/fstab; then
  echo "tmpfs $UPLOAD_DIR tmpfs size=$MOUNT_SIZE,noexec,nosuid,nodev,uid=1000,gid=1000 0 0" >> /etc/fstab
fi

echo "✅ tmpfs mounted:"
df -h "$UPLOAD_DIR"
echo ""
echo "Options: size=$MOUNT_SIZE, noexec, nosuid, nodev"
echo "Persisted to /etc/fstab"
