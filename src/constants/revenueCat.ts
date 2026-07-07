// RevenueCat(구독 결제) SDK 키.
// - 공개 SDK 키(test_/appl_/goog_)는 클라이언트에 심는 용도라 비밀이 아니다(커밋 OK).
//   Secret 키(sk_)는 서버 전용 → 절대 여기 두지 말 것.
// - 현재는 Test Store 키로 개발/검증. 실제 출시 시 아래 prod 키(appl_/goog_)를 채우고
//   Phase 6 재빌드에서 useRevenueCat 초기화가 __DEV__/스토어 여부로 골라 쓴다.
// - RevenueCat SDK(react-native-purchases)는 네이티브 모듈 → Phase 6 재빌드 후 실제 구매 가능.
//   Phase 5(현재)에서는 이 상수만 저장해두고, 결제 흐름 뼈대는 티어 로직으로 대체.

import { Platform } from 'react-native';

/** RevenueCat Test Store 공개 SDK 키 (개발/검증용 — 실제 결제 아님). */
export const REVENUECAT_TEST_KEY = 'test_lJBoBYNBCtwQlFDoNEPVzPrGbXV';

/** 실제 출시용 공개 SDK 키 (스토어 구독상품 생성 후 RevenueCat에서 발급 → 여기 채움). */
export const REVENUECAT_PROD_KEY = {
  ios: '', // appl_... (미발급)
  android: '', // goog_... (미발급)
} as const;

/** Entitlement 식별자 (RevenueCat 대시보드에서 동일하게 생성). */
export const REVENUECAT_ENTITLEMENT_ID = 'premium';

/**
 * 현재 사용할 RevenueCat SDK 키.
 * prod 키가 채워져 있으면 그걸, 아니면 Test Store 키를 쓴다(출시 전까지 Test Store).
 */
export function getRevenueCatKey(): string {
  const prod = Platform.OS === 'ios' ? REVENUECAT_PROD_KEY.ios : REVENUECAT_PROD_KEY.android;
  return prod || REVENUECAT_TEST_KEY;
}
