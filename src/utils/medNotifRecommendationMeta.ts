/**
 * 약효추적 알림 추천 메타 (AsyncStorage 'med_notif_recommendation_meta') 공용 헬퍼
 *
 * 사양 단일 진실 소스: docs/med_effect_tracking_recommendation_spec.md (§8.1, §13-6, §3-C)
 *
 * Phase 2(NotificationSetupScreen)에서 이미 다음 평면 구조로 저장한다:
 *   { recommendedFromClasses, userEdited, lastAppliedAt }
 * Phase 3-4에서 약/용량 변경 감지를 위해 `sourceMedSignature` 를 확장 추가한다.
 * 기존 Phase 2 키/구조와 정합을 유지하며(중복 정의·불일치 금지), 본 모듈을
 * 단일 진입점으로 사용한다.
 *
 * 순수 TS — 화면/네이티브/서버 함수에 의존하지 않는다. 서버 푸시 경로 무관.
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { DrugClass } from '../constants/medEffectProfiles';

export const MED_NOTIF_RECOMMENDATION_META_KEY = 'med_notif_recommendation_meta';

/** AsyncStorage 'med_notif_recommendation_meta' 구조 (§8.1) */
export type MedNotifRecommendationMeta = {
  /** 추천 출처 분류 (재추천 판단·UI 안내용) — Phase 2 호환 */
  recommendedFromClasses: DrugClass[];
  /** 사용자가 약효추적 시점을 한 번이라도 직접 수정했는가 (§3-C 핵심 플래그) — Phase 2 호환 */
  userEdited: boolean;
  /** 마지막 추천 적용 시각(ISO) — Phase 2 호환 */
  lastAppliedAt?: string;
  /**
   * 추천 산출에 쓰인 약 식별 키(성분/분류 + 용량) 시그니처 — 약/용량 변경 감지(§3-C, §13-6).
   * Phase 2 메타에는 없을 수 있음(undefined 허용 → 첫 변경 감지 시 채워짐).
   */
  sourceMedSignature?: string;
};

/** 추천 메타 읽기. 없거나 파싱 실패 시 null. */
export async function getRecommendationMeta(): Promise<MedNotifRecommendationMeta | null> {
  try {
    const raw = await AsyncStorage.getItem(MED_NOTIF_RECOMMENDATION_META_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MedNotifRecommendationMeta>;
    return {
      recommendedFromClasses: Array.isArray(parsed.recommendedFromClasses)
        ? (parsed.recommendedFromClasses as DrugClass[])
        : [],
      userEdited: parsed.userEdited === true,
      lastAppliedAt: parsed.lastAppliedAt,
      sourceMedSignature: parsed.sourceMedSignature,
    };
  } catch (e) {
    console.warn('[medNotifRecommendationMeta] read error:', e);
    return null;
  }
}

/**
 * 추천 메타 부분 갱신(merge). 기존 값 위에 patch 만 덮어쓴다.
 * Phase 2 호환 키를 보존하기 위해 항상 read→merge→write.
 */
export async function patchRecommendationMeta(
  patch: Partial<MedNotifRecommendationMeta>
): Promise<void> {
  try {
    const prev = (await getRecommendationMeta()) ?? {
      recommendedFromClasses: [],
      userEdited: false,
    };
    const next: MedNotifRecommendationMeta = { ...prev, ...patch };
    await AsyncStorage.setItem(
      MED_NOTIF_RECOMMENDATION_META_KEY,
      JSON.stringify(next)
    );
  } catch (e) {
    console.warn('[medNotifRecommendationMeta] update error:', e);
  }
}

/**
 * 사용자 수동 수정 마킹 (§13-6 — userEdited 트리거).
 * 추천 적용·온보딩 경로의 setMedNotifs 가 아닌, 사용자가 약효추적 알림을
 * 직접 토글/추가/수정/삭제한 핸들러에서만 호출한다.
 *
 * 메타가 아직 없으면(추천 적용 전 사용자가 수동 변경) 메타를 새로 만들어
 * userEdited=true 로 기록한다 — 이후 재추천 보존 규칙이 동일하게 적용된다.
 */
export async function markMedNotifUserEdited(): Promise<void> {
  await patchRecommendationMeta({ userEdited: true });
}

/** 약/용량 변경 감지용 입력 약 항목 */
export type SignatureMedInput = {
  name: string;
  /** 식약처 분류명(있으면 시그니처 정확도 보강 — §13-5 한계 공유) */
  className?: string | null;
  /** 복용량(오너 확정: 용량 변경도 재추천 대상) */
  dosage?: string | null;
};

/** 정규화: 소문자 + 공백 제거 (recommendUtils.normalize 와 동일 규칙) */
function norm(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 현재 등록 약들의 (성분/분류 + 용량) 시그니처 문자열 산출 (§8.1, §13-6).
 *
 * - 각 약을 `이름@용량|분류` 형태로 정규화 → 정렬 → join.
 * - 약 추가/삭제/계열·제형 변경(이름·분류 변화) + 복용량 변경(용량 변화) 모두 반영.
 * - 결정적(순서 무관) — 정렬 후 join 하므로 등록 순서 차이로 오탐 안 함.
 */
export function buildSourceMedSignature(meds: SignatureMedInput[]): string {
  return (meds ?? [])
    .map((m) => `${norm(m.name)}@${norm(m.dosage)}|${norm(m.className)}`)
    .filter((s) => s !== '@|') // 빈 항목 제거
    .sort()
    .join('||');
}
