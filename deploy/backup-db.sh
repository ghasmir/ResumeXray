#!/bin/bash
# ═══════════════════════════════════════════════════════════════
# ResumeXray — Database Backup Script
# ═══════════════════════════════════════════════════════════════
# Backs up both SQLite and PostgreSQL databases.
# Run daily via cron: 0 2 * * * /opt/resumexray/deploy/backup-db.sh
#
# Retention: 14 days (configurable)
# ═══════════════════════════════════════════════════════════════

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
BACKUP_DIR="${PROJECT_DIR}/backups"
RETENTION_DAYS=14
DATE=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

echo "═══ ResumeXray Backup — $DATE ═══"

# ── SQLite Backup ──────────────────────────────────────────────
SQLITE_DB="${PROJECT_DIR}/db/resumexray.db"
if [ -f "$SQLITE_DB" ]; then
  BACKUP_FILE="${BACKUP_DIR}/sqlite_${DATE}.db.gz"
  # Use SQLite's .backup for consistent snapshot (handles WAL mode)
  sqlite3 "$SQLITE_DB" ".backup '${BACKUP_DIR}/sqlite_${DATE}.db'"
  gzip "${BACKUP_DIR}/sqlite_${DATE}.db"
  echo "  SQLite: $BACKUP_FILE ($(du -h "$BACKUP_FILE" | cut -f1))"
else
  echo "  SQLite: no database found (skipped)"
fi

# ── PostgreSQL Backup ──────────────────────────────────────────
if [ -n "${DATABASE_URL:-}" ]; then
  PG_BACKUP="${BACKUP_DIR}/pg_${DATE}.sql.gz"
  pg_dump "$DATABASE_URL" --no-owner --no-acl | gzip > "$PG_BACKUP"
  echo "  PostgreSQL: $PG_BACKUP ($(du -h "$PG_BACKUP" | cut -f1))"
else
  echo "  PostgreSQL: DATABASE_URL not set (skipped)"
fi

# ── Cleanup old backups ────────────────────────────────────────
DELETED=$(find "$BACKUP_DIR" -name "*.gz" -mtime +$RETENTION_DAYS -delete -print | wc -l)
echo "  Cleaned up: ${DELETED} old backups (>${RETENTION_DAYS} days)"

echo "═══ Backup Complete ═══"
