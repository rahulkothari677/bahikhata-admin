#!/usr/bin/env bash
# Local verification: seed, log in as each role, and probe every admin route.
# Runs seed -> login -> probe in ONE process so the flaky local prisma dev
# proxy has no window to drop the connection between steps.
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a

BASE="http://localhost:3001"

echo "=== seeding ==="
SEED_OUT=$(npx tsx scripts/seed-local.ts 2>&1) || { echo "$SEED_OUT" | tail -5; exit 1; }
FOUNDER_SECRET=$(echo "$SEED_OUT" | grep -A1 'founder :' | grep 'TOTP' | awk '{print $3}')
VIEWER_SECRET=$(echo "$SEED_OUT" | grep -A1 'viewer  :' | grep 'TOTP' | awk '{print $3}')
npx tsx scripts/seed-flag.ts >/dev/null 2>&1
echo "founder secret: ${FOUNDER_SECRET:0:4}...  viewer secret: ${VIEWER_SECRET:0:4}..."

login() { # $1=email $2=secret $3=cookiejar
  local code
  code=$(node -e "const{authenticator}=require('otplib');const r=authenticator.timeRemaining();if(r<12){require('child_process').execSync('sleep '+(r+1))};console.log(authenticator.generate('$2'))")
  rm -f "$3"
  local csrf
  csrf=$(curl -s -c "$3" "$BASE/api/auth/csrf" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).csrfToken))")
  curl -s -b "$3" -c "$3" -o /dev/null \
    -X POST "$BASE/api/auth/callback/credentials" \
    -H 'Content-Type: application/x-www-form-urlencoded' \
    --data-urlencode "csrfToken=$csrf" \
    --data-urlencode "email=$1" \
    --data-urlencode "password=LocalAudit#2026" \
    --data-urlencode "totpCode=$code" \
    --data-urlencode "json=true"
  curl -s -b "$3" "$BASE/api/auth/session" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{try{console.log(JSON.parse(d).user?.role||'NONE')}catch{console.log('NONE')}})"
}

READS="overview users revenue activity risk?tab=overview subscriptions audit-log features incidents fraud-rules experiments webhooks api-keys growth segments ai-usage nps database bulk-jobs anomalies financial-reports churn-predictions campaigns support"

echo
echo "=== FOUNDER ==="
ROLE=$(login "auditor@test.local" "$FOUNDER_SECRET" /tmp/founder.jar)
echo "session role: $ROLE"
FAIL=0
for p in $READS; do
  s=$(curl -s -b /tmp/founder.jar -o /dev/null -w '%{http_code}' "$BASE/api/admin/$p")
  [ "$s" = "200" ] || { echo "  NOT 200: $p -> $s"; FAIL=$((FAIL+1)); }
done
echo "founder: $((24-FAIL))/24 reads OK"

echo
echo "=== VIEWER (mutations must all be 403) ==="
ROLE=$(login "viewer@test.local" "$VIEWER_SECRET" /tmp/viewer.jar)
echo "session role: $ROLE"
for m in \
  "PATCH /api/admin/features/ai_scanner {\"enabled\":false}" \
  "POST /api/admin/fraud-rules {\"name\":\"x\",\"metric\":\"transaction_count\",\"operator\":\"gt\",\"threshold\":1}" \
  "POST /api/admin/incidents {\"title\":\"x\",\"severity\":\"minor\"}" \
  "POST /api/admin/api-keys {\"name\":\"x\",\"scopes\":[\"leads:read\"]}" \
  "POST /api/admin/bulk {\"action\":\"x\"}" \
  ; do
  set -- $m
  meth=$1; path=$2; shift 2; body="$*"
  s=$(curl -s -b /tmp/viewer.jar -o /dev/null -w '%{http_code}' -X "$meth" "$BASE$path" -H 'Content-Type: application/json' -d "$body")
  echo "  $meth $path -> $s"
done
