#!/usr/bin/env bash
# SECTOR7 geri yükleme.
#   ./scripts/restore.sh backups/sector7-YYYYmmdd-HHMMSS.dump [uploads.tar.gz] [--yes]
# UYARI: mevcut veritabanı nesneleri silinip dökümden yeniden oluşturulur.
set -euo pipefail

cd "$(dirname "$0")/.."
COMPOSE="docker compose -f docker-compose.prod.yml"

YES=0
DUMP=""
UPLOADS=""
for a in "$@"; do
  case "$a" in
    --yes) YES=1 ;;
    *)
      if [ -z "$DUMP" ]; then DUMP="$a"
      elif [ -z "$UPLOADS" ]; then UPLOADS="$a"
      else echo "Fazla argüman: $a" >&2; exit 2
      fi
      ;;
  esac
done

if [ -z "$DUMP" ]; then
  echo "Kullanım: $0 <dosya.dump> [uploads.tar.gz] [--yes]" >&2
  exit 2
fi
[ -f "$DUMP" ] || { echo "Dosya yok: $DUMP" >&2; exit 1; }
[ -z "$UPLOADS" ] || [ -f "$UPLOADS" ] || { echo "Dosya yok: $UPLOADS" >&2; exit 1; }

if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  . ./.env
  set +a
fi
: "${POSTGRES_USER:?POSTGRES_USER tanımlı değil}"
: "${POSTGRES_DB:?POSTGRES_DB tanımlı değil}"

if [ "$YES" -ne 1 ]; then
  echo "'${POSTGRES_DB}' veritabanı '${DUMP}' ile ÜZERİNE YAZILACAK."
  [ -z "$UPLOADS" ] || echo "Yüklemeler '${UPLOADS}' arşivinden geri açılacak."
  printf "Devam etmek için 'evet' yazın: "
  read -r ans
  [ "$ans" = "evet" ] || { echo "İptal edildi."; exit 1; }
fi

echo "[restore] uygulama durduruluyor"
$COMPOSE stop app || true

echo "[restore] veritabanı geri yükleniyor"
$COMPOSE exec -T db pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner < "$DUMP"

if [ -n "$UPLOADS" ]; then
  echo "[restore] uploads geri yükleniyor"
  $COMPOSE run -T --no-deps -u root --entrypoint sh app -c 'tar -xzf - -C /app/uploads && chown -R node:node /app/uploads' < "$UPLOADS"
fi

echo "[restore] uygulama başlatılıyor"
$COMPOSE up -d app
echo "[restore] tamam"
