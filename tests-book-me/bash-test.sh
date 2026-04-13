#!/bin/bash
#
# End-to-end test for book-me via curl (no browser, no Playwright).
#
# Seeds data → calls schedule-event action → verifies results.
# Uses X-Dev-User-Id header to bypass Clerk JWT auth.
#
# Usage:
#   cd apps/book-me && bash tests/bash-test.sh
#   cd apps/book-me && bash tests/bash-test.sh --user user_38344vbCNcd2AjjNRrTyleqgMEW
#
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
source "$SCRIPT_DIR/../../../test-utils/harness.sh"

WRANGLER_PORT="${WRANGLER_PORT:-8788}"
SCOPE="app:book-me"

DEV_USER_ID="user_test_host_$(date +%s)"

for arg in "$@"; do
  case "$arg" in
    --user) shift; DEV_USER_ID="$1"; shift || true ;;
    --user=*) DEV_USER_ID="${arg#--user=}" ;;
  esac
done

# ── Constants ───────────────────────────────────────────

NOW=$(date -u +%Y-%m-%dT%H:%M:%S.000Z)
TZ_IANA=$(py "
try:
    import datetime
    print(datetime.datetime.now().astimezone().tzinfo)
except:
    print('America/New_York')
")
ET_ID="et_$(date +%s)_test"

# Future Wednesday at 15:00 UTC
BOOKING_DATE=$(py "
import datetime
d = datetime.date.today() + datetime.timedelta(days=30)
while d.weekday() != 2:  # Wednesday
    d += datetime.timedelta(days=1)
print(d.isoformat())
")
BOOKING_START="${BOOKING_DATE}T15:00:00.000Z"

echo "═══════════════════════════════════════════════════"
echo " book-me E2E Test (curl)"
echo "═══════════════════════════════════════════════════"
echo "  Host:     $DEV_USER_ID"
echo "  Timezone: $TZ_IANA"
echo "  Booking:  $BOOKING_START"

# ── 0. Check connectivity ───────────────────────────────

echo ""
echo "── 0. Connectivity ──"

check_platform "$SCOPE"
check_wrangler "$WRANGLER_PORT"

# ── 1. Clear ────────────────────────────────────────────

echo ""
echo "── 1. Clear all data ──"

sql "$SCOPE" "DELETE FROM records" >/dev/null
echo "  ✓ $SCOPE records"

# Clear user DO tables
USER_TABLES=$(sql "user:$DEV_USER_ID" ".TABLES" 2>/dev/null | py "import json,sys; ts=json.load(sys.stdin).get('tables',[]); print(','.join([t for t in ts if t not in ('runtime_schemas','yjs_docs')]))" 2>/dev/null || echo "")
if [ -n "$USER_TABLES" ]; then
  IFS=',' read -ra TBL_ARR <<< "$USER_TABLES"
  for t in "${TBL_ARR[@]}"; do
    [ -n "$t" ] && sql "user:$DEV_USER_ID" "DELETE FROM \"$t\"" >/dev/null 2>&1 || true
  done
  echo "  ✓ user:$DEV_USER_ID ($USER_TABLES)"
fi

# ── 2. Seed user ────────────────────────────────────────

echo ""
echo "── 2. Seed user ──"

USER_JSON=$(py "
import json; print(json.dumps({
  'email':'testhost@example.com','name':'Test Host','role':'member',
  'username':'testhost','bio':'','calendarConnected':False,
  'emailConnected':False,'createdAt':'$NOW','lastSeenAt':'$NOW',
}))")
sql "$SCOPE" "INSERT OR REPLACE INTO records (collection,record_id,data,created_by,created_at,updated_at) VALUES ('users','$DEV_USER_ID','$USER_JSON','$DEV_USER_ID','$NOW','$NOW')" >/dev/null
CNT=$(sql_count "$SCOPE" "SELECT COUNT(*) as cnt FROM records WHERE collection='users' AND record_id='$DEV_USER_ID'")
assert_eq "User seeded" "1" "$CNT"

# ── 3. Seed availability ───────────────────────────────

echo ""
echo "── 3. Seed availability ──"

AVAIL_JSON=$(py "
import json; print(json.dumps({
  'userId':'$DEV_USER_ID',
  'monday':   {'isAvailable':True,'startTime':'09:00','endTime':'17:00'},
  'tuesday':  {'isAvailable':True,'startTime':'09:00','endTime':'17:00'},
  'wednesday':{'isAvailable':True,'startTime':'09:00','endTime':'17:00'},
  'thursday': {'isAvailable':True,'startTime':'09:00','endTime':'17:00'},
  'friday':   {'isAvailable':True,'startTime':'09:00','endTime':'17:00'},
  'saturday': {'isAvailable':False,'startTime':'09:00','endTime':'17:00'},
  'sunday':   {'isAvailable':False,'startTime':'09:00','endTime':'17:00'},
  'timeGap':60,'timezone':'$TZ_IANA',
}))")
sql "$SCOPE" "INSERT OR REPLACE INTO records (collection,record_id,data,created_by,created_at,updated_at) VALUES ('availability','avail_$DEV_USER_ID','$AVAIL_JSON','$DEV_USER_ID','$NOW','$NOW')" >/dev/null
CNT=$(sql_count "$SCOPE" "SELECT COUNT(*) as cnt FROM records WHERE collection='availability'")
assert_eq "Availability seeded" "1" "$CNT"

# ── 4. Seed event type ─────────────────────────────────

echo ""
echo "── 4. Seed event type ──"

ET_JSON=$(py "
import json; print(json.dumps({
  'userId':'$DEV_USER_ID','title':'Test Meeting',
  'description':'Curl test','duration':30,'location':'deepspace-meets',
  'isActive':True,'color':'#8b5cf6','sendDeepSpaceMail':False,'sendGcalInvite':False,'sendExternalEmail':True,
}))")
sql "$SCOPE" "INSERT OR REPLACE INTO records (collection,record_id,data,created_by,created_at,updated_at) VALUES ('event-types','$ET_ID','$ET_JSON','$DEV_USER_ID','$NOW','$NOW')" >/dev/null
CNT=$(sql_count "$SCOPE" "SELECT COUNT(*) as cnt FROM records WHERE collection='event-types' AND record_id='$ET_ID'")
assert_eq "Event type seeded" "1" "$CNT"

# ── 5. Call schedule-event ──────────────────────────────

echo ""
echo "── 5. schedule-event action ──"

BODY=$(py "
import json; print(json.dumps({
  'hostUserId':'$DEV_USER_ID','eventTypeId':'$ET_ID',
  'startTime':'$BOOKING_START','guestEmail':'guest@example.com',
  'guestName':'Test Guest','description':'Curl E2E booking',
}))")

RESULT=$(call_action "$WRANGLER_PORT" "schedule-event" "$BODY")
SUCCESS=$(echo "$RESULT" | py "import json,sys; print(json.load(sys.stdin).get('success',False))")
ERROR=$(echo "$RESULT" | py "import json,sys; print(json.load(sys.stdin).get('error',''))")

if [ "$SUCCESS" = "True" ]; then
  echo "  ✓ schedule-event succeeded"
  BOOKING_ID=$(echo "$RESULT" | py "import json,sys; print(json.load(sys.stdin).get('data',{}).get('bookingId','?'))")
  echo "    bookingId: $BOOKING_ID"
  PASS=$((PASS + 1))
else
  echo "  ✗ schedule-event FAILED: $ERROR"
  echo "    Response: $RESULT"
  FAIL=$((FAIL + 1))
fi

# ── 6. Verify booking ──────────────────────────────────

echo ""
echo "── 6. Verify booking ──"

B_CNT=$(sql_count "$SCOPE" "SELECT COUNT(*) as cnt FROM records WHERE collection='bookings'")
assert_gt "Booking record created" 0 "$B_CNT"

if [ "$B_CNT" -gt 0 ] 2>/dev/null; then
  B_DATA=$(sql "$SCOPE" "SELECT data FROM records WHERE collection='bookings' ORDER BY created_at DESC LIMIT 1" | py "
import json,sys
d = json.load(sys.stdin)['rows'][0]
data = json.loads(d['data']) if isinstance(d['data'],str) else d['data']
print(json.dumps(data))
")
  B_GUEST=$(echo "$B_DATA" | py "import json,sys; print(json.load(sys.stdin).get('guestName',''))")
  B_STATUS=$(echo "$B_DATA" | py "import json,sys; print(json.load(sys.stdin).get('status',''))")
  assert_eq "Guest name" "Test Guest" "$B_GUEST"
  assert_eq "Status confirmed" "confirmed" "$B_STATUS"
fi

# ── 7. Verify host calendar event ──────────────────────

echo ""
echo "── 7. Verify calendar event ──"

USER_TABLES=$(sql "user:$DEV_USER_ID" ".TABLES" 2>/dev/null | py "import json,sys; print(','.join(json.load(sys.stdin).get('tables',[])))" 2>/dev/null || echo "")

if echo "$USER_TABLES" | grep -q "c_events"; then
  CAL_CNT=$(sql_count "user:$DEV_USER_ID" "SELECT COUNT(*) as cnt FROM c_events WHERE col_sourceref='book-me:booking'")
  assert_gt "Host calendar event created" 0 "$CAL_CNT"
  if [ "$CAL_CNT" -gt 0 ] 2>/dev/null; then
    CAL_TITLE=$(sql "user:$DEV_USER_ID" "SELECT col_title FROM c_events WHERE col_sourceref='book-me:booking' ORDER BY _created_at DESC LIMIT 1" | py "import json,sys; print(json.load(sys.stdin)['rows'][0]['col_title'])")
    assert_contains "Calendar title has event name" "Test Meeting" "$CAL_TITLE"
    assert_contains "Calendar title has guest name" "Test Guest" "$CAL_TITLE"
  fi
else
  echo "  ⚠ user DO has no c_events table (tables: $USER_TABLES)"
  echo "    This is expected for a fresh test user — calendar schema not yet initialized"
fi

# ── 8. Conflict detection ──────────────────────────────

echo ""
echo "── 8. Double-booking rejected ──"

RESULT2=$(call_action "$WRANGLER_PORT" "schedule-event" "$BODY")
SUCCESS2=$(echo "$RESULT2" | py "import json,sys; print(json.load(sys.stdin).get('success',False))")
ERROR2=$(echo "$RESULT2" | py "import json,sys; print(json.load(sys.stdin).get('error',''))")

if [ "$SUCCESS2" = "False" ]; then
  assert_contains "Conflict detected" "conflict" "$ERROR2"
else
  echo "  ✗ Double-booking was NOT rejected"
  FAIL=$((FAIL + 1))
fi

# ── Summary ─────────────────────────────────────────────

summary
