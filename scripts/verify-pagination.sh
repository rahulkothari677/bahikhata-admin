#!/usr/bin/env bash
# Verifies keyset pagination, PII masking and the rollup counters end to end.
set -u
cd "$(dirname "$0")/.."
set -a; . ./.env; set +a
BASE="http://localhost:3001"

SEED=$(npx tsx scripts/seed-local.ts 2>&1) || { echo "$SEED" | tail -5; exit 1; }
SECRET=$(echo "$SEED" | grep -A1 'founder :' | grep TOTP | awk '{print $3}')

CODE=$(node -e "const{authenticator}=require('otplib');const r=authenticator.timeRemaining();if(r<12){require('child_process').execSync('sleep '+(r+1))};console.log(authenticator.generate('$SECRET'))")
rm -f /tmp/p.jar
CSRF=$(curl -s -c /tmp/p.jar "$BASE/api/auth/csrf" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).csrfToken))")
curl -s -b /tmp/p.jar -c /tmp/p.jar -o /dev/null -X POST "$BASE/api/auth/callback/credentials" \
  -H 'Content-Type: application/x-www-form-urlencoded' \
  --data-urlencode "csrfToken=$CSRF" --data-urlencode "email=auditor@test.local" \
  --data-urlencode "password=LocalAudit#2026" --data-urlencode "totpCode=$CODE" --data-urlencode "json=true"

echo "=== page 1 (pageSize=2) ==="
P1=$(curl -s -b /tmp/p.jar "$BASE/api/admin/users?limit=2")
echo "$P1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('rows:',j.users.length,'hasMore:',j.pagination.hasMore);j.users.forEach(u=>console.log('  ',u.email,'| name:',u.name,'| phone:',u.phone,'| txnCount:',u.txnCount,'| stale:',u.countsStale));})"

CURSOR=$(echo "$P1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>console.log(JSON.parse(d).pagination.nextCursor||''))")

echo
echo "=== page 2 (via cursor) ==="
curl -s -b /tmp/p.jar "$BASE/api/admin/users?limit=2&cursor=$CURSOR" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('rows:',j.users.length,'hasMore:',j.pagination.hasMore);j.users.forEach(u=>console.log('  ',u.email));})"

echo
echo "=== malformed cursor (must NOT 500) ==="
curl -s -o /dev/null -w 'status: %{http_code}\n' -b /tmp/p.jar "$BASE/api/admin/users?cursor=GARBAGE!!"

echo
echo "=== limit=999999 (must clamp, not hang) ==="
curl -s -b /tmp/p.jar "$BASE/api/admin/users?limit=999999" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('pageSize applied:',j.pagination.pageSize);})"

echo
echo "=== running the rollup ==="
curl -s -b /tmp/p.jar -X POST "$BASE/api/admin/compute-daily-stats" -H 'Content-Type: application/json' -H "Origin: $BASE" -d '{}' \
  | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('rollup:',JSON.stringify(j.rollup));})"

echo
echo "=== counts after rollup ==="
curl -s -b /tmp/p.jar "$BASE/api/admin/users?limit=5" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);j.users.forEach(u=>console.log('  ',u.email,'txnCount:',u.txnCount,'stale:',u.countsStale));})"

echo
echo "=== minTransactions=1 filter (was JS post-filter, now SQL) ==="
curl -s -b /tmp/p.jar "$BASE/api/admin/users?minTransactions=1" | node -e "let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{const j=JSON.parse(d);console.log('matched:',j.users.length);j.users.forEach(u=>console.log('  ',u.email,'txnCount:',u.txnCount));})"
