import { useRef } from 'react';
import { Animated, PanResponder } from 'react-native';

interface Options {
  /**
   * 아래로 끌어내린 거리(px)가 이 값을 넘으면 닫힘.
   * 60대 손떨림 고려해 기본값을 넉넉하게 둠 (작은 떨림으로 닫히지 않도록).
   */
  distanceThreshold?: number;
  /**
   * 빠르게 튕기듯 내릴 때의 속도 임계값(px/ms).
   * 거리 임계값 미달이어도 속도가 충분히 빠르면 닫힘.
   */
  velocityThreshold?: number;
  /**
   * 닫힘 애니메이션이 향할 translateY 목표값.
   * 보통 카드/시트 높이보다 크게 (화면 밖으로) 두면 자연스럽다.
   */
  closeTo?: number;
}

/**
 * 공용 스와이프-다운 닫기 훅.
 *
 * PanResponder 기반으로 아래로 일정 거리/속도 스와이프 시 onDismiss를 호출한다.
 * Animated translateY 값과 panHandlers를 반환하므로,
 *   <Animated.View style={{ transform: [{ translateY }] }} {...panHandlers}>
 * 형태로 카드/바텀시트에 그대로 붙이면 된다.
 *
 * 메모리 규칙 "모든 팝업 스와이프 다운 닫기 필수(PanResponder 공용 훅)" 충족용 재사용 훅.
 * 60대 손떨림을 고려해 임계값을 작지 않게(기본 거리 90px) 설정한다.
 *
 * @param onDismiss 닫힘 조건 충족 시 호출 (배경탭/백버튼과 동일 핸들러 사용 권장)
 */
export function useSwipeDownDismiss(onDismiss: () => void, options: Options = {}) {
  const {
    distanceThreshold = 90,
    velocityThreshold = 0.6,
    closeTo = 700,
  } = options;

  const translateY = useRef(new Animated.Value(0)).current;
  // stale-closure 방지: 최신 onDismiss를 ref로 들고 PanResponder는 1회만 생성
  const dismissRef = useRef(onDismiss);
  dismissRef.current = onDismiss;

  const panResponder = useRef(
    PanResponder.create({
      // 세로 아래 방향 제스처가 명확할 때만 활성화 (가로 스크롤/탭과 충돌 방지)
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        // 위로는 따라가지 않음 (아래로만 끌림)
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        const shouldDismiss =
          gs.dy > distanceThreshold || gs.vy > velocityThreshold;
        if (shouldDismiss) {
          Animated.timing(translateY, {
            toValue: closeTo,
            duration: 200,
            useNativeDriver: true,
          }).start(() => {
            // 다음 오픈을 위해 위치 초기화 후 콜백
            translateY.setValue(0);
            dismissRef.current();
          });
        } else {
          // 임계값 미달 → 제자리 복귀 (스프링)
          Animated.spring(translateY, {
            toValue: 0,
            useNativeDriver: true,
          }).start();
        }
      },
      onPanResponderTerminate: () => {
        Animated.spring(translateY, {
          toValue: 0,
          useNativeDriver: true,
        }).start();
      },
    }),
  ).current;

  /** 외부에서 강제로 위치를 리셋해야 할 때 (예: visible 재오픈 시) */
  const resetPosition = () => translateY.setValue(0);

  return { translateY, panHandlers: panResponder.panHandlers, resetPosition };
}
