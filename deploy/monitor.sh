#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — Uptime Monitor
# ═══════════════════════════════════════════════════════════════
# Lightweight health check script for cron-based monitoring.
# Run every 5 minutes: */5 * * * * /opt/resumexray/deploy/monitor.sh
#
# Checks /healthz, /readyz, and response time.
# Logs failures and optionally sends webhook notifications.
# ═══════════════════════════════════════════════════════════════

set -uo pipefail

APP_URL="${APP_URL:-http://localhost:3000}"
WEBHOOK_URL="${MONITOR_WEBHOOK_URL:-}"  # Slack/Discord webhook (optional)
LOG_FILE="/var/log/resumexray-monitor.log"
MAX_RESPONSE_MS=5000

log() {
  echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) $1" | tee -a "$LOG_FILE" 2>/dev/null
}

alert() {
  log "🔴 ALERT: $1"
  if [ -n "$WEBHOOK_URL" ]; then
    curl -sf -X POST "$WEBHOOK_URL" \
      -H 'Content-Type: application/json' \
      -d "{\"text\":\"🔴 ResumeXray Alert: $1\"}" \
      > /dev/null 2>&1 || true
  fi
}

# ── /healthz check ─────────────────────────────────────────────
HEALTHZ_START=$(date +%s%N)
HEALTHZ=$(curl -sf --max-time 10 "${APP_URL}/healthz" 2>/dev/null)
HEALTHZ_END=$(date +%s%N)
HEALTHZ_MS=$(( (HEALTHZ_END - HEALTHZ_START) / 1000000 ))

if [ "$HEALTHZ" != "ok" ]; then
  alert "/healthz FAILED (response: '${HEALTHZ:-empty}', ${HEALTHZ_MS}ms)"
  exit 1
fi

# ── /readyz check ──────────────────────────────────────────────
READYZ=$(curl -sf --max-time 10 "${APP_URL}/readyz" 2>/dev/null)
READY=$(echo "$READYZ" | grep -o '"ready":true' || echo "")

if [ -z "$READY" ]; then
  alert "/readyz NOT READY (response: '${READYZ:-empty}')"
  exit 1
fi

# ── Response time check ────────────────────────────────────────
if [ "$HEALTHZ_MS" -gt "$MAX_RESPONSE_MS" ]; then
  alert "Slow response: /healthz took ${HEALTHZ_MS}ms (threshold: ${MAX_RESPONSE_MS}ms)"
fi

log "✅ OK (${HEALTHZ_MS}ms)"
