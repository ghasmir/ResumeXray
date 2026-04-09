#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — SRI Hash Generator
# ═══════════════════════════════════════════════════════════════
# Generates Subresource Integrity (SRI) hashes for static assets.
# Run after CSS/JS changes, paste into index.html.
#
# Usage: bash deploy/generate-sri.sh
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

echo "═══════════════════════════════════════════════"
echo "  SRI Hash Generator for ResumeXray"
echo "═══════════════════════════════════════════════"
echo ""

for file in "$PROJECT_DIR"/public/css/*.css "$PROJECT_DIR"/public/js/*.js; do
  if [ -f "$file" ]; then
    hash=$(openssl dgst -sha384 -binary "$file" | openssl base64 -A)
    basename=$(basename "$file")
    echo "$basename → sha384-$hash"
  fi
done

echo ""
echo "Add to <link>/<script> tags as: integrity=\"sha384-xxx\" crossorigin=\"anonymous\""
