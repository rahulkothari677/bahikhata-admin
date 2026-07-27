#!/usr/bin/env bash
# Proves account closure is non-destructive: the account is locked out,
# the shopkeeper's books survive, and retention is recorded.
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
BASE="http://localhost:3001"

SEED_OUT=$(npx tsx scripts/seed-local.ts 2>&1) || { echo "$SEED_OUT" | tail -5; exit 1; }
FOUNDER_SECRET=$(echo "$SEED_OUT" | grep -A1 'founder :' | grep 'TOTP' | awk '{print $3}')

CODE=$(node -e "const{authenticator}=require('otplib');const r=authenticator.timeRemaining();if(r<12){require('child_process').execSync('sleep '+(r+1))};console.log(authenticator.generate('$FOUNDER_SECRET'))")
rm -f /tmp/f.jar
CSRF=$(curl -s -c /tmp/f.jar "$BASE/api/auth/csrf" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).csrfToken))")
curl -s -b /tmp/f.jar -c /tmp/f.jar -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=auditor@test.local" \
  --data-urlencode "password=LocalAudit#2026" --data-urlencode "totpCode=$CODE" --data-urlencode "json=true"

echo "=== BEFORE ==="
npx tsx scripts/show-user-state.ts

USER_ID=$(npx tsx scripts/show-user-state.ts --first-id)

echo
echo "=== closing account WITHOUT a reason (must be refused) ==="
curl -s -b /tmp/f.jar -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"action\":\"delete\",\"userIds\":[\"$USER_ID\"],\"params\":{}}" | head -c 200
echo

echo
echo "=== closing account WITH a reason ==="
curl -s -b /tmp/f.jar -X POST "$BASE/api/admin/bulk" -H 'Content-Type: application/json' -H "Origin: $BASE" \
  -d "{\"action\":\"delete\",\"userIds\":[\"$USER_ID\"],\"params\":{\"reason\":\"verification test closure\"}}" | head -c 300
echo

echo
echo "=== AFTER ==="
npx tsx scripts/show-user-state.ts
