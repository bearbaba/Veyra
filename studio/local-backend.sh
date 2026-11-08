#!/usr/bin/env bash
# Isolated local backend for Studio development. Environment tooling only.
#
# Runs server/bff.ts so the Preview's /api proxy (vite.config.ts, port 3001) has
# a backend that can never reach Production or hold real credentials.
#
# Isolation guarantees
#   - The process environment is built from scratch (env -i). Nothing from the
#     Studio shell or any .env file is inherited: no Circle, X, LLM, relay or
#     signer keys, no Render or Vercel tokens.
#   - VEYRA_ENV=local. In that mode the Mainnet identity authority and every
#     hosted-backend gate stay closed (see server/services/mainnetIdentityCapability.ts),
#     so Mainnet identity, receipts and payments cannot be exercised here.
#   - The database is a dedicated local database (veyra_studio_dev) on
#     127.0.0.1, created on demand inside the local Postgres container. The
#     script refuses any other host or database name, and never uses `veyra`.
#   - Bun auto-loads .env files from the working directory, so the script
#     refuses to start if the repository has one.
set -euo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONTAINER="${VEYRA_STUDIO_PG_CONTAINER:-veyra-postgres}"
DB_NAME="veyra_studio_dev"
PORT_BFF="${PORT:-3001}"

fail() { echo "[studio-backend] $*" >&2; exit 1; }

for f in "$REPO"/.env "$REPO"/.env.local "$REPO"/.env.development "$REPO"/.env.development.local "$REPO"/.env.production "$REPO"/.env.production.local "$REPO"/.env.test "$REPO"/.env.test.local; do
  [ -e "$f" ] && fail "$f exists and Bun would auto-load it into the backend. Remove it; the Studio backend must not inherit configuration."
done
command -v docker >/dev/null || fail "docker is required for the local Postgres container."
docker inspect "$CONTAINER" >/dev/null 2>&1 || fail "local Postgres container '$CONTAINER' not found."

pg_user="$(docker exec "$CONTAINER" printenv POSTGRES_USER)"
pg_pass="$(docker exec "$CONTAINER" printenv POSTGRES_PASSWORD)"
[ -n "$pg_user" ] && [ -n "$pg_pass" ] || fail "could not read local database credentials from the container."

exists="$(docker exec "$CONTAINER" psql -U "$pg_user" -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname='${DB_NAME}'")"
if [ "$exists" != "1" ]; then
  docker exec "$CONTAINER" psql -U "$pg_user" -d postgres -c "CREATE DATABASE ${DB_NAME}" >/dev/null
  echo "[studio-backend] created local database ${DB_NAME}"
fi

enc_pass="$(python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=""))' "$pg_pass")"
DATABASE_URL="postgres://${pg_user}:${enc_pass}@127.0.0.1:5432/${DB_NAME}"

# Defence in depth: assert the URL we are about to hand over really is local.
case "$DATABASE_URL" in
  *"@127.0.0.1:5432/${DB_NAME}") ;;
  *) fail "refusing to start: database URL is not the isolated local database." ;;
esac

# Per-machine random session secret, kept outside the repository.
SECRET_FILE="${HOME:-/tmp}/.veyra-studio-session-secret"
[ -s "$SECRET_FILE" ] || { umask 077; head -c 32 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$SECRET_FILE"; }

run() {
  env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
    DATABASE_URL="$DATABASE_URL" VEYRA_ENV=local NODE_ENV=development \
    VEYRA_SESSION_SECRET="$(cat "$SECRET_FILE")" \
    VEYRA_APP_ORIGIN="http://localhost:5173" PORT="$PORT_BFF" \
    "$@"
}

has_schema="$(docker exec "$CONTAINER" psql -U "$pg_user" -d "$DB_NAME" -tAc "SELECT to_regclass('public.veyra_users') IS NOT NULL")"
if [ "$has_schema" != "t" ]; then
  echo "[studio-backend] applying migrations to the isolated ${DB_NAME} database"
  run bun run --cwd "$REPO" db:migrate
fi

echo "[studio-backend] VEYRA_ENV=local, database ${DB_NAME} @127.0.0.1, port ${PORT_BFF}; no external credentials"
exec env -i PATH="$PATH" HOME="${HOME:-/tmp}" \
  DATABASE_URL="$DATABASE_URL" VEYRA_ENV=local NODE_ENV=development \
  VEYRA_SESSION_SECRET="$(cat "$SECRET_FILE")" \
  VEYRA_APP_ORIGIN="http://localhost:5173" PORT="$PORT_BFF" \
  bun run --cwd "$REPO" server
