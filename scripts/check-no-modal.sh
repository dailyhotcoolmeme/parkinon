#!/bin/sh
# RN <Modal> 재유입 차단.
#
#   RN <Modal> 은 별도 네이티브 창이라 두 가지가 동시에 깨진다.
#     (1) 그 위에서 화면을 옮겨도 모달이 계속 덮어 "아무 반응 없음"으로 보인다
#     (2) 다른 모달과 겹치면 iOS 에서 둘 다 닫히지 않고 굳는다
#   화면을 덮어야 하면 src/components/common/OverlaySheet 를 쓸 것.
#
# 주석(// * {/* )은 제외하고, 실제 JSX 사용만 잡는다.
HITS=$(grep -rn "<Modal" src/ 2>/dev/null \
  | grep -v "OverlaySheet.tsx" \
  | awk -F: '{ line=$0; sub(/^[^:]*:[0-9]*:/, "", line); gsub(/^[ \t]+/, "", line);
              if (line !~ /^(\/\/|\*|\{\/\*)/) print }')
if [ -n "$HITS" ]; then
  echo "❌ RN <Modal> 이 다시 들어왔습니다. OverlaySheet 를 쓰세요."
  echo "$HITS"
  exit 1
fi
echo "✅ RN <Modal> 없음"
