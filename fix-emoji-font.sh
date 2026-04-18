#!/bin/bash
# iOS 26.3 시뮬레이터 이모지 폰트 수정 스크립트
# 실행: bash fix-emoji-font.sh

RUNTIME_FONT_DIR="/Library/Developer/CoreSimulator/Volumes/iOS_23D8133/Library/Developer/CoreSimulator/Profiles/Runtimes/iOS 26.3.simruntime/Contents/Resources/RuntimeRoot/System/Library/Fonts/Core"
EMOJI_SRC="/System/Library/Fonts/Apple Color Emoji.ttc"
EMOJI_DST="$RUNTIME_FONT_DIR/AppleColorEmoji.ttc"

echo "iOS 26.3 시뮬레이터 이모지 폰트 수정 스크립트"
echo "========================================"
echo "소스: $EMOJI_SRC"
echo "대상: $EMOJI_DST"
echo ""

if [ -f "$EMOJI_DST" ]; then
  echo "이미 파일이 존재합니다. 덮어쓰기 합니다."
fi

echo "비밀번호를 입력하면 폰트를 복사합니다..."
sudo cp "$EMOJI_SRC" "$EMOJI_DST"

if [ $? -eq 0 ]; then
  echo ""
  echo "완료! 이제 시뮬레이터를 재시작하세요:"
  echo "  xcrun simctl shutdown 1F35261D-BED4-4D29-8717-7FEF11C02465"
  echo "  xcrun simctl boot 1F35261D-BED4-4D29-8717-7FEF11C02465"
else
  echo "오류가 발생했습니다."
fi
