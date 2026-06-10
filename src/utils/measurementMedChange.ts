// 디지털 바이오마커 MVP-A Phase 3 — 약 변경 감지(baseline reset 비강제 제안용)
//
// 사양: docs/digital_biomarker_mvpA_spec.md §6.2 (자동 reset 금지, 비강제 다이얼로그)
// 약효추적 추천 기능 §13-6 sourceMedSignature 패턴 재사용
// (buildSourceMedSignature는 medNotifRecommendationMeta.ts의 것을 그대로 사용).
//
// AsyncStorage 키:
//  - measurement_baseline_med_signature_v1: 마지막으로 본 환자 약 시그니처
//  - measurement_baseline_reset_at_v1: 사용자가 "새 기준으로 시작"을 선택한 시각(ISO)
//
// 다이얼로그 노출 조건(결과 화면 진입 시):
//  - 현재 환자 활성 약 시그니처가 비어있지 않고
//  - 저장된 시그니처가 존재하며 다르고
//  - baseline_stats.n >= 14 (학습 완료) — 학습 미완료면 자동으로 sliding window가 새 데이터로 채워가므로 다이얼로그 불필요
//  → "약이 바뀌었어요. 측정 기준을 새로 잡을까요?" 비강제 제안

import AsyncStorage from '@react-native-async-storage/async-storage';
import { supabase } from '../lib/supabase';
import {
  buildSourceMedSignature,
  type SignatureMedInput,
} from './medNotifRecommendationMeta';

export const MEASUREMENT_BASELINE_MED_SIG_KEY =
  'measurement_baseline_med_signature_v1';
export const MEASUREMENT_BASELINE_RESET_AT_KEY =
  'measurement_baseline_reset_at_v1';

/**
 * 환자(=user)의 현재 활성 약 목록으로 시그니처 계산.
 * 약 0개면 빈 문자열 반환 → 호출 측에서 다이얼로그 노출 스킵 처리.
 */
export async function computeCurrentMedSignature(
  patientUserId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('medications')
    .select('name, dosage')
    .eq('patient_id', patientUserId)
    .eq('is_active', true);

  if (error) {
    // 조회 실패 시 시그니처 변동으로 오탐하지 않도록 빈 문자열 — 호출 측에서 스킵.
    console.warn('[measurementMedChange] medications 조회 실패:', error);
    return '';
  }

  const meds: SignatureMedInput[] = (data ?? []).map((m) => ({
    name: m.name,
    dosage: m.dosage,
  }));
  return buildSourceMedSignature(meds);
}

/** 저장된 마지막 시그니처 읽기. 없으면 null. */
export async function readLastMedSignature(): Promise<string | null> {
  try {
    const v = await AsyncStorage.getItem(MEASUREMENT_BASELINE_MED_SIG_KEY);
    return v ?? null;
  } catch (e) {
    console.warn('[measurementMedChange] 시그니처 읽기 오류:', e);
    return null;
  }
}

/** 시그니처 저장(다이얼로그 반복 노출 방지) */
export async function writeLastMedSignature(sig: string): Promise<void> {
  try {
    await AsyncStorage.setItem(MEASUREMENT_BASELINE_MED_SIG_KEY, sig);
  } catch (e) {
    console.warn('[measurementMedChange] 시그니처 저장 오류:', e);
  }
}

/** reset 시각 마킹(분석/디버깅용) */
export async function markBaselineResetAt(iso?: string): Promise<void> {
  try {
    await AsyncStorage.setItem(
      MEASUREMENT_BASELINE_RESET_AT_KEY,
      iso ?? new Date().toISOString()
    );
  } catch (e) {
    console.warn('[measurementMedChange] reset 시각 저장 오류:', e);
  }
}
