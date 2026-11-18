#!/usr/bin/env bash
# SECTOR7 yedekleme: PostgreSQL dökümü + uploads arşivi.
# cron örneği (her gece 03:15):
#   15 3 * * * cd /opt/sector7 && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
: "${POSTGRES_USER:?POSTGRES_USER tanımlı değil}"
: "${POSTGRES_DB:?POSTGRES_DB tanımlı değil}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p backups
STAMP="$(date +%Y%m%d-%H%M%S)"
DUMP="backups/sector7-${STAMP}.dump"
UPLOADS="backups/sector7-uploads-${STAMP}.tar.gz"

echo "[backup] veritabanı -> ${DUMP}"
$COMPOSE exec -T db pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB" > "${DUMP}.tmp"
mv "${DUMP}.tmp" "$DUMP"

echo "[backup] uploads -> ${UPLOADS}"
$COMPOSE exec -T app tar -czf - -C /app/uploads . > "${UPLOADS}.tmp"
mv "${UPLOADS}.tmp" "$UPLOADS"

echo "[backup] ${KEEP_DAYS} günden eski yedekler siliniyor"
find backups -maxdepth 1 -type f \( -name 'sector7-*.dump' -o -name 'sector7-uploads-*.tar.gz' \) -mtime +"$KEEP_DAYS" -print -delete

echo "[backup] tamam"
