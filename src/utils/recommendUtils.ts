/**
 * 약효추적 시간 추천 엔진 (Phase 1 — 큐레이션 기반 순수 로직)
 *
 * 사양 단일 진실 소스: docs/med_effect_tracking_recommendation_spec.md (§4, §5, §6, §3-A)
 *
 * 본 모듈은 순수 TS다. 화면/네이티브/서버 함수에 의존하지 않으며,
 * 추천 결과를 SettingsContext 의 MedNotif[] 타입과 호환되는 형태로 산출한다.
 *
 * 의료 안전: 추천은 비강제 "일반 참고 추천"이다. 매칭 실패/레보도파 없음 시 호출측이
 * 기존 DEFAULT_MED_NOTIFS 로 fallback 할 수 있도록 빈 배열 + 명시 플래그를 반환한다.
 */

import {
  CLASS_RECOMMENDATION,
  KEYWORD_TO_CLASS,
  type DrugClass,
  type TrackingRecommendation,
} from '../constants/medEffectProfiles';
// MedNotif 타입은 SettingsContext 단일 정의를 재사용한다(중복 정의 금지).
import type { MedNotif } from '../context/SettingsContext';

/** 키워드 매칭용 정규화: 소문자 + 모든 공백 제거 (§5) */
function normalize(s: string | null | undefined): string {
  return (s ?? '').toLowerCase().replace(/\s+/g, '');
}

/**
 * 약명 + (선택)식약처 CLASS_NAME 으로 파킨슨 약 분류·추천을 판정한다.
 *
 * 판정 순서(§5):
 *  1. 약명/성분 키워드 매칭(KEYWORD_TO_CLASS) — 가장 구체적인 분류 우선(스타레보→CR→IR).
 *     약명 + 식약처 CLASS_NAME 텍스트를 합쳐 정규화 후 부분일치.
 *  2. 매칭 실패 → null 반환(호출측에서 기존 기본값 유지).
 *
 * 식약처 CLASS_NAME 은 정밀도가 낮아 단독 분류 근거로 쓰지 않고, 키워드 매칭의
 * 보조 신호(검색 대상 텍스트)로만 합산한다.
 *
 * @param medName 약명(필수)
 * @param mfdsClassName 식약처 낱알식별 API CLASS_NAME(선택, 보조 신호)
 * @returns 분류 추천 결과 또는 매칭 실패 시 null
 */
export function resolveTrackingRecommendation(
  medName: string,
  mfdsClassName?: string
): TrackingRecommendation | null {
  const haystack = normalize(`${medName ?? ''} ${mfdsClassName ?? ''}`);
  if (!haystack) return null;

  for (const { keywords, cls } of KEYWORD_TO_CLASS) {
    for (const kw of keywords) {
      const nkw = normalize(kw);
      if (nkw && haystack.includes(nkw)) {
        return CLASS_RECOMMENDATION[cls];
      }
    }
  }
  return null;
}

/** buildRecommendedMedNotifs 입력 약 항목 */
export type RecommendMedInput = { name: string; mfdsClassName?: string };

/** buildRecommendedMedNotifs 반환 형태 */
export type RecommendedMedNotifsResult = {
  /**
   * 추천 약효추적 알림(레보도파 계열 union). 비어 있으면 호출측은
   * 기존 DEFAULT_MED_NOTIFS 로 fallback 할 것.
   */
  notifs: MedNotif[];
  /** 추천 산출에 기여한 활성(레보도파) 분류들 — 재추천 판단·UI 안내용 메타 */
  activeClasses: DrugClass[];
  /** 비레보도파(추적 비대상) 약들의 분류별 안내 문구(중복 제거) */
  nonTrackedNotes: string[];
};

/**
 * 여러 약 중 레보도파 계열만 추려 추천 오프셋의 합집합(union)으로 MedNotif[] 를 만든다(§3-A, §6).
 *
 * - 활성(레보도파 IR/CR/복합제) 약들의 offsets 를 union → 중복 제거 → 오름차순 정렬.
 * - 각 오프셋마다 MedNotif 1개 생성: id 는 결정적으로 부여(`rec-<minutes>`),
 *   minutes = 오프셋, enabled = true 기본.
 * - 레보도파 약이 하나도 없으면(전부 비레보도파/매칭 실패) notifs 는 빈 배열.
 *   호출측은 빈 배열을 fallback 신호로 사용한다(기존 DEFAULT_MED_NOTIFS 유지).
 * - 비레보도파(추적 비대상) 약의 note 를 중복 제거해 수집(UI 안내용).
 *
 * 추천은 비강제다 — enabled:true 는 "기본 노출" 의미이며, 자동 강제 적용은 호출측(UI)에서
 * 사용자의 명시적 동작을 거쳐야 한다(§3-B-A, §3-C).
 */
export function buildRecommendedMedNotifs(
  meds: RecommendMedInput[]
): RecommendedMedNotifsResult {
  const offsetSet = new Set<number>();
  const activeClasses: DrugClass[] = [];
  const seenActiveClass = new Set<DrugClass>();
  const noteSet = new Set<string>();

  for (const med of meds ?? []) {
    const rec = resolveTrackingRecommendation(med.name, med.mfdsClassName);
    if (!rec) continue; // 매칭 실패 — 무시(호출측 fallback)

    if (rec.active) {
      for (const o of rec.offsets) offsetSet.add(o);
      if (!seenActiveClass.has(rec.drugClass)) {
        seenActiveClass.add(rec.drugClass);
        activeClasses.push(rec.drugClass);
      }
    } else if (rec.note) {
      // 추적 비대상(비레보도파) — 알림 미생성, 안내 문구만 수집
      noteSet.add(rec.note);
    }
  }

  const notifs: MedNotif[] = Array.from(offsetSet)
    .sort((a, b) => a - b)
    .map((minutes) => ({ id: `rec-${minutes}`, minutes, enabled: true }));

  return {
    notifs,
    activeClasses,
    nonTrackedNotes: Array.from(noteSet),
  };
}
