// AdMob 앱 ID · 광고단위(네이티브) ID — 오너가 2026-07-07 발급·전달한 실 ID.
// ⚠️ 이 값들은 확정본이다. 절대 오너에게 다시 묻지 말 것. 새 배치가 생기면 그때 추가만 한다.
// 개발/디버그 빌드에서는 절대 실 ID를 요청하지 말 것(자기 광고 클릭 = 계정 정지 사유) →
//   __DEV__ 에서는 구글 테스트 네이티브 ID를 쓴다(아래 TEST_NATIVE_AD_UNIT_ID).
// 포맷: 모두 네이티브(Native advanced). 전면/앱오픈은 이번 범위 밖.
// 웹 배너(parkinon-web)는 AdMob이 아니라 AdSense 별도 스택 → 여기 없음.

import { Platform } from 'react-native';

/** AdMob 앱 ID (app.json GADApplicationIdentifier 에 들어가는 값, '~' 구분자) */
export const ADMOB_APP_ID = {
  android: 'ca-app-pub-2792582436871752~4028284031',
  ios: 'ca-app-pub-2792582436871752~9641708372',
} as const;

/** 인앱 네이티브 광고 배치 6곳 */
export type AdPlacement =
  | 'medication'          // 약복용 탭 — 오늘 기록 첫 슬롯 자리
  | 'bodyState'           // 몸상태 탭 — 첫 슬롯 자리
  | 'exercise'            // 운동 탭 — 첫 슬롯 자리
  | 'remindersMeds'       // Reminders → 약 관리 — 처방전 등록 버튼 아래
  | 'remindersDoseTimes'  // Reminders → 복용시간·알림 — 슬롯 1·2 사이
  | 'more';               // More 메뉴 — 섹션 1·2 사이

const AD_UNIT_ANDROID: Record<AdPlacement, string> = {
  medication: 'ca-app-pub-2792582436871752/7236825329',
  bodyState: 'ca-app-pub-2792582436871752/3846456213',
  exercise: 'ca-app-pub-2792582436871752/9671416975',
  remindersMeds: 'ca-app-pub-2792582436871752/8068736862',
  remindersDoseTimes: 'ca-app-pub-2792582436871752/4021680648',
  more: 'ca-app-pub-2792582436871752/3106008627',
};

const AD_UNIT_IOS: Record<AdPlacement, string> = {
  medication: 'ca-app-pub-2792582436871752/7290877209',
  bodyState: 'ca-app-pub-2792582436871752/3351632197',
  exercise: 'ca-app-pub-2792582436871752/2838415312',
  remindersMeds: 'ca-app-pub-2792582436871752/1525333648',
  remindersDoseTimes: 'ca-app-pub-2792582436871752/5251001833',
  more: 'ca-app-pub-2792582436871752/9288273594',
};

/**
 * 테스트 광고 강제 플래그.
 * true면 릴리즈 빌드(__DEV__=false)에서도 실 광고 대신 구글 테스트 광고를 띄운다.
 * ⚠️ 내부 테스트 APK 배포 중에는 true(실제 광고 오클릭=계정 정지 방지).
 * ⚠️ Phase 7 실제 스토어 출시 전에 반드시 false 로 바꿀 것.
 */
export const FORCE_TEST_ADS = false;

/** 구글 공식 테스트 네이티브 광고단위 ID (개발용 — 실 ID 대신 __DEV__/FORCE_TEST_ADS 에서 사용) */
export const TEST_NATIVE_AD_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3940256099942544/3986624511',
  android: 'ca-app-pub-3940256099942544/2247696110',
})!;

/** 현재 플랫폼의 배치별 실 광고단위 ID (프로덕션) */
export const AD_UNIT_ID: Record<AdPlacement, string> =
  Platform.OS === 'ios' ? AD_UNIT_IOS : AD_UNIT_ANDROID;

/**
 * 배치별 광고단위 ID를 안전하게 가져온다.
 * 개발 빌드(__DEV__)에서는 항상 테스트 ID를 반환해 실 광고 오클릭을 원천 차단.
 */
export function getAdUnitId(placement: AdPlacement): string {
  if (__DEV__ || FORCE_TEST_ADS) return TEST_NATIVE_AD_UNIT_ID;
  return AD_UNIT_ID[placement];
}
