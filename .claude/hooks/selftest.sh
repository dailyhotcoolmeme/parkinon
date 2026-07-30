#!/bin/bash
# 차단기 자체 점검 — 막아야 할 것을 막고, 막으면 안 되는 것은 통과시키는지 본다.
#
#   bash .claude/hooks/selftest.sh
#
# 테스트 문자열을 여기 파일에 두는 이유: 명령줄에 그대로 쓰면 차단기가 그 문자열에
# 반응해 점검 자체가 막힌다(실제로 두 번 막혔다).
cd "$(dirname "$0")/../.." || exit 1
export CLAUDE_PROJECT_DIR="$PWD"
GUARD=".claude/hooks/scope-guard.sh"

run() { # run <기대코드> <설명> <명령문자열>
  local want="$1" desc="$2" cmd="$3" got
  printf '{"tool_input":{"command":%s}}' "$(python3 -c 'import json,sys;print(json.dumps(sys.argv[1]))' "$cmd")" \
    | bash "$GUARD" >/dev/null 2>&1
  got=$?
  if [ "$got" = "$want" ]; then printf '  ✅ %s\n' "$desc"
  else printf '  ❌ %s  (기대 %s, 실제 %s)\n' "$desc" "$want" "$got"; FAILED=1; fi
}

FAILED=0
echo "── 막아야 하는 것"
run 2 "시뮬레이터 실행"      "xcrun simctl launch booted com.ourmine.parkinon"
run 2 "검수 순회 실행"        "QA_PASSWORD=x node scripts/qa-run.mjs fr"
run 2 "OTA 배포"              "npx eas update --branch production --message x"
run 2 "원격 푸시"             "git push origin main"
run 2 "Edge Function 배포"    "supabase functions deploy send-medication-reminders"
run 2 "운영 DB 변경"          "curl -X PATCH https://avqaflxufyadgzjiojkk.supabase.co/rest/v1/users -d '{}'"

echo "── 통과해야 하는 것"
run 0 "리포트 출력"           "node scripts/qa-report.mjs fr"
run 0 "타입 검사"             "npx tsc --noEmit"
run 0 "커밋(메시지에 단어 포함)" 'git commit -m "docs: git push 와 eas update 는 배포다"'
run 0 "DB 조회"               "curl https://avqaflxufyadgzjiojkk.supabase.co/rest/v1/users?select=id"
run 0 "일반 조회"             "grep -rn simctl launch docs/"

exit $FAILED
