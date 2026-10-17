#!/usr/bin/env bash
# Post-deploy smoke check of a running Isker (production, a preview, or local).
#
#   bash scripts/smoke.sh https://your-app.onrender.com
#   bash scripts/smoke.sh http://localhost:8000          # API serving the built SPA
#
# Read-only: it never signs in, writes or changes data. Exit code 1 if any check fails.
set -uo pipefail

BASE="${1:-}"
[ -n "$BASE" ] || { echo "Usage: bash scripts/smoke.sh <base-url>"; exit 2; }
BASE="${BASE%/}"
# Free Render services sleep when idle; the first request can take up to a minute.
TIMEOUT="${SMOKE_TIMEOUT:-90}"
failures=0
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

check() { # name, url, expected status, [grep pattern in body], [header pattern], [request header]
  local name="$1" url="$2" want="$3" pattern="${4:-}" header="${5:-}" req="${6:-X-Smoke: 1}" code
  code="$(curl -sS -m "$TIMEOUT" -H "$req" -o "$tmp/body" -D "$tmp/headers" -w '%{http_code}' "$url" 2>"$tmp/err")" \
    || code="000"
  if [ "$code" != "$want" ]; then
    echo "✖ $name: HTTP $code (expected $want) $(head -c 200 "$tmp/err")"; failures=$((failures + 1)); return
  fi
  if [ -n "$pattern" ] && ! grep -qE "$pattern" "$tmp/body"; then
    echo "✖ $name: response does not contain /$pattern/"; failures=$((failures + 1)); return
  fi
  if [ -n "$header" ] && ! grep -qiE "$header" "$tmp/headers"; then
    echo "✖ $name: missing header /$header/"; failures=$((failures + 1)); return
  fi
  echo "✔ $name"
}

echo "Smoke check of $BASE"
check "API health and database" "$BASE/api/health" 200 '"status": ?"ok".*"database": ?true'
check "Web app (home page)" "$BASE/" 200 '<div id="root">'
check "Deep link served by the SPA (page refresh)" "$BASE/admin/users" 200 '<div id="root">'
check "Sign-in providers" "$BASE/api/auth/providers" 200 '"password": ?true'
check "Protected API refuses anonymous access" "$BASE/api/auth/me" 401 '"code"'
check "Public plans" "$BASE/api/plans" 200 '"key"'
check "Security headers" "$BASE/" 200 '' 'content-security-policy'
check "Database content in Kazakh" "$BASE/api/competencies" 200 'Мүмкіндіктерді анықтау' '' 'Accept-Language: kk'
case "$BASE" in https://*) check "HTTPS strict transport security" "$BASE/api/health" 200 '' 'strict-transport-security' ;; esac

if [ "$failures" -gt 0 ]; then echo "SMOKE: FAILED ($failures)"; exit 1; fi
echo "SMOKE: PASSED"
