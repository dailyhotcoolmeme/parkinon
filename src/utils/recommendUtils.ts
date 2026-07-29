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
import i18n from '../i18n';
import { isOverseasLocale } from '../i18n/detectLocale';


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
      noteSet.add((isOverseasLocale() && rec.noteEn) ? rec.noteEn : rec.note);
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

/** 슬롯 단위 안내용 입력 약 항목 (복용 시각에 묶인 약) */
export type SlotMedInput = { name: string; mfdsClassName?: string | null };

/**
 * 추천근거 = "출처 표기" 한 줄(§7.5).
 *
 * 오너 확정: 추천근거 자리는 약효를 구구절절 설명하는 문장(rationale)이 아니라,
 * "이 정보가 어디서 온 근거인지"를 밝히는 짧은 출처 한 줄이다.
 *
 * 데이터 정직성(사칭 금지·§7.5 출처 검증 완료): 약효 발현·지속 시간 수치는 미국 FDA 제품
 * 허가정보(제품 라벨)와 제조사 제품정보(SmPC)로 검증됐다. 한국 식약처 원문 PK 는 직접 확보하지
 * 못했으므로 "식약처 기준"으로 단독 표기하지 않는다(부정확·사칭). 검증된 1차 근거만 표기한다.
 *
 * ⚠️ 출처 범위 주의(오인 금지): 이 출처는 "약효 시간(발현·지속) 정보"의 근거다.
 * "복용 후 30분·2시간 확인"이라는 추적 시점 자체를 FDA 가 권고한 것은 아니며,
 * 그 약효 시간을 바탕으로 앱이 안내하는 참고 시점이다(면책 줄에서 명시).
 *
 * 문구(오케스트레이터가 오너에게 선택받음 — 둘 다 같은 SOURCE_LABEL 값 사용):
 *   라벨 A: '추천근거: ' + SOURCE_LABEL
 *   라벨 B: '약효 시간 출처: ' + SOURCE_LABEL
 * UI 는 'recommendUtils.SOURCE_LABEL' 만 보면 된다(60대 일반어·전문어 "약동학" 제거).
 */
export function getSourceLabel(): string {
  return isOverseasLocale() ? 'US FDA & manufacturer drug information' : '미국 FDA·제조사 의약품 정보';
}

/** 슬롯 단위 안내 결과 (DoseSlotSetList 박스2 안내 렌더용 — §7.3·"슬롯 단위 안내" 절) */
export type SlotRecommendation = {
  /** 이 슬롯에 등록된 약이 1개 이상인가 */
  hasMeds: boolean;
  /** 레보도파 계열로 판정된 약명 목록(중복 제거, 등록 순서 유지) */
  levodopaNames: string[];
  /** 레보도파 계열 union 권장 시점(분, 중복 제거·오름차순). 레보도파 0개면 빈 배열 */
  offsets: number[];
  /**
   * 추천근거 "출처 표기" 한 줄(§7.5). 레보도파 약이 1개 이상이면 SOURCE_LABEL,
   * 없으면 빈 문자열. 약효 설명 문장(rationale)은 더 이상 쓰지 않는다.
   */
  source: string;
};

/**
 * 한 복용 시각(슬롯)에 묶인 약 목록 → 슬롯 단위 안내 데이터(§3-A, §6 union 로직 재사용).
 *
 * - 레보도파 계열(IR/CR/복합제) 약만 추려 약명 수집 + offsets union(중복 제거·정렬).
 *   판정·union 은 buildRecommendedMedNotifs 와 동일 규칙(recommendUtils 단일 출처).
 * - 비레보도파/매칭 실패 약은 offsets 에 기여하지 않으며 안내 분기는 호출측(UI)이
 *   hasMeds & offsets.length 로 판단한다(레보도파 있음 / 약은 있으나 비레보도파 / 약 없음).
 *
 * 안내(표시)만을 위한 순수 헬퍼다 — track_intervals 값을 바꾸지 않는다(비강제 — §3-C).
 */
export function recommendForSlotMeds(meds: SlotMedInput[]): SlotRecommendation {
  const list = meds ?? [];
  const offsetSet = new Set<number>();
  const levodopaNames: string[] = [];
  const seenName = new Set<string>();

  for (const med of list) {
    const rec = resolveTrackingRecommendation(med.name, med.mfdsClassName ?? undefined);
    if (rec?.active) {
      for (const o of rec.offsets) offsetSet.add(o);
      const nm = (med.name ?? '').trim();
      if (nm && !seenName.has(nm)) {
        seenName.add(nm);
        levodopaNames.push(nm);
      }
    }
  }

  return {
    hasMeds: list.length > 0,
    levodopaNames,
    offsets: Array.from(offsetSet).sort((a, b) => a - b),
    // 추천근거 = 출처 표기 한 줄. 레보도파 약이 있을 때만 노출(없으면 빈 문자열).
    source: levodopaNames.length > 0 ? getSourceLabel() : '',
  };
}
