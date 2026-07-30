#!/bin/bash
# 지시 범위 밖 행동 차단기.
#
# 왜 있나: 2026-07-30, "케이스를 정리하라"는 지시를 받고 정리까지 한 뒤
# 확인해보고 싶어서 앱을 실행하고, 거기서 발견한 버그까지 고쳤다. 지시받지 않은 일이다.
# 같은 일이 반복되므로 말로 지키지 않고 여기서 막는다.
#
# 실행·배포처럼 "지시가 있어야만 하는" 행동은 .claude/allowed-actions 에 해당 태그가
# 적혀 있을 때만 통과한다. 태그를 추가하는 것은 오너 지시가 있을 때만 한다.
#
# 매칭은 "명령 위치"에서만 한다 — 문서나 커밋 메시지 안에 든 같은 글자에 반응하면
# 멀쩡한 작업이 막힌다(첫 판에서 실제로 그랬다: 커밋 메시지의 단어에 걸려 커밋이 막혔다).

INPUT=$(cat)
CMD=$(printf '%s' "$INPUT" | python3 -c 'import json,sys;print(json.load(sys.stdin).get("tool_input",{}).get("command",""))' 2>/dev/null)
[ -z "$CMD" ] && exit 0

ALLOW_FILE="${CLAUDE_PROJECT_DIR:-.}/.claude/allowed-actions"
allowed() { [ -f "$ALLOW_FILE" ] && grep -qx "$1" "$ALLOW_FILE"; }

# 명령 시작 위치(줄머리 · ; · && · || · | · 서브셸) 뒤에 오는 것만 실제 실행으로 본다.
# 앞에 붙는 환경변수 대입(FOO=bar node ...)과 실행기(npx/node ...)는 건너뛴다.
HEAD='(^|[;&|(]|&&|\|\|)[[:space:]]*([A-Za-z_][A-Za-z0-9_]*=[^[:space:]]*[[:space:]]+)*(sudo[[:space:]]+)?((npx|yarn|pnpm|node)[[:space:]]+)*'

matches() { printf '%s' "$CMD" | grep -Eq "$HEAD$1"; }

block() {
  echo "⛔ 지시 범위 밖 행동입니다: [$1]" >&2
  echo "   $2" >&2
  echo "   오너 지시가 있으면 .claude/allowed-actions 에 '$1' 을 추가한 뒤 실행하십시오." >&2
  exit 2
}

# 앱·시뮬레이터 실행, 검수 순회 — "만들라"는 지시에 실행은 포함되지 않는다.
if matches 'xcrun[[:space:]]+simctl[[:space:]]+(launch|boot)' \
  || matches 'expo[[:space:]]+run:' \
  || matches 'eas[[:space:]]+build' \
  || matches '[^[:space:]]*scripts/qa-(run|collector)\.mjs'; then
  allowed run-app || block run-app "앱/시뮬레이터를 실행하거나 검수를 돌리는 명령입니다."
fi

# 배포 — 검증과 오너 확인 뒤에만(규칙 E5).
if matches 'eas[[:space:]]+update' \
  || matches 'supabase[[:space:]]+functions[[:space:]]+deploy' \
  || matches 'wrangler[[:space:]]+pages[[:space:]]+deploy' \
  || matches 'git[[:space:]]+push'; then
  allowed deploy || block deploy "배포/푸시 명령입니다."
fi

# 운영 DB 쓰기 — 조회는 자유, 변경은 지시가 있어야 한다.
if printf '%s' "$CMD" | grep -Eq 'supabase\.co/(rest|auth/v1/admin)' \
  && printf '%s' "$CMD" | grep -Eq '\-X[[:space:]]+(POST|PATCH|PUT|DELETE)'; then
  allowed db-write || block db-write "운영 DB 를 변경하는 요청입니다."
fi

exit 0
