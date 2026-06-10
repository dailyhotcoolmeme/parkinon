/**
 * doseSlots.ts
 * 복용 슬롯(dose slot) 관련 공용 상수/유틸 — 단일 출처.
 *
 * 약 복용 모델 재설계 4단계(공용 슬롯 소스 통합)의 기반.
 * 기존 8군데에 중복 정의돼 있던 슬롯 상수(SettingsScreen / MealTimeModal /
 * MedicationManageScreen / MedicationScreen / MedicationRegisterScreen /
 * useMedication / medUtils)의 값을 1:1 동일하게 통합한다.
 *
 * ⚠️ 표시(라벨/시간/아이콘/색/이모지)가 바뀌면 안 됨 → 기존 값 그대로 복사.
 *
 * 마이그레이션(20260608010000)이 dose_slots.label 에 '아침/점심/저녁/취침'(한글)을
 * 기록하므로, legacy 슬롯 키(morning/lunch/dinner/bedtime) ↔ label 매핑을 여기서 고정한다.
 */

// ─── legacy 4슬롯 식별자 (기존 MealTime enum과 동일) ──────────────────────────
export type LegacyMealKey = 'morning' | 'lunch' | 'dinner' | 'bedtime';

export const LEGACY_SLOT_ORDER: LegacyMealKey[] = ['morning', 'lunch', 'dinner', 'bedtime'];

/**
 * legacy 슬롯 메타데이터 — 기존 화면 상수들을 통합한 단일 출처.
 * - label: 짧은 한글 라벨 ('아침') — MedicationScreen.DEFAULT_MEAL_TIME_LABELS, SettingsScreen.MED_TIME_SLOTS
 * - korMed: 약 이름 ('아침약') — MedicationManageScreen.TIME_SLOTS, medUtils.mealTimeToKorean
 * - defaultTime: 기본 복용 시각 (HH:MM) — 전 화면 공통 08:00/12:00/18:00/22:00
 * - icon: Ionicons 이름 — MealTimeModal.MEAL_OPTIONS
 * - color: 강조색 — MealTimeModal.MEAL_OPTIONS
 * - emoji: 이모지 — MedicationManageScreen.TIME_SLOTS
 * - bgColor: 카드 배경색 — MedicationManageScreen.TIME_SLOTS
 */
export interface LegacySlotMeta {
  key: LegacyMealKey;
  label: string;
  korMed: string;
  defaultTime: string;
  icon: string;
  color: string;
  emoji: string;
  bgColor: string;
}

export const LEGACY_SLOT_META: Record<LegacyMealKey, LegacySlotMeta> = {
  morning: {
    key: 'morning',
    label: '아침',
    korMed: '아침약',
    defaultTime: '08:00',
    icon: 'sunny-outline',
    color: '#FF9800',
    emoji: '🌅',
    bgColor: '#FFF8E1',
  },
  lunch: {
    key: 'lunch',
    label: '점심',
    korMed: '점심약',
    defaultTime: '12:00',
    icon: 'partly-sunny-outline',
    color: '#4CAF50',
    emoji: '☀️',
    bgColor: '#E8F5E9',
  },
  dinner: {
    key: 'dinner',
    label: '저녁',
    korMed: '저녁약',
    defaultTime: '18:00',
    icon: 'moon-outline',
    color: '#3F51B5',
    emoji: '🌙',
    bgColor: '#E3F2FD',
  },
  bedtime: {
    key: 'bedtime',
    label: '취침',
    korMed: '취침약',
    defaultTime: '22:00',
    icon: 'bed-outline',
    color: '#7C4DFF',
    emoji: '😴',
    bgColor: '#EDE7F6',
  },
};

// ─── label(한글) ↔ legacy key 매핑 ───────────────────────────────────────────
// 마이그레이션이 dose_slots.label 에 쓴 '아침/점심/저녁/취침'과 정확히 일치.
export const LABEL_TO_LEGACY_KEY: Record<string, LegacyMealKey> = {
  아침: 'morning',
  점심: 'lunch',
  저녁: 'dinner',
  취침: 'bedtime',
};

export const LEGACY_KEY_TO_LABEL: Record<LegacyMealKey, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

/**
 * dose_slot.label(있으면) 로 legacy key 역매핑. 매칭 안 되면 null.
 * (사용자 정의 슬롯이거나 라벨이 비표준이면 legacy key 없음 → 시각 기반으로 표시)
 */
export function labelToLegacyKey(label: string | null | undefined): LegacyMealKey | null {
  if (!label) return null;
  return LABEL_TO_LEGACY_KEY[label.trim()] ?? null;
}

// ─── 시각 포맷/정렬 유틸 ──────────────────────────────────────────────────────

/**
 * 'HH:MM' 또는 'HH:MM:SS' → '오전/오후 H:MM' (어르신 친화 한글 표기).
 * 기존 MedicationScreen 의 '오전 8:00' / '오후 12:00' 표기 규칙과 동일.
 */
export function formatSlotTime(hhmm: string | null | undefined): string {
  if (!hhmm) return '';
  const parts = hhmm.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h)) return hhmm;
  const period = h < 12 ? '오전' : '오후';
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;
  const mm = String(m).padStart(2, '0');
  return `${period} ${displayH}:${mm}`;
}

/**
 * 'HH:MM[:SS]' → 자정 기준 분 수 (정렬용). 파싱 실패 시 Infinity(맨 뒤로).
 */
export function slotSortValue(time: string | null | undefined): number {
  if (!time) return Infinity;
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h) || Number.isNaN(m)) return Infinity;
  return h * 60 + m;
}

/**
 * "다음 복용 안내" 라벨 생성 — dose_slot 1건 → "다음 ○○ 복용" 표시 텍스트.
 *
 * 표시 규칙(legacy 동작 보존):
 * - legacyKey 매핑 슬롯(아침/점심/저녁/취침): "다음 아침약 복용" (기존 MEAL_LABELS 와 동일)
 * - 비표준 라벨 슬롯(사용자 정의): 라벨이 있으면 "다음 ○○ 복용", 없으면 시각 기반 "다음 복용 (오전 9:00)"
 *
 * @param legacyKey dose_slot.legacyKey (label 역매핑) 또는 legacy 폴백 키
 * @param label dose_slot.label (한글 라벨, 있으면)
 * @param time 'HH:MM' (legacyKey 없을 때 시각 기반 폴백용)
 */
export function nextDoseLabel(
  legacyKey: LegacyMealKey | null | undefined,
  label: string | null | undefined,
  time: string | null | undefined
): string {
  if (legacyKey) {
    // 기존 4슬롯과 100% 동일: "다음 아침약 복용" 등
    return `다음 ${LEGACY_SLOT_META[legacyKey].korMed} 복용`;
  }
  const trimmed = (label ?? '').trim();
  if (trimmed) return `다음 ${trimmed} 복용`;
  const t = formatSlotTime(time);
  return t ? `다음 복용 (${t})` : '다음 복용';
}

/**
 * 'HH:MM:SS' → 'HH:MM' (DB time 타입은 초까지 올 수 있음).
 */
export function normalizeHhmm(time: string | null | undefined): string {
  if (!time) return '';
  const parts = time.split(':');
  if (parts.length < 2) return time;
  return `${parts[0].padStart(2, '0')}:${parts[1].padStart(2, '0')}`;
}
