#!/usr/bin/env bash
# Nightly dump of the client's Mongo (raw log, brain vectors, approvals, audit chain).
#
#   config/backup-mongo.sh                 # uses MONGO_URI from env or ./.env
#   MONGO_URI=mongodb://... config/backup-mongo.sh
#   BACKUP_RETENTION_DAYS=30 config/backup-mongo.sh
#
# Output: backups/<YYYY-MM-DD_HHMM>/  (mongodump directory format)
# Restore: mongorestore --uri "$MONGO_URI" --drop backups/<stamp>/
# Cron on the VPS:  0 3 * * *  cd /opt/silkroad && config/backup-mongo.sh >> logs/backup.log 2>&1
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root"

if [ -z "${MONGO_URI:-}" ] && [ -f .env ]; then
  MONGO_URI="$(grep -E '^MONGO_URI=' .env | tail -n1 | cut -d= -f2- | tr -d '"'"'"'"')"
fi
: "${MONGO_URI:?MONGO_URI is not set (env or .env)}"
retention="${BACKUP_RETENTION_DAYS:-14}"

if ! command -v mongodump >/dev/null 2>&1; then
  echo "mongodump not found — install MongoDB Database Tools (https://www.mongodb.com/try/download/database-tools)" >&2
  exit 1
fi

stamp="$(date +%Y-%m-%d_%H%M)"
dest="backups/$stamp"
mkdir -p "$dest"
mongodump --uri "$MONGO_URI" --out "$dest" --quiet
echo "backup written to $dest"

find backups -mindepth 1 -maxdepth 1 -type d -mtime "+$retention" -print -exec rm -rf {} + | sed 's/^/pruned /' || true
