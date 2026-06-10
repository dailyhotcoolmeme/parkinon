// 디지털 바이오마커 MVP-A Phase 1 — 측정 동의 확인 헬퍼
// AsyncStorage 키 measurement_consent_v1 확인 + 미동의 시 ConsentScreen 진입.
// 게임 화면(Phase 2)에서 측정 진입 직전에 호출.

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NavigationProp, ParamListBase } from '@react-navigation/native';

/** ConsentScreen 동의 저장 키 */
export const MEASUREMENT_CONSENT_STORAGE_KEY = 'measurement_consent_v1';

/** 동의 화면 라우트 이름 (RootStack에 등록) */
export const CONSENT_ROUTE_NAME = 'MeasurementConsent';

/**
 * 측정 진입 전 동의 확인.
 * - 동의됨: true 반환 → 호출자는 측정 화면으로 진행
 * - 미동의: ConsentScreen으로 네비게이트하고 false 반환
 *
 * Phase 2에서 게임 화면 진입 직전에 호출:
 * ```
 * const ok = await ensureMeasurementConsent(navigation);
 * if (!ok) return;
 * // 측정 화면 진입
 * ```
 */
export async function ensureMeasurementConsent(
  navigation: NavigationProp<ParamListBase>
): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(MEASUREMENT_CONSENT_STORAGE_KEY);
    if (v === 'true') return true;
  } catch (e) {
    console.warn('[measurementConsent] AsyncStorage 조회 실패:', e);
    // 실패 시 안전하게 동의 화면을 한 번 더 보여준다
  }
  navigation.navigate(CONSENT_ROUTE_NAME as never);
  return false;
}

/**
 * 현재 동의 상태만 조회 (네비게이션 부작용 없음).
 * UI에서 "동의 완료" 배지 표시 등 보조 용도.
 */
export async function isMeasurementConsented(): Promise<boolean> {
  try {
    const v = await AsyncStorage.getItem(MEASUREMENT_CONSENT_STORAGE_KEY);
    return v === 'true';
  } catch {
    return false;
  }
}
