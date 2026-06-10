#!/bin/sh
set -e

DB_PATH="${DB_PATH:-/data/muraja.db}"
export DB_PATH

if [ -n "$R2_BUCKET" ] && [ -n "$R2_ENDPOINT" ]; then
  # Disaster recovery: if the volume is fresh/empty, restore the latest backup.
  if [ ! -f "$DB_PATH" ]; then
    echo "[litestream] no local DB — attempting restore from R2..."
    litestream restore -if-replica-exists -config /etc/litestream.yml "$DB_PATH" || true
  fi
  echo "[litestream] replicating $DB_PATH → R2 bucket $R2_BUCKET"
  exec litestream replicate -config /etc/litestream.yml \
    -exec "node backend/dist/server.js"
else
  echo "[litestream] R2 env not set — running WITHOUT backup replication"
  exec node backend/dist/server.js
fi
