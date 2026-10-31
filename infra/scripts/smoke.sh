#!/usr/bin/env bash
# Post-deploy smoke test (read-only GETs).
#
#   bash infra/scripts/smoke.sh <api-base> <web-base>
#   e.g. bash infra/scripts/smoke.sh https://api.hearthandpan.com https://www.hearthandpan.com
set -euo pipefail

[ $# -eq 2 ] || { sed -n '2,5p' "$0" | sed 's/^# \{0,1\}//'; exit 1; }
API="${1%/}"
WEB="${2%/}"
URL_RE='^https?://[A-Za-z0-9.-]+(:[0-9]+)?$'
[[ "$API" =~ $URL_RE ]] || { echo "smoke: invalid api base: $API" >&2; exit 1; }
[[ "$WEB" =~ $URL_RE ]] || { echo "smoke: invalid web base: $WEB" >&2; exit 1; }

fail() { echo "smoke: FAIL — $*" >&2; exit 1; }
CURL=(curl -sS --max-time 15)

health="$("${CURL[@]}" "$API/api/v1/health")" || fail "health request failed"
grep -q '"db":"ok"' <<< "$health" || fail "health: db not ok ($health)"
grep -q '"redis":"ok"' <<< "$health" || fail "health: redis not ok ($health)"
echo "ok  health"

"${CURL[@]}" "$API/api/v1/products?pageSize=1" | grep -q '"success":true' || fail "product listing"
echo "ok  product listing"

code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$WEB/")"
[ "$code" = "200" ] || fail "storefront home returned $code"
echo "ok  storefront home"

code="$("${CURL[@]}" -o /dev/null -w '%{http_code}' "$API/api/v1/admin/orders")"
[ "$code" = "401" ] || fail "admin endpoint not protected (got $code)"
echo "ok  admin endpoint requires auth"

echo "Smoke tests passed"
