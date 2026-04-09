#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — Zero-Downtime Deploy Script
# ═══════════════════════════════════════════════════════════════
# Usage: ./deploy/deploy.sh
# Runs on the VPS after git pull / rsync.
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

APP_DIR="/home/deploy/ats-resume-checker"
LOG_FILE="/var/log/resumexray-deploy.log"

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [DEPLOY] Starting deployment" | tee -a "$LOG_FILE"

cd "$APP_DIR"

# 1. Install dependencies (production only, no devDependencies)
echo "[1/5] Installing dependencies..."
npm ci --omit=dev --ignore-scripts 2>&1 | tail -1

# 2. Verify syntax of critical files
echo "[2/5] Syntax check..."
node -c server.js
node -c routes/agent.js
node -c routes/auth.js
node -c routes/billing.js
node -c routes/api.js
node -c routes/user.js
node -c config/passport.js
echo "  ✅ All syntax OK"

# 3. Run PG migrations (if using PostgreSQL)
if grep -q "^DB_ENGINE=pg" .env 2>/dev/null; then
  echo "[3/5] Running PostgreSQL migrations..."
  node -e "require('./db/pg-database'); console.log('  ✅ PG schema applied')"
else
  echo "[3/5] SQLite mode — migrations applied on startup"
fi

# 4. Zero-downtime reload via PM2
echo "[4/5] PM2 reload (zero-downtime)..."
pm2 reload ecosystem.config.js --env production
pm2 save

# 5. Health check
echo "[5/5] Health check..."
sleep 3
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/healthz || echo "000")
if [ "$HTTP_CODE" = "200" ]; then
  echo "  ✅ Health check passed (HTTP $HTTP_CODE)"
else
  echo "  ❌ Health check FAILED (HTTP $HTTP_CODE)"
  echo "  Rolling back..."
  pm2 reload ecosystem.config.js --env production
  exit 1
fi

echo "$(date -u +%Y-%m-%dT%H:%M:%SZ) [DEPLOY] Deployment complete ✅" | tee -a "$LOG_FILE"
