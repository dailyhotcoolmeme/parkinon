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

import i18n from '../i18n';

// 현재 언어가 영어권인지. 한국어(ko)일 때는 아래 라벨/시간대명을 기존과 100% 동일하게 유지한다.
// (이 파일은 여러 화면이 공유하는 순수 함수 모듈이라 useTranslation 대신 i18n.language 로 분기)
function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

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

// 표준 4슬롯 label의 영어 표시명. dose_slots.label 은 DB에 항상 한글("아침" 등)로 저장되므로
// (생성 로케일과 무관), 해외 로케일에서는 화면 표시 직전 이걸로 변환해야 한다.
const LEGACY_LABEL_EN: Record<LegacyMealKey, string> = {
  morning: 'Morning', lunch: 'Lunch', dinner: 'Dinner', bedtime: 'Bedtime',
};

/**
 * dose_slots.label 같은 raw DB 라벨(예: "아침")을 표시용으로 변환.
 * - 표준 4슬롯 라벨이면 해외 로케일에서 영어 이름으로, 국내면 그대로.
 * - 비표준(커스텀) 라벨은 매칭되는 표준 키가 없으므로 그대로 반환
 *   (커스텀 슬롯 라벨은 생성 시점 로케일로 이미 저장돼 있음 — 별도 처리 범위 밖).
 * ⚠️ qSlot.label/jSlot.label 을 화면·알림 문구에 직접 꽂기 전에는 항상 이 함수를 거칠 것.
 */
export function translateRawSlotLabel(rawLabel: string | null | undefined): string | null {
  if (!rawLabel) return null;
  const trimmed = rawLabel.trim();
  if (!trimmed) return null;
  const key = LABEL_TO_LEGACY_KEY[trimmed];
  if (key && isEnLocale()) return LEGACY_LABEL_EN[key];
  return trimmed;
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
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;
  const mm = String(m).padStart(2, '0');
  if (isEnLocale()) {
    const period = h < 12 ? 'AM' : 'PM';
    return `${displayH}:${mm} ${period}`;
  }
  const period = h < 12 ? '오전' : '오후';
  return `${period} ${displayH}:${mm}`;
}

/**
 * 'HH:MM[:SS]' → 시간대 단어. 비표준(추가) 슬롯의 자동 라벨 앞부분.
 * 구간: 새벽(00–04) / 아침(05–10) / 점심(11–13) / 오후(14–17) / 저녁(18–20) / 밤(21–23).
 * 파싱 실패 시 빈 문자열.
 */
// 시간대 구분 기준(오너 확정 2026-06):
//   새벽 0–6 / 아침 6–11 / 점심 11–13 / 오후 13–17 / 저녁 17–21 / 밤 21–24
export function periodWord(time: string | null | undefined): string {
  if (!time) return '';
  const h = parseInt(time.split(':')[0] ?? '', 10);
  if (Number.isNaN(h)) return '';
  if (isEnLocale()) {
    if (h < 6) return 'Early morning';
    if (h < 11) return 'Morning';
    if (h < 13) return 'Midday';
    if (h < 17) return 'Afternoon';
    if (h < 21) return 'Evening';
    return 'Night';
  }
  if (h < 6) return '새벽';
  if (h < 11) return '아침';
  if (h < 13) return '점심';
  if (h < 17) return '오후';
  if (h < 21) return '저녁';
  return '밤'; // 21–23
}

/** 시간대 이모지 — periodWord 와 동일 범위. 슬롯 좌측 이모지 단일 출처. */
export function periodEmoji(time: string | null | undefined): string {
  if (!time) return '🌙';
  const h = parseInt(time.split(':')[0] ?? '', 10);
  if (Number.isNaN(h)) return '🌙';
  if (h < 6) return '🌌';
  if (h < 11) return '🌅';
  if (h < 13) return '☀️';
  if (h < 17) return '🌤️';
  if (h < 21) return '🌆';
  return '🌙';
}

/**
 * 'HH:MM[:SS]' → 비표준(추가) 슬롯 자동 라벨. "[시간대] [12시간 시각]".
 * 예: 09:30 → "아침 9:30", 15:00 → "오후 3:00", 19:00 → "저녁 7:00".
 * 12시간 시각엔 오전/오후 글자 없음(시간대 단어가 그 역할). hour=0→12, 13–23→ -12.
 * 파싱 실패 시 원본 문자열 반환.
 */
export function autoSlotLabel(time: string | null | undefined): string {
  if (!time) return '';
  const parts = time.split(':');
  const h = parseInt(parts[0], 10);
  const m = parseInt(parts[1] ?? '0', 10);
  if (Number.isNaN(h)) return time;
  let displayH = h % 12;
  if (displayH === 0) displayH = 12;
  const mm = String(Number.isNaN(m) ? 0 : m).padStart(2, '0');
  const period = periodWord(time);
  return period ? `${period} ${displayH}:${mm}` : `${displayH}:${mm}`;
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
    if (isEnLocale()) return i18n.t('doseSlots.nextDoseLegacy', { med: i18n.t(`doseSlots.legacyMed_${legacyKey}`) });
    return `다음 ${LEGACY_SLOT_META[legacyKey].korMed} 복용`;
  }
  const trimmed = (label ?? '').trim();
  if (trimmed) return isEnLocale() ? i18n.t('doseSlots.nextDoseLegacy', { med: trimmed }) : `다음 ${trimmed} 복용`;
  const t = formatSlotTime(time);
  if (isEnLocale()) return t ? i18n.t('doseSlots.nextDoseWithTime', { time: t }) : i18n.t('doseSlots.nextDosePlain');
  return t ? `다음 복용 (${t})` : '다음 복용';
}

/**
 * 슬롯의 "이름"(표시명) 단일 출처.
 * - 표준 4슬롯(legacyKey 있음): 라벨 그대로("아침" 등). 시각은 화면이 별도 줄에 표시.
 * - 비표준(추가) 슬롯: label 이 있으면 그 label(이미 "오후 3:00" 형식, 시각 포함).
 *   label 이 비었으면 시각으로 autoSlotLabel 생성.
 *
 * ⚠️ 비표준 슬롯의 label 은 그 자체가 "시간대+시각"이므로, 이름 옆에 시각을
 *    또 붙이면 "오후 3:00 오후 3:00"처럼 중복된다 → labelContainsTime 로 판별해 거른다.
 */
export function slotDisplayName(
  label: string | null | undefined,
  legacyKey: LegacyMealKey | null | undefined,
  time: string | null | undefined
): string {
  if (legacyKey) return LEGACY_KEY_TO_LABEL[legacyKey];
  const trimmed = (label ?? '').trim();
  if (trimmed) return trimmed;
  return autoSlotLabel(time);
}

/**
 * 슬롯의 "전체 표시 제목"(이름 + 시각 인라인) — 설정 화면(DoseSlotSetList)과 복용 시트가
 * 동일하게 보이도록 하는 단일 출처.
 * - 비표준(라벨이 이미 시각 포함): 라벨 그대로("밤 11:00").
 * - 표준/라벨 있음: "라벨 시각"("아침 오전 6:00").
 */
export function slotTitle(
  label: string | null | undefined,
  legacyKey: LegacyMealKey | null | undefined,
  time: string | null | undefined
): string {
  // 시간대 단어(시각 범위 자동 판정) + 시각(오전/오후 없이) — 예: '아침 8:00'.
  // autoSlotLabel 이 정확히 그 형식(periodWord + 12시간 시각)을 만든다.
  const t = autoSlotLabel(time);
  if (t) return t;
  if (label && label.trim()) return (label ?? '').trim();
  return '';
}

/**
 * 환자의 dose_slots 목록으로 "슬롯 표시명(slotTitle)" 조회 맵을 만든다.
 * - byId: dose_slot_id → slotTitle (신규 기록)
 * - byLegacyKey: 'morning'|'lunch'|'dinner'|'bedtime' → slotTitle (legacy meal_time 기록 폴백)
 * 과거기록/몸상태/운동 등 여러 화면이 record 의 (dose_slot_id, meal_time)로 일관된 명칭을 얻게 함.
 */
export function buildSlotTitleMaps(
  slots: Array<{ id?: string | null; label?: string | null; legacyKey?: LegacyMealKey | null; time: string }>
): { byId: Record<string, string>; byLegacyKey: Record<string, string> } {
  const byId: Record<string, string> = {};
  const byLegacyKey: Record<string, string> = {};
  for (const s of slots) {
    const lk = s.legacyKey ?? labelToLegacyKey(s.label);
    const title = slotTitle(s.label, lk, s.time);
    if (s.id) byId[s.id] = title;
    if (lk) byLegacyKey[lk] = title;
  }
  return { byId, byLegacyKey };
}

/**
 * 라벨이 이미 시각(autoSlotLabel 형식)을 포함하는지 — 비표준 추가 슬롯 판별.
 * 표준 라벨("아침" 등)은 false → 이름 옆에 시각을 따로 붙여도 됨.
 * 비표준 라벨("오후 3:00")은 true → 시각 중복 표기 금지.
 */
export function labelContainsTime(
  label: string | null | undefined,
  legacyKey: LegacyMealKey | null | undefined
): boolean {
  if (legacyKey) return false;
  return !!(label && label.trim());
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
