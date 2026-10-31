#!/usr/bin/env bash
# Logical backup of the local (docker) Postgres in pg_dump custom format.
#
#   bash infra/scripts/backup.sh [--db hearthandpan] [--container NAME] [--out DIR]
#
# Read-only on the source database: it runs pg_dump and SELECT count(*) only.
# Writes <out>/<db>_<UTC timestamp>.dump plus .sha256 and .counts (row counts per table,
# taken just before and just after the dump; the drill compares a restore against them).
# Production backups are Render's managed backups/PITR — see docs/runbooks/backup-restore.md.
# Works in Git Bash on Windows and on Linux.
set -euo pipefail

# Git Bash would otherwise rewrite container paths like /tmp/x into C:/... for docker.exe.
export MSYS_NO_PATHCONV=1
# ...so host paths handed to docker.exe are converted explicitly instead.
host_path() { if command -v cygpath > /dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DB_NAME="hearthandpan"
DB_USER="hp"
CONTAINER=""
OUT_DIR="$REPO_ROOT/infra/backups"

usage() {
  sed -n '2,10p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  echo "backup: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --db) DB_NAME="${2:?--db needs a value}"; shift 2 ;;
    --user) DB_USER="${2:?--user needs a value}"; shift 2 ;;
    --container) CONTAINER="${2:?--container needs a value}"; shift 2 ;;
    --out) OUT_DIR="${2:?--out needs a value}"; shift 2 ;;
    -h | --help) usage 0 ;;
    *) echo "backup: unknown argument: $1" >&2; usage 1 ;;
  esac
done

IDENT_RE='^[a-z_][a-z0-9_]{0,62}$'
[[ "$DB_NAME" =~ $IDENT_RE ]] || die "invalid database name: $DB_NAME"
[[ "$DB_USER" =~ $IDENT_RE ]] || die "invalid user name: $DB_USER"

command -v docker > /dev/null || die "docker is not on PATH"

# Default to this project's compose postgres service; never guess another stack's container.
if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker compose -f "$(host_path "$REPO_ROOT/infra/docker-compose.yml")" ps -q postgres 2> /dev/null || true)"
  [ -n "$CONTAINER" ] || die "hearth-and-pan postgres container is not running (docker compose -f infra/docker-compose.yml up -d postgres)"
fi
CONTAINER_NAME="$(docker inspect -f '{{.Name}}' "$CONTAINER" 2> /dev/null | sed 's#^/##')" ||
  die "no such container: $CONTAINER"
case "$CONTAINER_NAME" in
  hearth-and-pan-*) ;;
  *) die "refusing to touch container '$CONTAINER_NAME' (expected a hearth-and-pan-* container)" ;;
esac

psql_in() { # psql_in <db> <sql> — unaligned, tuples only
  docker exec "$CONTAINER_NAME" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$1" -At -c "$2"
}

exists="$(psql_in postgres "SELECT 1 FROM pg_database WHERE datname = '$DB_NAME'")"
[ "$exists" = "1" ] || die "database '$DB_NAME' does not exist in $CONTAINER_NAME"

# Exact row count of every table in the public schema, as "table<TAB>count" lines.
# Exact row count of every table in the public schema, as "table<TAB>count" lines, in one
# round trip (query_to_xml runs a count(*) per table inside a single statement).
COUNT_SQL="SELECT tablename || E'\t' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
row_counts() { # row_counts <db>
  psql_in "$1" "$COUNT_SQL"
}

mkdir -p "$OUT_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
BASE="$OUT_DIR/${DB_NAME}_${STAMP}"
DUMP="$BASE.dump"
REMOTE="/tmp/hp_backup_${STAMP}.dump"

cleanup() { docker exec "$CONTAINER_NAME" rm -f "$REMOTE" > /dev/null 2>&1 || true; }
trap cleanup EXIT

echo "backup: $DB_NAME in $CONTAINER_NAME -> $DUMP"
counts_before="$(row_counts "$DB_NAME")"
t0="$(date +%s)"
docker exec "$CONTAINER_NAME" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --compress=6 --no-owner --no-privileges --file="$REMOTE"
docker cp "$CONTAINER_NAME:$REMOTE" "$(host_path "$DUMP")" > /dev/null
t1="$(date +%s)"
counts_after="$(row_counts "$DB_NAME")"

# A readable table of contents proves the archive is a valid custom-format dump.
docker exec "$CONTAINER_NAME" pg_restore --list "$REMOTE" > /dev/null ||
  die "pg_restore could not read the archive"

printf '%s\n' "$counts_after" > "$BASE.counts"
if [ "$counts_before" != "$counts_after" ]; then
  echo "backup: WARNING row counts changed during the dump (live writes); .counts holds the post-dump values" >&2
fi
(cd "$OUT_DIR" && sha256sum "$(basename "$DUMP")" > "$(basename "$DUMP").sha256")

size="$(wc -c < "$DUMP" | tr -d ' ')"
echo "backup: done in $((t1 - t0))s, ${size} bytes, $(wc -l < "$BASE.counts" | tr -d ' ') tables"
echo "$DUMP"
