import { useState, useEffect, useCallback } from 'react';
import { AppState, Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';

/**
 * 알림 권한 강제 게이트의 "실제 권한 상태".
 * - 'checking': 권한 조회 중 (게이트를 절대 보여주지 않고 로딩 화면을 보여줄 것)
 * - 'granted' : 권한 허용됨 → 게이트 통과(앱 정상 진입)
 * - 'blocked' : 권한 미허용 → (안드)하드 블록 / (iOS)소프트 안내
 *
 * ⚠️ 이 값은 "실제 OS 알림 권한"을 그대로 반영한다. iOS 소프트 게이트에서
 *    "나중에" 로 통과(skipped)하더라도 권한을 안 줬으면 state 는 계속 'blocked' 다.
 *    → 푸시 로직이 게이트 통과를 권한 허용으로 오인하지 않도록 둘을 분리한다.
 */
export type NotifGateState = 'checking' | 'granted' | 'blocked';

// iOS 소프트 게이트 "나중에 할게요" 선택 영속 키.
// 매 진입마다 강제로 또 뜨지 않도록 1회 선택을 저장한다(안드는 사용 안 함 — 하드 블록).
const SKIP_KEY = 'notif_gate_skipped_ios';

/**
 * 알림 권한을 강제/유도하는 게이트 훅. (플랫폼별 분기)
 *
 * - enabled 가 false면 아무 것도 하지 않는다(로그인/온보딩 중에는 게이트를 돌리지 않음).
 * - check(): 현재 권한을 조회해 granted/blocked 로 분기. canAskAgain 으로 OS 다이얼로그
 *   재요청 가능 여부를 노출(안드 "다시 묻지 않음" 영구 거부 구분).
 * - 예기치 못한 오류(또는 iOS 환경 차이)에서는 FAIL OPEN → 'granted' 로 처리해
 *   사용자를 절대 잠그지 않는다.
 * - AppState 'active' 복귀 시마다 재검사 → 설정에서 알림을 켜고 돌아오면 자동 통과.
 *
 * 플랫폼 분기:
 * - Android(canSkip=false): 하드 블록. 권한 허용 전까지 진입 불가(skip 개념 없음).
 * - iOS(canSkip=true): 소프트. 같은 안내는 보여주되 "나중에 할게요"(skip)로 진입 가능.
 *   애플 심사 정책상 알림 권한을 앱 이용 필수로 강제할 수 없음. skip 은 영속 저장되어
 *   매 진입마다 다시 막지 않는다(granted 면 어차피 안 뜸).
 */
export function useNotificationGate(enabled: boolean): {
  state: NotifGateState;
  canAskAgain: boolean;
  /** iOS 소프트 게이트 여부(=Platform.OS === 'ios'). true면 "나중에" 버튼 노출/스킵 허용. */
  canSkip: boolean;
  /** 사용자가 이미 "나중에"로 게이트를 건너뛰었는지(이번/이전 세션 포함). iOS 전용 의미. */
  skipped: boolean;
  /** iOS 소프트 게이트 건너뛰기(영속 저장 후 통과). 안드에서는 호출하지 않는다. */
  skip: () => void;
  recheck: () => void;
} {
  const canSkip = Platform.OS === 'ios';
  const [state, setState] = useState<NotifGateState>('checking');
  const [canAskAgain, setCanAskAgain] = useState(true);
  const [skipped, setSkipped] = useState(false);

  const check = useCallback(async () => {
    try {
      const perm = await Notifications.getPermissionsAsync();
      if (perm.status === 'granted') {
        setState('granted');
      } else {
        setCanAskAgain(perm.canAskAgain);
        setState('blocked');
      }
    } catch {
      // FAIL OPEN — 예기치 못한 오류/iOS 환경 차이로 사용자를 잠그지 않는다.
      setState('granted');
    }
  }, []);

  const skip = useCallback(() => {
    // 실제 권한 상태(state)는 건드리지 않는다 — "건너뜀"과 "허용"은 별개.
    setSkipped(true);
    AsyncStorage.setItem(SKIP_KEY, '1').catch(() => {});
  }, []);

  useEffect(() => {
    if (!enabled) return;
    let mounted = true;
    const init = async () => {
      // iOS: 이전에 "나중에"로 건너뛴 적이 있으면 복원해 매 진입 강제 노출을 막는다.
      // (state 가 'checking' 인 동안 처리하므로 게이트가 잠깐 깜빡이지 않음.)
      if (canSkip) {
        try {
          const v = await AsyncStorage.getItem(SKIP_KEY);
          if (mounted && v === '1') setSkipped(true);
        } catch {
          // 무시 — 못 읽으면 그냥 게이트를 보여준다(소프트라 진입은 막지 않음).
        }
      }
      if (mounted) await check();
    };
    init();
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') check();
    });
    return () => {
      mounted = false;
      sub.remove();
    };
  }, [enabled, check, canSkip]);

  return { state, canAskAgain, canSkip, skipped, skip, recheck: check };
}
