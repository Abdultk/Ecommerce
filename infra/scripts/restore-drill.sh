#!/usr/bin/env bash
# Restore drill: restore a backup into a NEW scratch database, verify it, then drop it.
#
#   bash infra/scripts/restore-drill.sh [--dump FILE] [--source-db hearthandpan]
#        [--scratch-db hearthandpan_restore_drill] [--container NAME] [--keep]
#        [--skip-prisma] [--replace-existing NAME]
#
# Without --dump it first takes a fresh backup with backup.sh.
# Verifies: pg_restore exits cleanly; every public table's row count equals the backup's
# .counts manifest (and the live source); `prisma migrate status` reports the schema is
# up to date. The source database is only read. The scratch name must end in
# "_restore_drill"; an existing scratch DB is only replaced with --replace-existing <name>.
set -euo pipefail
export MSYS_NO_PATHCONV=1
# ...so host paths handed to docker.exe are converted explicitly instead.
host_path() { if command -v cygpath > /dev/null; then cygpath -w "$1"; else printf '%s' "$1"; fi; }

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SOURCE_DB="hearthandpan"
SCRATCH_DB="hearthandpan_restore_drill"
DB_USER="hp"
CONTAINER=""
DUMP=""
KEEP=0
SKIP_PRISMA=0
REPLACE_CONFIRM=""
PROTECTED_DBS="hearthandpan hearthandpan_test hearthandpan_e2e_test postgres template0 template1"

usage() {
  sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

die() {
  echo "restore-drill: $*" >&2
  exit 1
}

while [ $# -gt 0 ]; do
  case "$1" in
    --dump) DUMP="${2:?--dump needs a value}"; shift 2 ;;
    --source-db) SOURCE_DB="${2:?--source-db needs a value}"; shift 2 ;;
    --scratch-db) SCRATCH_DB="${2:?--scratch-db needs a value}"; shift 2 ;;
    --user) DB_USER="${2:?--user needs a value}"; shift 2 ;;
    --container) CONTAINER="${2:?--container needs a value}"; shift 2 ;;
    --keep) KEEP=1; shift ;;
    --skip-prisma) SKIP_PRISMA=1; shift ;;
    --replace-existing) REPLACE_CONFIRM="${2:?--replace-existing needs the scratch db name}"; shift 2 ;;
    -h | --help) usage 0 ;;
    *) echo "restore-drill: unknown argument: $1" >&2; usage 1 ;;
  esac
done

# ---------- Input validation and safety rails ----------
IDENT_RE='^[a-z_][a-z0-9_]{0,62}$'
for name in "$SOURCE_DB" "$SCRATCH_DB" "$DB_USER"; do
  [[ "$name" =~ $IDENT_RE ]] || die "invalid identifier: $name"
done
[[ "$SCRATCH_DB" == *_restore_drill ]] || die "scratch database name must end in _restore_drill (got $SCRATCH_DB)"
[ "$SCRATCH_DB" != "$SOURCE_DB" ] || die "scratch and source database are the same"
for protected in $PROTECTED_DBS; do
  [ "$SCRATCH_DB" != "$protected" ] || die "refusing to use protected database '$protected' as scratch"
done
command -v docker > /dev/null || die "docker is not on PATH"

if [ -z "$CONTAINER" ]; then
  CONTAINER="$(docker compose -f "$(host_path "$REPO_ROOT/infra/docker-compose.yml")" ps -q postgres 2> /dev/null || true)"
  [ -n "$CONTAINER" ] || die "hearth-and-pan postgres container is not running"
fi
CONTAINER_NAME="$(docker inspect -f '{{.Name}}' "$CONTAINER" 2> /dev/null | sed 's#^/##')" ||
  die "no such container: $CONTAINER"
case "$CONTAINER_NAME" in
  hearth-and-pan-*) ;;
  *) die "refusing to touch container '$CONTAINER_NAME' (expected a hearth-and-pan-* container)" ;;
esac

psql_in() { # psql_in <db> <sql>
  docker exec "$CONTAINER_NAME" psql -X -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$1" -At -c "$2"
}
# Exact row count of every table in the public schema, as "table<TAB>count" lines, in one
# round trip (query_to_xml runs a count(*) per table inside a single statement).
COUNT_SQL="SELECT tablename || E'\t' || (xpath('/row/c/text()', query_to_xml(format('SELECT count(*) AS c FROM public.%I', tablename), false, true, '')))[1]::text FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename"
row_counts() { # row_counts <db>
  psql_in "$1" "$COUNT_SQL"
}
now_ms() { date +%s%3N; }
elapsed() { awk -v a="$1" -v b="$2" 'BEGIN { printf "%.1fs", (b - a) / 1000 }'; }

# ---------- Backup (unless one was given) ----------
T_START="$(now_ms)"
if [ -z "$DUMP" ]; then
  DUMP="$(bash "$REPO_ROOT/infra/scripts/backup.sh" --db "$SOURCE_DB" --user "$DB_USER" --container "$CONTAINER_NAME" | tail -n 1)"
fi
[ -f "$DUMP" ] || die "dump file not found: $DUMP"
MANIFEST="${DUMP%.dump}.counts"
if [ -f "$DUMP.sha256" ]; then
  (cd "$(dirname "$DUMP")" && sha256sum --check --quiet "$(basename "$DUMP").sha256") ||
    die "checksum mismatch for $DUMP"
fi
T_BACKUP="$(now_ms)"

# ---------- Create scratch DB ----------
exists="$(psql_in postgres "SELECT 1 FROM pg_database WHERE datname = '$SCRATCH_DB'")"
if [ "$exists" = "1" ]; then
  [ "$REPLACE_CONFIRM" = "$SCRATCH_DB" ] ||
    die "scratch database '$SCRATCH_DB' already exists; re-run with --replace-existing $SCRATCH_DB to drop it first"
  echo "restore-drill: dropping leftover $SCRATCH_DB (confirmed)"
  psql_in postgres "DROP DATABASE \"$SCRATCH_DB\" WITH (FORCE)" > /dev/null
fi

CREATED=0
REMOTE="/tmp/hp_restore_drill_$$.dump"
cleanup() {
  docker exec "$CONTAINER_NAME" rm -f "$REMOTE" > /dev/null 2>&1 || true
  if [ "$CREATED" = "1" ] && [ "$KEEP" = "0" ]; then
    psql_in postgres "DROP DATABASE IF EXISTS \"$SCRATCH_DB\" WITH (FORCE)" > /dev/null &&
      echo "restore-drill: dropped $SCRATCH_DB"
  fi
}
trap cleanup EXIT

psql_in postgres "CREATE DATABASE \"$SCRATCH_DB\" OWNER \"$DB_USER\"" > /dev/null
CREATED=1

# ---------- Restore ----------
docker cp "$(host_path "$DUMP")" "$CONTAINER_NAME:$REMOTE" > /dev/null
T_RESTORE0="$(now_ms)"
docker exec "$CONTAINER_NAME" pg_restore -U "$DB_USER" -d "$SCRATCH_DB" \
  --no-owner --no-privileges --exit-on-error --jobs=4 "$REMOTE"
T_RESTORE1="$(now_ms)"

# ---------- Verify row counts ----------
restored="$(row_counts "$SCRATCH_DB")"
source_now="$(row_counts "$SOURCE_DB")"
expected="$source_now"
[ -f "$MANIFEST" ] && expected="$(cat "$MANIFEST")"

echo ""
printf '%-22s %10s %10s %10s  %s\n' "table" "backup" "restored" "source" "result"
failures=0
while IFS=$'\t' read -r table want; do
  got="$(printf '%s\n' "$restored" | awk -F'\t' -v t="$table" '$1 == t { print $2 }')"
  live="$(printf '%s\n' "$source_now" | awk -F'\t' -v t="$table" '$1 == t { print $2 }')"
  result="ok"
  if [ "$got" != "$want" ]; then
    result="MISMATCH"
    failures=$((failures + 1))
  elif [ "$live" != "$want" ]; then
    result="ok (source changed since backup)"
  fi
  printf '%-22s %10s %10s %10s  %s\n' "$table" "$want" "${got:-missing}" "${live:-missing}" "$result"
done <<< "$expected"
tables_restored="$(printf '%s\n' "$restored" | grep -c . || true)"
tables_expected="$(printf '%s\n' "$expected" | grep -c . || true)"
[ "$tables_restored" = "$tables_expected" ] || {
  echo "restore-drill: table count differs (backup $tables_expected, restored $tables_restored)" >&2
  failures=$((failures + 1))
}
T_VERIFY="$(now_ms)"

# ---------- Verify migrations with Prisma (read-only status check) ----------
prisma_result="skipped"
if [ "$SKIP_PRISMA" = "0" ]; then
  src_url="${DATABASE_URL:-}"
  if [ -z "$src_url" ] && [ -f "$REPO_ROOT/.env" ]; then
    src_url="$(grep -E '^DATABASE_URL=' "$REPO_ROOT/.env" | tail -n 1 | cut -d= -f2- | tr -d '"'"'"'\r')"
  fi
  [ -n "$src_url" ] || die "DATABASE_URL not set and not found in .env (or pass --skip-prisma)"
  # Swap only the database name; credentials and host stay as configured, never printed.
  scratch_url="$(printf '%s' "$src_url" | sed -E "s#/[A-Za-z0-9_]+([?].*)?\$#/$SCRATCH_DB\\1#")"
  case "$scratch_url" in
    */"$SCRATCH_DB" | */"$SCRATCH_DB"\?*) ;;
    *) die "could not derive the scratch DATABASE_URL" ;;
  esac
  if (cd "$REPO_ROOT/apps/api" && env -u MSYS_NO_PATHCONV DATABASE_URL="$scratch_url" pnpm exec prisma migrate status > "${TMPDIR:-/tmp}/hp_drill_prisma_$$.log" 2>&1); then
    prisma_result="up to date"
  else
    prisma_result="FAILED"
    failures=$((failures + 1))
    sed 's#postgres\(ql\)\{0,1\}://[^ ]*#[db-url]#g' "${TMPDIR:-/tmp}/hp_drill_prisma_$$.log" >&2
  fi
  rm -f "${TMPDIR:-/tmp}/hp_drill_prisma_$$.log"
fi
T_END="$(now_ms)"

echo ""
echo "dump:              $DUMP ($(wc -c < "$DUMP" | tr -d ' ') bytes)"
echo "backup step:       $(elapsed "$T_START" "$T_BACKUP")"
echo "pg_restore:        $(elapsed "$T_RESTORE0" "$T_RESTORE1")"
echo "row-count verify:  $(elapsed "$T_RESTORE1" "$T_VERIFY")"
echo "prisma status:     $prisma_result ($(elapsed "$T_VERIFY" "$T_END"))"
echo "total:             $(elapsed "$T_START" "$T_END")"

if [ "$failures" -gt 0 ]; then
  echo "RESTORE DRILL FAILED ($failures problem(s))" >&2
  exit 1
fi
echo "RESTORE DRILL PASSED"
