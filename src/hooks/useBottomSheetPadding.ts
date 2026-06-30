import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * 바텀시트·화면 하단 고정 버튼이 **안드로이드 3버튼 내비게이션**(또는 iOS 홈 인디케이터)에
 * 가려 잘리는 문제를 막기 위한 하단 패딩 계산 훅.
 *
 * 글로벌 규칙(오너 확정): 모든 바텀시트/하단 버튼 컨테이너의 paddingBottom 은 반드시
 * 이 훅 값을 사용한다. 하드코딩(예: paddingBottom: 32)만 두면 3버튼 내비에서 잘린다.
 *
 * @param base 디자인상 기본 하단 여백(px). 내비가 없는 기기에서의 최소 여백.
 * @param buffer 안전영역 위에 더하는 여유 버퍼(px). 기본 16. 버튼을 더 바닥에 붙이고 싶을 때만 낮춘다(안전영역 자체는 항상 보장되므로 잘림 없음).
 * @returns max(base, safeArea.bottom + buffer) — paddingBottom 에 그대로 사용.
 */
export function useBottomSheetPadding(base = 24, buffer = 16): number {
  const insets = useSafeAreaInsets();
  return Math.max(base, insets.bottom + buffer);
}
