/**
 * DoseSlotSetList.tsx
 * 약 복용 모델 재설계 6단계 — "복용 시각별 세트카드 알림설정".
 *
 * 복용 시각마다 카드 1장(세트). 펼치면 두 박스로 분리:
 *   [박스1 약 복용 알림] 토글 + 알림 시간(수정) + 알림 소리
 *   [박스2 약효 추적 알림] 토글 + 추적 시간 체크줄 5개 + 직접 추가 + 알림 소리
 * 아코디언(1개만 펼침). 토글/체크 즉시 dose_slots 에 저장(저장 버튼 없음).
 *
 * - 표준 4슬롯(legacyKey 있음)은 삭제 불가 → "복용 알림 끄기"만. 비표준 추가 슬롯만 삭제(is_active=false).
 * - 소프트 경고: 이 슬롯의 추적 시각 중 (슬롯시각+분) > 다음 active 슬롯 시각이면 인라인 주황 안내(막지 않음).
 * - ＋ 복용 시각 추가하기: dose_slots insert(track_intervals 기본 {0,30}).
 * - 보호자 경로: useDoseSlots 가 usePatientId 로 연동 환자를 해석하므로 read/write 가 환자 기준으로 동작.
 *   (dose_slots RLS: 환자 본인 + 같은 그룹 보호자 read/write 허용.)
 *
 * 순수 TS · OTA 호환. sticky/fixed 없음. 아이콘 단독 버튼 없음(텍스트 동반).
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import type { AmPm } from '../../context/SettingsContext';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  LayoutAnimation,
  Platform,
  UIManager,
  Dimensions,
  ScrollView,
  FlatList,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SlotTimeIcon } from '../common/SlotTimeIcon';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { navigateTo } from '../../navigation/navigationRef';
import {
  useDoseSlots,
  invalidateDoseSlotsCache,
  type DoseSlot,
} from '../../hooks/useDoseSlots';
import { useSlotMedications } from '../../hooks/useSlotMedications';
import { useMedication } from '../../hooks/useMedication';
import { recommendForSlotMeds } from '../../utils/recommendUtils';
import { usePatientId } from '../../hooks/usePatientId';
import {
  formatSlotTime,
  slotSortValue,
  autoSlotLabel,
  labelContainsTime,
  LEGACY_SLOT_META,
} from '../../constants/doseSlots';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { AlarmSoundOption } from '../common/AlarmSoundPickerRow';
import { HangingText } from '../common/HangingText';
import { useDialog } from '../../context/DialogContext';
import { useAuth } from '../../context/AuthContext';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { useTranslation } from 'react-i18next';

import {
  timeChangeImmediatePopup,
  timeChangeWhileOffPopup,
  turnOnImmediatePopup,
  turnOffImmediatePopup,
  trackChangePopup,
  trackOffPopup,
  deleteSlotCombinedPopup,
  hasTakenTodayKST,
} from '../../utils/notifActionFeedback';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 박스1(약 복용 알림) 배경색 — 연한 파랑(약효추적 박스와 살짝 구분).
const BOX_ALARM_BG = '#EEF4FC';

// ── 추적 시간 체크줄 항목 (분 단위, 0 = 복용 직후) ──────────────────────
interface TrackOption {
  minutes: number;
  label: string;
}
// locale에 따라 매번 새로 계산 — 모듈 로드 시점에 고정하지 않는다(런타임 언어 변경 반영).
function getTrackOptions(): TrackOption[] {
  return [0, 30, 60, 120, 180].map((minutes) => ({ minutes, label: minutesToCheckLabel(minutes) }));
}
// 프리셋 분(중복 행 방지용 빠른 조회) — 값 집합은 로케일 무관이므로 고정 상수로 둔다.
const TRACK_OPTIONS_MINUTES = [0, 30, 60, 120, 180];
// 프리셋 분(중복 행 방지용 빠른 조회)
const PRESET_MINUTES = new Set(TRACK_OPTIONS_MINUTES);

// 신규 슬롯 기본 추적 시간 = 복용 직후(0) + 30분
const DEFAULT_TRACK_INTERVALS = [0, 30];

// 분 → "복용 직후 / 4시간 후" 체크줄 라벨 (비프리셋 값 표시용)
function minutesToCheckLabel(min: number): string {
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (min === 0) return i18n.t('doseSlotSetList.checkRightAfter');
  if (min < 60) return i18n.t('doseSlotSetList.checkMin', { m: min });
  return rem === 0
    ? i18n.t('doseSlotSetList.checkHour', { h })
    : i18n.t('doseSlotSetList.checkHourMin', { h, m: rem });
}

// "직접 추가" 휠 아이템: 시간 0~12, 분 0·5·…·55(5분 단위, 기존 스텝퍼 범위와 동일)
const INTERVAL_HOURS = Array.from({ length: 13 }, (_, i) => i);
const INTERVAL_MINS = Array.from({ length: 12 }, (_, i) => i * 5);

// 추적 시간 리스트 → 접힌 카드 요약 ("복용 직후, 30분 후")
function summarizeTrackIntervals(intervals: number[]): string {
  const sorted = [...intervals].sort((a, b) => a - b);
  if (sorted.length === 0) return i18n.t('doseSlotSetList.selectTrackTime');
  return sorted.map(minutesToCheckLabel).join(', ');
}

// 한글 받침 유무로 주격 조사(은/는) 선택. 약명 끝글자 기준(영문/숫자/기타는 '는').
function topicParticle(word: string): '은' | '는' {
  const ch = (word ?? '').trim().slice(-1);
  const code = ch.charCodeAt(0);
  if (Number.isNaN(code) || code < 0xac00 || code > 0xd7a3) return '는'; // 비한글
  return (code - 0xac00) % 28 === 0 ? '는' : '은'; // 받침 없음→는, 있음→은
}

// 약명 목록 → "마도파와 스타레보" 식 자연스러운 나열(주어용). 영어는 "A and B".
function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  const sep = i18n.t('doseSlotSetList.joinAnd');
  return names.slice(0, -1).join(', ') + sep + names[names.length - 1];
}

// 시점 한 개를 메인 문장용 어구로. 영어는 "after taking" 없이 순수 기간만(문장에서 한 번만 붙임).
function offsetPhrase(min: number): string {
  if (min === 0) return i18n.t('doseSlotSetList.offsetNow');
  if (min < 60) return i18n.t('doseSlotSetList.offsetMin', { m: min });
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0
    ? i18n.t('doseSlotSetList.offsetHour', { h })
    : i18n.t('doseSlotSetList.offsetHourMin', { h, m: rem });
}

// 권장 시점들 → "30분 후와 2시간 후" / "30분 후, 1시간 후와 2시간 후" 자연 나열. 영어는 "A, B and C".
function joinOffsets(offsets: number[]): string {
  const parts = [...offsets].sort((a, b) => a - b).map(offsetPhrase);
  if (parts.length <= 1) return parts[0] ?? '';
  const sep = i18n.t('doseSlotSetList.joinAnd');
  return parts.slice(0, -1).join(', ') + sep + parts[parts.length - 1];
}

// 메인 안내 문장 조립: "{약명}는(은) {시점들}에 몸 상태를 확인하는 걸 추천해요."
// '복용 직후'가 섞이면 "에"가 어색하므로, 직후만 단독이면 "복용 직후에", 시점이면 "{시점}에".
function buildMainSentence(names: string[], offsets: number[]): {
  subject: string;
  particle: string;
  timing: string;
} {
  const subject = joinNames(names);
  const particle = isOverseasLocale() ? '' : topicParticle(subject);
  const timing = joinOffsets(offsets);
  return { subject, particle, timing };
}


// 시간대 단어(자동) + 시각(오전/오후 없이) — 예: '아침 8:00'. autoSlotLabel 이 그 형식.
function slotTitle(slot: DoseSlot): string {
  const t = autoSlotLabel(slot.time);
  if (t) return t;
  if (slot.label && slot.label.trim()) return slot.label.trim();
  return '';
}

interface Props {
  /** 그룹 녹음 목록 (알림별 소리 선택용) */
  alarmSounds: AlarmSoundOption[];
  /**
   * 진입 시 이 슬롯을 펼쳐서 보여줄 id(복용 관리 슬롯 카드 "시간·알림 바꾸기"용).
   * 값이 있으면 마운트/변경 시 해당 슬롯을 expandedId 로 펼친다(없으면 기존처럼 전체 목록).
   * 같은 값이라도 매번 새 진입을 구분하려면 focusNonce 와 함께 갱신해서 넘긴다.
   */
  focusSlotId?: string | null;
  /**
   * 같은 슬롯을 다시 열 때도 포커스가 재적용되도록 하는 진입 토큰(모달 열 때마다 +1).
   * focusSlotId 가 같아도 이 값이 바뀌면 다시 펼침/스크롤한다.
   */
  focusNonce?: number;
  /**
   * 포커스 슬롯 카드의 목록 내 Y 위치를 부모에게 알려 best-effort 스크롤하게 함.
   * (이 컴포넌트는 자체 ScrollView 가 없고 부모 ScrollView 안에 렌더되므로 위치만 위임.)
   */
  onFocusScrollTo?: (y: number) => void;
  /**
   * 단일 슬롯만 편집(이 슬롯만 렌더, 안내·추가 버튼 숨김). 슬롯 카드 "수정" 진입용.
   * 다른 슬롯이 같이 보여 헷갈리지 않게 해당 슬롯 하나만 노출한다.
   */
  soloSlotId?: string | null;
  /** 단일 슬롯 편집 모달 닫기 — 슬롯 제목 줄 오른쪽 끝 "닫기" 버튼에 연결. */
  onSoloClose?: () => void;
  /**
   * 진입 즉시 "복용 시간대 추가"(시간 선택 시트)를 바로 열기 위한 토큰.
   * 값이 0보다 크고 바뀌면 마운트/변경 시 곧장 시간 추가 시트를 띄운다 → 전체 목록을
   * 다시 보여주는 중간 단계 없이 한 번에 시각 선택으로 진입(추가 경로 단순화).
   * 시트를 닫으면 그대로 전체 관리 목록이 남아 방금 추가한 슬롯이 보인다.
   */
  autoOpenAddNonce?: number;
  /**
   * "추가 전용" 경로 — 전체 슬롯 목록/안내/헤더/추가 버튼을 일절 렌더하지 않고(빈 배경),
   * autoOpenAddNonce 로 띄운 시간 선택 시트 하나만 보이게 한다(시트 2겹 방지).
   * 시간 시트를 닫거나(취소) 저장 완료하면 onAddDone 으로 모달 전체를 닫아 본 화면으로 복귀.
   */
  addOnly?: boolean;
  /**
   * addOnly 경로에서 시간 시트가 처리됐을 때 호출.
   * - 저장 성공(새 슬롯 생성) → newSlotId(실제 DB id) 전달. 부모는 그 슬롯의 수정 시트로 전환한다.
   * - 취소/닫기(미저장) → 인자 없이 호출. 부모는 모달을 닫아 본 화면으로 복귀한다.
   */
  onAddDone?: (newSlotId?: string) => void;
  /**
   * "약 등록하러 가기" CTA(연결할 약이 0개일 때) 커스텀 동작.
   * 지정하면 기본 동작(전역 navigateTo로 MyInfo>MedicationManage 이동) 대신 이 콜백만 호출한다.
   * 해외판(OverseasMedTabScreen)처럼 이 컴포넌트가 이미 "약 관리" 탭과 같은 화면 안에
   * 내장된 경우, 다른 탭으로 크로스 네비게이션할 필요 없이 로컬 탭만 전환하면 되므로 사용.
   */
  onGoRegisterMeds?: () => void;
}

export function DoseSlotSetList({
  alarmSounds,
  focusSlotId,
  focusNonce,
  onFocusScrollTo,
  soloSlotId,
  onSoloClose,
  autoOpenAddNonce,
  addOnly,
  onAddDone,
  onGoRegisterMeds,
}: Props) {
  const { t } = useTranslation();
  const dialog = useDialog();
  const { user } = useAuth();
  // 하루 경계/시각 판정용 사용자 tz(Phase1 S2). 미로그인/미로딩 시 Asia/Seoul 폴백.
  const userTz = user?.timezone || 'Asia/Seoul';
  const { slots, loading, refresh } = useDoseSlots();
  const { bySlot: slotMeds, loading: slotMedsLoading, refresh: refreshSlotMeds } =
    useSlotMedications();
  // 환자에게 등록된 약이 하나라도 있는지(전역 판정 소스).
  // '약 등록하러 가기' 빈 상태 CTA 는 이 값이 0개일 때만 떠야 한다(슬롯 연결 여부와 무관).
  const { medications } = useMedication();
  const hasAnyMed = medications.length > 0;
  const { patientId: resolvedPatientId } = usePatientId();
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // 포커스 슬롯 카드의 목록 내 Y 위치(onLayout 수집). best-effort 스크롤용.
  const slotLayoutY = useRef<Map<string, number>>(new Map());
  // 마지막으로 적용한 (focusSlotId, focusNonce) — 중복 적용 방지.
  const appliedFocusRef = useRef<string | null>(null);
  // 펼침 직후 스크롤을 한 번 예약하기 위한 플래그(레이아웃 측정 후 실행).
  const pendingScrollIdRef = useRef<string | null>(null);

  // ── 낙관적 오버레이 ─────────────────────────────────────────────────────────
  // base = useDoseSlots().slots, 그 위에 슬롯별 즉시 반영분(overrides)을 머지해서 렌더.
  // 토글/체크/소리 변경은 overrides 에 먼저 박아 UI 가 네트워크 왕복 없이 바로 바뀐다.
  // overrides[slotId] 는 변경된 필드만 담는 부분 패치.
  const [overrides, setOverrides] = useState<
    Record<string, Partial<DoseSlot>>
  >({});
  // 슬롯+필드별 in-flight 시퀀스(마지막 쓰기 승리용). 전역 단일 가드 대신
  // 같은 슬롯·같은 필드의 옛 응답이 최신값을 덮지 못하게 막는다. 서로 다른 슬롯/필드는 동시 허용.
  const writeSeqRef = useRef<Map<string, number>>(new Map());
  // insert(슬롯 추가)만 중복 탭 방지 — 같은 시각 슬롯 연속 생성 방지용(단일 동작).
  const insertingRef = useRef(false);

  // ── 슬롯-약 연결(복용약 체크리스트) 낙관적 상태 ─────────────────────────────────
  // slotId → 이 시각에 드시는 약 id 집합. 펼친 편집뷰의 "이 시간에 드시는 약" 체크리스트가
  // 이 값을 진실원으로 렌더한다(슬롯당 1회 slotMeds 로 시드 후엔 로컬이 권위).
  // 새 슬롯 생성 시 등록 약 전부를 medication_dose_slots 로 자동 연결하므로 기본 전부 체크.
  // 사용자는 안 드시는 약만 해제 → 토글 즉시 medication_dose_slots insert/delete(낙관적).
  const [medChecked, setMedChecked] = useState<Record<string, Set<string>>>({});

  // ── 낙관적 "추가" 슬롯 ─────────────────────────────────────────────────────────
  // 복용 시각 추가는 dose_slots insert + refresh 로 반영되는데, insert→재fetch
  // 왕복(라이브 폰 release 에서 수 초) 동안 화면에 새 카드가 안 떠 "아무 변화 없음"으로 보였다.
  // 그래서 IntervalPickerSheet 처럼 새 슬롯을 즉시 로컬에 반영하고, refresh 가
  // 진짜 행(real id)을 가져오면 정리한다. key 는 임시 id(opt: 접두).
  const [addedSlots, setAddedSlots] = useState<DoseSlot[]>([]);

  // 시간/분 바텀시트 상태
  const [timeSheet, setTimeSheet] = useState<{
    mode: 'edit' | 'add';
    slotId: string | null;
    ampm: AmPm;
    hour: number;
    minute: number;
  } | null>(null);

  // "다른 시간 더하기"(추적 시각 직접 추가) 바텀시트 상태
  const [intervalSheet, setIntervalSheet] = useState<{
    slotId: string;
    hour: number; // 복용 후 ○시간
    minute: number; // ○분 후
  } | null>(null);

  const patientIdRef = useRef<string | null>(null);
  // slots 의 첫 행 또는 usePatientId(보호자→연동환자 해석)에서 patientId 확보
  const patientId =
    slots.find((s) => s.patientId)?.patientId ??
    resolvedPatientId ??
    patientIdRef.current;
  if (patientId) patientIdRef.current = patientId;

  // base(slots) + overrides 머지 = 화면이 렌더할 슬롯 리스트(낙관적 반영).
  const mergedSlots: DoseSlot[] = slots.map((s) => {
    const ov = s.id ? overrides[s.id] : undefined;
    return ov ? { ...s, ...ov } : s;
  });
  // 낙관적 추가분 중 아직 base 에 동일 행(시각+라벨)이 없는 것만 덧붙인다.
  // refresh 가 진짜 행을 가져오면 매칭되어 빠지므로 중복 카드가 남지 않는다.
  const pendingAdded = addedSlots.filter(
    (a) => !slots.some((s) => s.time === a.time && (s.label ?? '') === (a.label ?? '')),
  );
  // 시각(time) 오름차순으로 표시 — 새로 추가한 슬롯도 하단이 아니라 제 시각 자리에 끼워 보임.
  // (낙관적 추가분 포함. 동일 시각이면 sortOrder 로 안정 정렬.)
  const displaySlots: DoseSlot[] = [...mergedSlots, ...pendingAdded].sort((a, b) => {
    const ta = slotSortValue(a.time);
    const tb = slotSortValue(b.time);
    if (ta !== tb) return ta - tb;
    return a.sortOrder - b.sortOrder;
  });

  // base(slots)가 갱신되어 오버레이 값과 같아졌으면 해당 필드 오버레이를 정리한다.
  // (오버레이가 영구히 쌓여 외부(타 화면/refresh) 변경을 가리지 않도록.)
  useEffect(() => {
    setOverrides((prev) => {
      if (Object.keys(prev).length === 0) return prev;
      let changed = false;
      const next: Record<string, Partial<DoseSlot>> = {};
      for (const [slotId, ov] of Object.entries(prev)) {
        const base = slots.find((s) => s.id === slotId);
        if (!base) {
          // base 에서 사라진 슬롯(삭제 등) → 오버레이도 폐기.
          changed = true;
          continue;
        }
        const remaining: Partial<DoseSlot> = {};
        (Object.keys(ov) as (keyof DoseSlot)[]).forEach((f) => {
          // 배열(track_intervals)은 내용 비교, 그 외는 동등 비교.
          const same = Array.isArray(ov[f]) && Array.isArray(base[f])
            ? JSON.stringify(ov[f]) === JSON.stringify(base[f])
            : ov[f] === base[f];
          if (!same) (remaining as any)[f] = ov[f];
        });
        if (Object.keys(remaining).length === 0) {
          changed = true; // 전 필드가 base 와 일치 → 오버레이 제거
        } else {
          next[slotId] = remaining;
          if (Object.keys(remaining).length !== Object.keys(ov).length) changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [slots]);

  // base(slots)가 진짜 추가 행을 갖게 되면(refresh 반영) 대응 낙관적 추가분을 정리.
  useEffect(() => {
    setAddedSlots((prev) => {
      if (prev.length === 0) return prev;
      const next = prev.filter(
        (a) => !slots.some((s) => s.time === a.time && (s.label ?? '') === (a.label ?? '')),
      );
      return next.length === prev.length ? prev : next;
    });
  }, [slots]);

  const toggleExpand = useCallback((id: string) => {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setExpandedId((prev) => (prev === id ? null : id));
  }, []);

  // ── 외부 포커스(복용 관리 슬롯 카드 "시간·알림 바꾸기") 반영 ──────────────────
  // focusSlotId 가 있으면 그 슬롯을 펼치고, 레이아웃이 잡히면 부모에게 스크롤을 위임한다.
  // focusNonce 를 키에 포함해 같은 슬롯을 다시 열어도 재적용된다.
  // focusSlotId 가 없으면(전체 관리/다른 진입) 아무것도 하지 않아 기존 동작과 100% 동일.
  useEffect(() => {
    if (!focusSlotId) {
      appliedFocusRef.current = null;
      return;
    }
    const key = `${focusSlotId}:${focusNonce ?? 0}`;
    if (appliedFocusRef.current === key) return;
    appliedFocusRef.current = key;
    setExpandedId(focusSlotId);
    // 펼친 카드의 위치가 잡힌 뒤 스크롤하도록 예약(onLayout 에서 소비).
    pendingScrollIdRef.current = focusSlotId;
    // 이미 레이아웃이 측정돼 있으면(재오픈 등) 즉시 스크롤.
    const y = slotLayoutY.current.get(focusSlotId);
    if (y != null && onFocusScrollTo) {
      // 펼침 애니메이션 후 위치가 바뀔 수 있어 살짝 지연.
      setTimeout(() => {
        if (pendingScrollIdRef.current === focusSlotId) {
          onFocusScrollTo(y);
          pendingScrollIdRef.current = null;
        }
      }, 120);
    }
  }, [focusSlotId, focusNonce, onFocusScrollTo]);

  /**
   * 시간 시트에서 추가/수정을 저장한 뒤, 그 슬롯을 펼치고 그 위치로 스크롤한다.
   *   (오너 요청 2026-07-27: 알림을 추가하거나 시간을 고치고 목록으로 돌아오면
   *    방금 건드린 슬롯이 화면에 나와야 한다 — 예전엔 목록 맨 위로 돌아와 어디가 바뀌었는지 안 보였다.)
   * 외부 focusSlotId 경로와 같은 장치(pendingScrollIdRef + onLayout 소비)를 재사용한다.
   * 새 슬롯은 refresh 로 진짜 행이 온 뒤 렌더되므로, 그때 onLayout 에서 스크롤이 소비된다.
   */
  const focusSlotAfterSave = useCallback((slotId: string) => {
    setExpandedId(slotId);
    pendingScrollIdRef.current = slotId;
    // 이미 레이아웃이 잡혀 있으면(수정 경로) 펼침 애니메이션 뒤 바로 스크롤.
    const y = slotLayoutY.current.get(slotId);
    if (y != null && onFocusScrollTo) {
      setTimeout(() => {
        if (pendingScrollIdRef.current === slotId) {
          onFocusScrollTo(y);
          pendingScrollIdRef.current = null;
        }
      }, 120);
    }
  }, [onFocusScrollTo]);

  // dose_slots 1건 update (낙관적). DB 컬럼 patch 와 그에 대응하는 로컬 DoseSlot 패치를 받는다.
  //  1) overrides 에 즉시 반영 → UI 바로 바뀜
  //  2) 백그라운드로 dose_slots update. 같은 슬롯+필드는 시퀀스로 마지막 쓰기만 유효(LWW).
  //     서로 다른 슬롯/필드는 동시 진행 허용(전역 가드 없음 → 연속 탭 유실 없음).
  //  3) 실패 시 직전 값으로 롤백. 성공 시 await refresh 하지 않음(낙관적 state 로 충분,
  //     화면 이탈/타 화면 반영용으로 캐시만 무효화). DB 가 단일 진실원.
  const patchSlot = useCallback(
    (slotId: string, dbPatch: Record<string, unknown>, localPatch: Partial<DoseSlot>) => {
      // 롤백 대상 = 이번 변경 직전의 로컬 값(overrides 우선, 없으면 base slots).
      const fields = Object.keys(localPatch) as (keyof DoseSlot)[];
      const baseSlot = slots.find((s) => s.id === slotId);
      const prevOverride = overrides[slotId];
      const prevValues: Partial<DoseSlot> = {};
      fields.forEach((f) => {
        if (prevOverride && f in prevOverride) {
          (prevValues as any)[f] = prevOverride[f];
        } else if (baseSlot) {
          (prevValues as any)[f] = baseSlot[f];
        }
      });

      // 1) 낙관적 반영
      setOverrides((prev) => ({
        ...prev,
        [slotId]: { ...prev[slotId], ...localPatch },
      }));

      // 2) 슬롯+필드별 시퀀스 발급(같은 키의 직전 in-flight 응답은 무시됨).
      const seqKey = `${slotId}:${fields.sort().join(',')}`;
      const seq = (writeSeqRef.current.get(seqKey) ?? 0) + 1;
      writeSeqRef.current.set(seqKey, seq);

      void (async () => {
        try {
          const { error } = await supabase
            .from('dose_slots')
            .update(dbPatch as any)
            .eq('id', slotId);
          if (error) throw error;
          // 최신 쓰기였을 때만 캐시 무효화(타 화면 반영). overrides 는 그대로 둬
          // refresh 가 base 를 갱신해도 깜빡임이 없게(머지 결과 동일).
          if (
            writeSeqRef.current.get(seqKey) === seq &&
            patientIdRef.current
          ) {
            invalidateDoseSlotsCache(patientIdRef.current);
          }
        } catch (e) {
          console.error('[DoseSlotSetList] dose_slots update failed:', e);
          // 3) 최신 쓰기였을 때만 롤백(옛 응답이 최신값을 덮지 않게).
          if (writeSeqRef.current.get(seqKey) !== seq) return;
          setOverrides((prev) => ({
            ...prev,
            [slotId]: { ...prev[slotId], ...prevValues },
          }));
        }
      })();
    },
    [slots, overrides],
  );

  // ── 복용약 체크리스트 시드: 슬롯별 1회만 slotMeds(연결된 약)로 초기화 ──────────────
  // slotMedsLoading 동안엔 시드하지 않는다(빈 상태로 오시드 → 전부 해제 표시 방지).
  // 한 번 medChecked 에 들어간 슬롯은 다시 시드하지 않아 사용자의 토글/외부 변경을 덮지 않는다.
  useEffect(() => {
    if (slotMedsLoading) return;
    setMedChecked((prev) => {
      let changed = false;
      const next = { ...prev };
      for (const s of slots) {
        const sid = s.id;
        if (!sid || sid in prev) continue;
        next[sid] = new Set((slotMeds[sid] ?? []).map((m) => m.id));
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [slots, slotMeds, slotMedsLoading]);

  // 복용약 체크 토글 — medication_dose_slots insert(체크)/delete(해제)를 낙관적으로 즉시 반영.
  // ⚠️ 쓰기 방식: supabase-js .insert()/.delete() 사용(.update() 아님 — New Arch hang 회피).
  //   MedicationManageScreen.commitMedSlot 과 동일한 medication_dose_slots 직접 쓰기 패턴.
  const onToggleMedLink = useCallback(
    (slotId: string, medId: string) => {
      // ⚠️ 깜빡임 방지: 이 토글은 "낙관적 로컬 상태(medChecked)"만 즉시 갱신하고,
      //   어떤 전체 새로고침/캐시 무효화도 하지 않는다(시트 리마운트 유발 금지).
      //   - 아직 시드 전이면(medChecked[slotId] 미존재) 빈 셋이 아니라 slotMeds(DB 연결분)에서
      //     출발해 has 판정을 정확히 한다 → 잘못된 insert/delete 방지(연결 저장 정확성 유지).
      //   - invalidateDoseSlotsCache 호출 안 함: 이는 dose_slots(슬롯) 캐시라 M:N 링크와 무관하고,
      //     시트가 열린 동안 데이터 churn 을 유발할 수 있다. 슬롯 목록은 시트를 닫을 때
      //     호스트(MedicationManageScreen.closeSlotAlarmEdit→loadDoseSlots)가 새로 읽어 정합성 보장.
      //   - 타 화면/기기 동기화는 DB 쓰기 자체가 realtime 으로 전파하므로 깨지지 않는다.
      const current =
        medChecked[slotId] ??
        new Set<string>((slotMeds[slotId] ?? []).map((m) => m.id));
      const has = current.has(medId);
      const next = new Set(current);
      if (has) next.delete(medId);
      else next.add(medId);
      // 1) 낙관적 반영(체크 즉시 표시) — 이 상태가 진실원, 리렌더만 발생(리마운트 없음)
      setMedChecked((prev) => ({ ...prev, [slotId]: next }));
      // 2) 백그라운드 쓰기(insert/delete). 실패 시 직전 값으로 롤백.
      void (async () => {
        try {
          if (has) {
            const { error } = await supabase
              .from('medication_dose_slots')
              .delete()
              .eq('dose_slot_id', slotId)
              .eq('medication_id', medId);
            if (error) throw error;
          } else {
            const { error } = await supabase
              .from('medication_dose_slots')
              .insert({ medication_id: medId, dose_slot_id: slotId } as any);
            if (error) throw error;
          }
          // 성공 시 캐시 무효화/refresh 하지 않음 — 낙관적 medChecked 가 이미 정확.
        } catch (e) {
          console.error('[DoseSlotSetList] slot-medication link toggle failed:', e);
          setMedChecked((prev) => ({ ...prev, [slotId]: current }));
        }
      })();
      // ⚠️ 토글은 "약 연결 on/off + medChecked 갱신"만 한다 — 추적시간(track_intervals)은
      //   절대 건드리지 않는다. 추천 시점 자동 체크는 "새 슬롯 생성 시"에만 일어난다
      //   (onSaveTime add 분기 참조). 기존 슬롯에서 사용자가 직접 설정한 추적시간을 보존.
    },
    [medChecked, slotMeds],
  );

  // 약 드실 시간 알림 토글
  const onToggleRemind = useCallback(
    (slot: DoseSlot, value: boolean) => {
      if (!slot.id) return;
      patchSlot(slot.id, { remind_enabled: value }, { remindEnabled: value });
      // 결과 안내: 켜기=즉시(시각 지났는지 판정) / 끄기=즉시 중단.
      const popup = value
        ? turnOnImmediatePopup(slot.time, userTz)
        : turnOffImmediatePopup();
      dialog.alert(popup);
    },
    [patchSlot, dialog, userTz],
  );

  // 약 알림 소리 변경
  const onRemindSound = useCallback(
    (slot: DoseSlot, soundId: string | null) => {
      if (!slot.id) return;
      patchSlot(slot.id, { remind_sound_id: soundId }, { remindSoundId: soundId });
    },
    [patchSlot],
  );

  // 약효 추적 알림 토글
  const onToggleTrack = useCallback(
    (slot: DoseSlot, value: boolean) => {
      if (!slot.id) return;
      // 켜는데 추적 시각이 하나도 없으면 기본값으로 채워줌
      if (value && slot.trackIntervals.length === 0) {
        patchSlot(
          slot.id,
          { track_enabled: true, track_intervals: DEFAULT_TRACK_INTERVALS },
          { trackEnabled: true, trackIntervals: DEFAULT_TRACK_INTERVALS },
        );
      } else {
        patchSlot(slot.id, { track_enabled: value }, { trackEnabled: value });
      }
      // 결과 안내: 약효추적은 지연형 → 오늘 이미 복용했는지 확인해 맞춤 문구.
      const slotId = slot.id;
      void (async () => {
        const taken = await hasTakenTodayKST(patientIdRef.current, slotId, userTz);
        dialog.alert(value ? trackChangePopup(taken) : trackOffPopup(taken));
      })();
    },
    [patchSlot, dialog, userTz],
  );

  // 추적 알림 소리 변경
  const onTrackSound = useCallback(
    (slot: DoseSlot, soundId: string | null) => {
      if (!slot.id) return;
      patchSlot(slot.id, { track_sound_id: soundId }, { trackSoundId: soundId });
    },
    [patchSlot],
  );

  // 체크줄 토글 (다중선택). 최소 1개는 유지(전부 끄면 추적 자체를 꺼야 자연스러움 →
  // 마지막 1개를 끄면 약효추적 토글도 함께 off 처리).
  const onToggleInterval = useCallback(
    (slot: DoseSlot, minutes: number) => {
      if (!slot.id) return;
      const has = slot.trackIntervals.includes(minutes);
      let next = has
        ? slot.trackIntervals.filter((m) => m !== minutes)
        : [...slot.trackIntervals, minutes];
      next = [...new Set(next)].sort((a, b) => a - b);
      const turnedOff = next.length === 0;
      if (turnedOff) {
        // 마지막 항목까지 끄면 약효추적 자체를 끔
        patchSlot(
          slot.id,
          { track_intervals: [], track_enabled: false },
          { trackIntervals: [], trackEnabled: false },
        );
      } else {
        patchSlot(slot.id, { track_intervals: next }, { trackIntervals: next });
      }
      // 결과 안내(지연형): 간격 변경 → 오늘 복용했는지 확인. 마지막 항목 해제=꺼짐 문구.
      const slotId = slot.id;
      void (async () => {
        const taken = await hasTakenTodayKST(patientIdRef.current, slotId, userTz);
        dialog.alert(turnedOff ? trackOffPopup(taken) : trackChangePopup(taken));
      })();
    },
    [patchSlot, dialog, userTz],
  );

  // "다른 시간 더하기"로 임의 분을 track_intervals 에 추가(정렬·중복제거).
  // 이미 있는 값(프리셋 포함)이면 그냥 그 체크줄이 켜진 상태이므로 무시(중복 행 안 만듦).
  const onAddInterval = useCallback(
    (slotId: string, minutes: number) => {
      const slot = slots.find((s) => s.id === slotId);
      const base =
        (overrides[slotId]?.trackIntervals as number[] | undefined) ??
        slot?.trackIntervals ??
        [];
      if (base.includes(minutes)) {
        // 이미 있으면(0·프리셋·기존 직접추가값) 중복 행 만들지 말고 그대로 둠.
        setIntervalSheet(null);
        return;
      }
      const next = [...new Set([...base, minutes])].sort((a, b) => a - b);
      setIntervalSheet(null);
      patchSlot(slotId, { track_intervals: next }, { trackIntervals: next });
      // 결과 안내(지연형): 추적 시각 추가도 다음 복용부터/오늘분 분기.
      void (async () => {
        const taken = await hasTakenTodayKST(patientIdRef.current, slotId, userTz);
        dialog.alert(trackChangePopup(taken));
      })();
    },
    [slots, overrides, patchSlot, dialog, userTz],
  );

  // 비표준 추가 슬롯 삭제. 표준 4슬롯은 호출 안 됨(상위에서 게이팅).
  // 흐름: 이 시각에 쌓인 기록(med_logs+on_off_logs) 건수를 먼저 조회 →
  //   · 0건  : 기존처럼 확인 후 슬롯만 soft delete(is_active=false). 기록 없음.
  //   · 1건+ : "기록도 함께 삭제할까요?" 2버튼.
  //       - 기록도 함께 삭제 → 서버 RPC(delete_dose_slot_with_records)로 슬롯+기록 일괄 삭제.
  //       - 기록은 남기기   → 기존 soft delete(슬롯만). 기록은 보존.
  // 삭제는 목록에서 사라져야 하므로 낙관적 오버레이가 아니라 refresh 로 반영.
  // (약효추적 미발송 큐 정리는 서버 트리거/RPC 담당 — 클라에서 큐를 직접 건드리지 않음.)
  const onDeleteSlot = useCallback(
    async (slot: DoseSlot) => {
      if (!slot.id) return;
      const id = slot.id;
      const pid = patientIdRef.current;

      // 삭제 성공 후 공통 로컬 정리(캐시 무효화 + 잔여 오버레이 제거 + base refresh).
      const finishRemoval = async () => {
        if (patientIdRef.current) invalidateDoseSlotsCache(patientIdRef.current);
        setOverrides((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await refresh();
      };

      // 슬롯만 soft delete(기록 보존). 기존 트리거가 미발송 추적 큐를 정리.
      const softDeleteOnly = async () => {
        setExpandedId(null);
        // 삭제 전에 오늘 복용 여부 조회(약효추적 안내 분기에 필요).
        const takenToday = await hasTakenTodayKST(patientIdRef.current, id, userTz);
        try {
          const { error } = await supabase
            .from('dose_slots')
            .update({ is_active: false })
            .eq('id', id);
          if (error) throw error;
          await finishRemoval();
          // 결과 안내: 약 복용(즉시 중단)+약효추적(오늘 예약분)을 한 번에(통합 1회 팝업).
          dialog.alert(deleteSlotCombinedPopup(takenToday));
        } catch (e) {
          console.error('[DoseSlotSetList] dose_slots delete failed:', e);
          dialog.alert({
            title: i18n.t('doseSlotSetList.deleteFailTitle'),
            message: i18n.t('doseSlotSetList.deleteFailMsg'),
          });
        }
      };

      // 슬롯 + 이 시각의 기록까지 서버에서 함께 삭제(RPC). 큐 정리도 서버 담당.
      const deleteWithRecords = async () => {
        setExpandedId(null);
        const takenToday = await hasTakenTodayKST(patientIdRef.current, id, userTz);
        try {
          const { error } = await supabase.rpc('delete_dose_slot_with_records', {
            p_dose_slot_id: id,
          });
          if (error) throw error;
          await finishRemoval();
          dialog.alert(deleteSlotCombinedPopup(takenToday));
        } catch (e) {
          console.error('[DoseSlotSetList] slot + records delete (RPC) failed:', e);
          dialog.alert({
            title: i18n.t('doseSlotSetList.deleteFailTitle'),
            message: i18n.t('doseSlotSetList.deleteFailMsg'),
          });
        }
      };

      // 1) 이 슬롯에 연결된 기록 건수 조회(med_logs + on_off_logs). RLS 로 권한 제한됨.
      let recordCount = 0;
      try {
        let medQ = supabase
          .from('med_logs')
          .select('id', { count: 'exact', head: true })
          .eq('dose_slot_id', id);
        let onoffQ = supabase
          .from('on_off_logs')
          .select('id', { count: 'exact', head: true })
          .eq('dose_slot_id', id);
        if (pid) {
          medQ = medQ.eq('patient_id', pid);
          onoffQ = onoffQ.eq('patient_id', pid);
        }
        const [medRes, onoffRes] = await Promise.all([medQ, onoffQ]);
        recordCount = (medRes.count ?? 0) + (onoffRes.count ?? 0);
      } catch (e) {
        // 조회 실패 시 보수적으로 0 취급 → 기록은 건드리지 않는 기존 삭제 흐름으로.
        console.error('[DoseSlotSetList] failed to count slot records:', e);
        recordCount = 0;
      }

      // 2) 기록 0건 → 기존처럼 확인 후 슬롯만 삭제.
      if (recordCount === 0) {
        const ok = await dialog.confirm({
          title: i18n.t('doseSlotSetList.deleteConfirmTitle'),
          message: i18n.t('doseSlotSetList.deleteConfirmMsg', { slot: slotTitle(slot) }),
          confirmText: i18n.t('common.delete'),
          cancelText: i18n.t('common.cancel'),
          destructive: true,
        });
        if (!ok) return;
        await softDeleteOnly();
        return;
      }

      // 3) 기록 1건 이상 → 기록까지 함께 삭제할지 2버튼 선택.
      const choice = await dialog.show({
        title: i18n.t('doseSlotSetList.hasRecordsTitle', { count: recordCount }),
        message: i18n.t('doseSlotSetList.hasRecordsMsg'),
        buttons: [
          { id: 'withRecords', text: i18n.t('doseSlotSetList.deleteWithRecords'), style: 'destructiveSolid', row: true },
          { id: 'keepRecords', text: i18n.t('doseSlotSetList.keepRecords'), style: 'destructive', row: true },
          { id: 'cancel', text: i18n.t('common.close'), style: 'cancel' },
        ],
      });
      if (choice === 'withRecords') {
        await deleteWithRecords();
      } else if (choice === 'keepRecords') {
        await softDeleteOnly();
      }
      // choice === 'cancel'(닫기 버튼) / null(배경·뒤로 닫음) → 아무 동작 없음(취소).
    },
    [refresh, dialog, userTz],
  );

  // ── 시간/분 바텀시트 ───────────────────────────────────────────────────────
  const openTimeSheet = useCallback((slot: DoseSlot | null) => {
    if (slot) {
      // 편집: 기존 시각으로 초기화
      const parts = slot.time.split(':');
      const h24 = parseInt(parts[0] ?? '8', 10);
      // 분은 5분 단위만 선택 가능 → 기존 비-5분값(예 42)이면 가장 가까운 5분으로 스냅(0~55).
      // (스냅은 편집 시트를 열 때만 — 저장 안 하면 DB 원본값은 그대로 유지.)
      const rawMinute = parseInt(parts[1] ?? '0', 10);
      const minute = Math.min(
        55,
        Math.round((Number.isNaN(rawMinute) ? 0 : rawMinute) / 5) * 5,
      );
      let ampm: AmPm;
      let hour: number;
      if (h24 === 0) { ampm = 'am'; hour = 12; }
      else if (h24 < 12) { ampm = 'am'; hour = h24; }
      else if (h24 === 12) { ampm = 'pm'; hour = 12; }
      else { ampm = 'pm'; hour = h24 - 12; }
      setTimeSheet({ mode: 'edit', slotId: slot.id, ampm, hour, minute });
    } else {
      // 추가: 기본 오전 9:00
      setTimeSheet({ mode: 'add', slotId: null, ampm: 'am', hour: 9, minute: 0 });
    }
  }, []);

  // 진입 즉시 시간 추가 시트 열기(추가 경로 단순화). autoOpenAddNonce 가 바뀌면 1회 실행.
  // soloSlotId(단일 슬롯 수정 진입)일 땐 무시 — 그건 추가가 아니라 특정 슬롯 편집이므로.
  const appliedAddNonceRef = useRef<number | null>(null);
  useEffect(() => {
    if (soloSlotId) return;
    const n = autoOpenAddNonce ?? 0;
    if (n <= 0) return;
    if (appliedAddNonceRef.current === n) return;
    appliedAddNonceRef.current = n;
    openTimeSheet(null);
  }, [autoOpenAddNonce, soloSlotId, openTimeSheet]);

  const sheetToHHMM = (s: { ampm: AmPm; hour: number; minute: number }): string => {
    let h24: number;
    if (s.ampm === 'am') h24 = s.hour === 12 ? 0 : s.hour;
    else h24 = s.hour === 12 ? 12 : s.hour + 12;
    return `${String(h24).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`;
  };

  const onSaveTime = useCallback(async () => {
    if (!timeSheet) return;
    const newTime = sheetToHHMM(timeSheet);
    if (timeSheet.mode === 'edit' && timeSheet.slotId) {
      const id = timeSheet.slotId;
      setTimeSheet(null);
      // 표준 슬롯(legacyKey 있음)은 라벨 유지("아침" 등). 비표준 슬롯은 시각이 바뀌면
      // 라벨("오후 3:00")도 새 시각 기준으로 갱신해야 이름이 시각과 안 어긋난다.
      const target = slots.find((s) => s.id === id);
      const isStandardSlot = !!target?.legacyKey;
      if (isStandardSlot) {
        // 시각 변경도 낙관적 — 카드 제목이 바로 바뀜.
        patchSlot(id, { time: newTime }, { time: newTime });
      } else {
        const newLabel = autoSlotLabel(newTime);
        patchSlot(
          id,
          { time: newTime, label: newLabel },
          { time: newTime, label: newLabel },
        );
      }
      // 수정한 슬롯을 펼치고 그 위치로 스크롤(솔로 편집뷰는 그 슬롯만 렌더하므로 영향 없음).
      if (!soloSlotId) focusSlotAfterSave(id);
      // 결과 안내: remind 켜진 슬롯이면 즉시형(시각 지났는지), 꺼진 슬롯이면 "꺼져 있어요".
      const remindOn = target?.remindEnabled ?? true;
      dialog.alert(
        remindOn ? timeChangeImmediatePopup(newTime, userTz) : timeChangeWhileOffPopup(),
      );
    } else {
      // 추가: dose_slots insert.
      // insert→refresh 왕복 동안 화면이 비는 걸 막으려고 새 슬롯을 즉시 낙관적으로 띄운다.
      const pid = patientIdRef.current;
      setTimeSheet(null);
      // ⚠️ addOnly 경로(추가 후 곧바로 수정 시트 전환): 여기서 onAddDone 을 미리 부르지 않는다.
      //   insert 가 반환하는 실제 슬롯 id 를 확보한 뒤(아래 try), 그 id 로 onAddDone(newSlotId)
      //   를 불러 부모가 "그 슬롯의 수정 시트"로 매끄럽게 전환하게 한다(엉뚱한 슬롯 편집 방지).
      //   pid 가 없으면(드문 경우) 조용히 닫지 말고 사용자에게 재시도를 안내한다.
      //   (보통 수정1·2로 환자 슬롯/patientId 가 해결되지만, 환자 정보 로딩 직후 등
      //    드문 타이밍에서 pid 가 아직 null 일 수 있어 방어선으로 둔다.)
      if (!pid) {
        console.warn('[DoseSlotSetList] patientId unresolved while adding slot - deferring save, prompting retry');
        dialog.alert({
          title: i18n.t('doseSlotSetList.oneMomentTitle'),
          message: i18n.t('doseSlotSetList.preparingMsg'),
        });
        if (addOnly) onAddDone?.();
        return;
      }
      if (insertingRef.current) return;
      insertingRef.current = true;

      const maxSort = slots.reduce((mx, s) => Math.max(mx, s.sortOrder), 0);
      const newSort = maxSort + 1;
      // 비표준(추가) 슬롯 라벨 = "[시간대] [12시간 시각]" (예 "오후 3:00"). 기존 '추가' 폐기.
      const newLabel = autoSlotLabel(newTime);
      // ── 추천 시점 자동 체크(새 슬롯 생성 시에만) ─────────────────────────────
      // 새 슬롯은 아래에서 환자의 등록 약 전부를 자동 연결하므로, 연결될 약 = medications 전체.
      // 그 약들로 권장 추적 시점(레보도파 등)을 계산해, 권장이 있으면 [복용직후(0) + 권장 시점들]을
      // track_intervals 로 설정한다. 복용직후(0)는 항상 기본 체크되도록 [0, ...recOffsets] 를
      // dedup(Set)·오름차순 정렬한다(예: 마도파 → 0/30/60/120). 권장이 없으면(비레보도파/약 없음)
      // 기존 기본값(DEFAULT_TRACK_INTERVALS, 이미 0 포함)을 유지. 생성 후 사용자는 onToggleInterval
      // 로 0 포함 어떤 시점이든 자유롭게 해제/추가 가능. (토글·기존 슬롯 편집에선 절대 추적시간을
      // 자동 변경하지 않는다.)
      const recOffsets = recommendForSlotMeds(
        medications.map((m) => ({ name: m.name })),
      ).offsets;
      const newTrackIntervals =
        recOffsets.length > 0
          ? [...new Set([0, ...recOffsets])].sort((a, b) => a - b)
          : DEFAULT_TRACK_INTERVALS;
      // 임시 슬롯(낙관적). id 는 'opt:' 접두 임시값 — refresh 로 진짜 행이 오면 정리됨.
      // (addOnly 경로에선 목록을 렌더하지 않으므로 화면엔 안 보이지만, 비-addOnly 추가와
      //  코드 경로를 공유하므로 그대로 둔다.)
      const optimistic: DoseSlot = {
        id: `opt:${Date.now()}`,
        patientId: pid,
        time: newTime,
        label: newLabel,
        sortOrder: newSort,
        remindEnabled: true,
        remindSoundId: null,
        remindAlarmMode: 'basic',
        trackEnabled: true,
        trackIntervals: newTrackIntervals,
        trackSoundId: null,
        trackAlarmMode: 'basic',
        legacyKey: null,
        isReal: false,
      };
      setAddedSlots((prev) => [...prev, optimistic]);

      try {
        // .select('id').single() 로 새 행의 실제 DB id 를 즉시 확보 → 수정 시트가 그 슬롯을 가리키게 함.
        const { data: inserted, error } = await supabase
          .from('dose_slots')
          .insert({
            patient_id: pid,
            time: newTime,
            label: newLabel,
            sort_order: newSort,
            remind_enabled: true,
            remind_sound_id: null,
            track_enabled: true,
            track_intervals: newTrackIntervals,
            track_sound_id: null,
            is_active: true,
          } as any)
          .select('id')
          .single();
        if (error) throw error;
        invalidateDoseSlotsCache(pid);
        // 실제 id 가 캐시에 반영된 뒤 전환해야 수정 시트(다른 useDoseSlots 인스턴스)가
        // 새 슬롯을 곧바로 보고 펼친다 → refresh 를 먼저 await 한 다음 onAddDone(id) 호출.
        await refresh();
        const newSlotId = (inserted as { id?: string } | null)?.id ?? null;
        // ⭐ 새 슬롯에 환자의 등록 약 전부를 자동 연결(medication_dose_slots).
        //   → 곧바로 열리는 편집뷰의 "이 시간에 드시는 약" 체크리스트가 전부 체크된 상태로 보이고,
        //     사용자는 이 시간에 안 드시는 약만 체크 해제하면 된다(기본값=전부 복용).
        //   새 슬롯이라 기존 링크가 없으므로 단순 insert 로 중복 없음.
        //   ⚠️ 쓰기 방식: .insert() 사용(.update() 아님). onAddDone 전에 await 해 솔로 편집뷰
        //     인스턴스(별도 useSlotMedications)가 마운트 시 링크를 곧장 읽도록 보장.
        if (newSlotId && medications.length > 0) {
          try {
            const linkRows = medications.map((m) => ({
              medication_id: m.id,
              dose_slot_id: newSlotId,
            }));
            const { error: linkErr } = await supabase
              .from('medication_dose_slots')
              .insert(linkRows as any);
            if (linkErr) throw linkErr;
            invalidateDoseSlotsCache(pid);
            // 같은 인스턴스(비-addOnly 전체관리 추가)에서도 전부 체크로 보이도록 시드.
            setMedChecked((prev) => ({
              ...prev,
              [newSlotId]: new Set(medications.map((m) => m.id)),
            }));
            await refreshSlotMeds();
          } catch (linkErr) {
            // 자동 연결 실패해도 슬롯 생성·흐름은 막지 않는다(편집뷰에서 직접 체크 가능).
            console.error('[DoseSlotSetList] failed to auto-link meds to the new slot:', linkErr);
          }
        }
        // addOnly 는 부모가 모달을 수정 시트로 전환하므로 건드리지 않는다.
        // 전체 관리 화면에서 추가한 경우엔 방금 만든 슬롯을 펼치고 그 위치로 스크롤.
        if (addOnly) onAddDone?.(newSlotId ?? undefined);
        else if (newSlotId) focusSlotAfterSave(newSlotId);
      } catch (e) {
        console.error('[DoseSlotSetList] dose_slots insert failed:', e);
        // 실패 시 낙관적 슬롯 롤백 + 모달 닫기(미저장 처리).
        setAddedSlots((prev) => prev.filter((s) => s.id !== optimistic.id));
        if (addOnly) onAddDone?.();
      } finally {
        insertingRef.current = false;
      }
    }
  }, [timeSheet, slots, patchSlot, refresh, dialog, addOnly, onAddDone, medications, refreshSlotMeds, userTz, soloSlotId, focusSlotAfterSave]);

  // ── 소프트 경고 판정: 이 슬롯의 추적 시각 중 (슬롯시각+분) > 다음 active 슬롯 시각? ──
  // 정렬된 active 슬롯에서 "이 슬롯 바로 다음" 시각을 찾음. 마지막 복용이면 경고 없음.
  const sortedActive = [...displaySlots].sort(
    (a, b) =>
      slotSortValue(a.time) - slotSortValue(b.time) || a.sortOrder - b.sortOrder,
  );
  const getOverlapWarning = (slot: DoseSlot): boolean => {
    if (!slot.trackEnabled || slot.trackIntervals.length === 0) return false;
    const idx = sortedActive.findIndex((s) => s.id === slot.id);
    if (idx < 0 || idx >= sortedActive.length - 1) return false; // 마지막 복용 = 경고 없음
    const thisMin = slotSortValue(slot.time);
    const nextMin = slotSortValue(sortedActive[idx + 1].time);
    if (!Number.isFinite(thisMin) || !Number.isFinite(nextMin)) return false;
    const maxTrack = Math.max(...slot.trackIntervals);
    return thisMin + maxTrack > nextMin;
  };

  if (loading && displaySlots.length === 0) {
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>{t('doseSlotSetList.sectionTitle')}</Text>
        <View style={styles.card}>
          <Text style={styles.loadingText}>{i18n.t('loading.loadingGeneric2')}</Text>
        </View>
      </View>
    );
  }

  // 단일 슬롯 편집 진입이면 그 슬롯만 노출(다른 슬롯 숨김).
  // 추가 전용(addOnly) 진입이면 목록은 일절 렌더하지 않고 시간 시트만 띄운다(시트 2겹 방지).
  const visibleSlots = addOnly
    ? []
    : soloSlotId
      ? displaySlots.filter((s) => s.id === soloSlotId)
      : displaySlots;

  return (
    <View style={[styles.section, (soloSlotId || addOnly) && styles.sectionSolo]}>
      {/* 단일 슬롯 편집은 카드 제목(아침 · 오전 8:30)이 곧 제목이므로 섹션 제목/설명 생략 */}
      {!soloSlotId && !addOnly && (
        <>
          <Text style={styles.sectionTitle}>{t('doseSlotSetList.sectionTitle')}</Text>
          <Text style={styles.sectionDesc}>
            {t('doseSlotSetList.sectionDesc')}
          </Text>
        </>
      )}

      {/* 안내 박스 (전체 관리 진입에서만) */}
      {!soloSlotId && !addOnly && (
        <View style={styles.guide}>
          <Text style={styles.guideTitle}>{t('doseSlotSetList.guideTitle')}</Text>
          <Text style={styles.guideBody}>
            {t('doseSlotSetList.guideBody')}
          </Text>
        </View>
      )}

      {visibleSlots.map((slot) => {
        if (!slot.id) return null;
        const expanded = expandedId === slot.id;
        // 왼쪽 띠: 약 복용/약효 추적 중 하나라도 켜져 있으면 오렌지, 둘 다 꺼지면 회색
        const cardOn = slot.remindEnabled || slot.trackEnabled;
        // 시각 제목 dim: 약 복용 알림이 꺼져 있으면 흐리게 (와이어프레임 점심 카드)
        const timeDim = !slot.remindEnabled;
        const warn = getOverlapWarning(slot);
        // ── 슬롯-약 연결 계산 ──
        // 독립 "이 시간에 드시는 약" 박스(약 체크리스트)와 약효추적 박스의 권장 시점 안내가 공유.
        // medChecked 가 진실원(슬롯당 1회 slotMeds 로 시드). 체크된 약 기준으로 레보도파 권장 시점 산출.
        const sid = slot.id;
        const medSeeded = sid in medChecked;
        const checkedSet =
          medChecked[sid] ?? new Set((slotMeds[sid] ?? []).map((m) => m.id));
        const checkedMeds = medications.filter((m) => checkedSet.has(m.id));
        const rec = recommendForSlotMeds(checkedMeds.map((m) => ({ name: m.name })));
        const showRec = rec.levodopaNames.length > 0 && rec.offsets.length > 0;
        const recSentence = showRec
          ? buildMainSentence(rec.levodopaNames, rec.offsets)
          : null;
        return (
          <View
            key={slot.id}
            style={[styles.card, cardOn ? styles.cardOn : styles.cardOff, soloSlotId && styles.cardSolo]}
            onLayout={(e) => {
              const id = slot.id!;
              const y = e.nativeEvent.layout.y;
              slotLayoutY.current.set(id, y);
              // 이 슬롯으로 스크롤이 예약돼 있으면(외부 포커스 진입) 위치 확정 후 위임.
              if (pendingScrollIdRef.current === id && onFocusScrollTo) {
                pendingScrollIdRef.current = null;
                onFocusScrollTo(y);
              }
            }}
          >
            {/* ── 시각 제목 줄 (+ 우측 상단 수정 버튼) ── */}
            <View style={styles.slotHead}>
              <View style={[styles.slotEmoji, timeDim && styles.slotEmojiOff]}>
                <SlotTimeIcon time={slot.time} size={30} />
              </View>
              <Text style={[styles.slotTime, timeDim && styles.slotTimeOff]}>
                {slotTitle(slot)}
              </Text>
              {/* 단일 슬롯 수정 진입(solo)에선 상단 닫기 없음 — 하단 '닫기·완료' 행으로 대체 */}
              {!soloSlotId && !expanded && (
                <View style={styles.slotHeadActions}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.slotIconBtn}
                    onPress={() => toggleExpand(slot.id!)}
                  >
                    <Ionicons name="create-outline" size={22} color={Colors.textSub} />
                  </TouchableOpacity>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    style={styles.slotIconBtnDelete}
                    onPress={() => onDeleteSlot(slot)}
                  >
                    <Ionicons name="trash-outline" size={22} color={Colors.danger} />
                  </TouchableOpacity>
                </View>
              )}
            </View>

            {!expanded ? (
              /* ── 접힌 카드: 두 알림 토글 + (켜지면) 알림음 + 추적 요약 + 수정 ── */
              <>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLead, !slot.remindEnabled && styles.rowLeadOff]}>
                      {t('doseSlotSetList.medAlarm')}
                    </Text>
                  </View>
                  <Switch
                    value={slot.remindEnabled}
                    onValueChange={(v) => onToggleRemind(slot, v)}
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.white}
                  />
                </View>

                <View style={styles.divider} />

                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLead, !slot.trackEnabled && styles.rowLeadOff]}>
                      {t('doseSlotSetList.effectTrackAlarm')}
                    </Text>
                    {slot.trackEnabled && (
                      <Text style={styles.summary}>
                        {summarizeTrackIntervals(slot.trackIntervals)}
                      </Text>
                    )}
                  </View>
                  <Switch
                    value={slot.trackEnabled}
                    onValueChange={(v) => onToggleTrack(slot, v)}
                    trackColor={{ false: Colors.border, true: Colors.primary }}
                    thumbColor={Colors.white}
                  />
                </View>

              </>
            ) : (
              /* ── 펼친 카드: 2박스 레이아웃 ── */
              <>
                {/* ══ 박스1: 약 복용 알림 (연한 파랑) ══ */}
                <View style={[styles.boxBlock, styles.boxAlarm]}>
                  <View style={styles.boxHead}>
                    <Text style={styles.boxTitle}>{t('doseSlotSetList.medAlarm')}</Text>
                    <Switch
                      value={slot.remindEnabled}
                      onValueChange={(v) => onToggleRemind(slot, v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor={Colors.white}
                    />
                  </View>

                  {slot.remindEnabled && (
                    <>
                      {/* 알림 시간 + 수정 */}
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.timeRow}
                        onPress={() => openTimeSheet(slot)}
                      >
                        <View style={styles.timeRowLeft}>
                          <Ionicons name="time-outline" size={20} color={Colors.textSub} />
                          <Text style={styles.timeRowLabel}>{t('doseSlotSetList.alarmTime')}</Text>
                        </View>
                        <View style={styles.timeRowRight}>
                          <Text style={styles.timeRowValue}>
                            {formatSlotTime(slot.time)}
                          </Text>
                          <Ionicons name="chevron-forward" size={18} color={Colors.textSub} />
                        </View>
                      </TouchableOpacity>
                      {/* 알림음 선택은 접힌 카드(토글 아래)로 이동 — 여기선 시간만 편집. */}
                    </>
                  )}
                </View>

                {/* ══ 독립 박스: 이 시간에 드시는 약 ══
                    약효추적 토글과 무관하게 펼친 편집뷰에서 항상 표시(약 1개 이상). 체크리스트 하나로
                    약-슬롯 연결(medication_dose_slots)을 편집. 약 0개면 등록 CTA, 로딩 중엔 깜빡임 방지 안내.
                    새 슬롯은 등록 약이 전부 자동 연결되어 기본 전부 체크 → 안 드시는 약만 해제하면 됨. */}
                <View style={[styles.boxBlock, styles.boxMeds]}>
                  <Text style={styles.boxTitle}>{t('doseSlotSetList.medsAtThisTime')}</Text>
                  {(() => {
                    // 분기 A: 등록된 약이 0개 → 약 등록하러 가기 CTA(연결할 약이 없음).
                    if (!hasAnyMed && !slotMedsLoading) {
                      return (
                        <View style={styles.medEmptyBlock}>
                          <Text style={styles.recMain}>
                            {t('doseSlotSetList.noMedsRegistered')}
                          </Text>
                          <TouchableOpacity
                            activeOpacity={0.85}
                            style={styles.recRegisterBtn}
                            onPress={() => {
                              // 시트(Modal)로 떠 있는 상태면 이동 전에 먼저 닫는다 — 안 닫으면
                              // 내부적으론 이동했는데 시트가 화면을 덮고 있어 "버튼이 안 먹는다"처럼 보임.
                              onSoloClose?.();
                              if (onGoRegisterMeds) {
                                // 해외판(OverseasMedTabScreen)처럼 이 컴포넌트가 이미 "약 관리"와
                                // 같은 화면에 내장된 경우 — 로컬 탭만 전환(다른 바텀탭으로 안 감).
                                onGoRegisterMeds();
                                return;
                              }
                              // ⚠️ 이 컴포넌트는 BodyStateScreen/MealTimeModal 등 MenuNavigator
                              // 바깥(다른 탭)에서도 마운트되므로 로컬 useNavigation()으로는
                              // 'MedicationManage'를 못 찾아 조용히 실패한다(다른 탭에서 버튼 무반응 버그).
                              // 루트 기준 전역 네비게이션(navigateTo)으로 항상 도달 가능하게 한다.
                              navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedicationManage', params: { mode: 'meds' } } });
                            }}
                          >
                            <Text style={styles.recRegisterBtnText}>{t('doseSlotSetList.goRegisterMeds')}</Text>
                          </TouchableOpacity>
                        </View>
                      );
                    }
                    // 분기 B: 약 목록/연결 로딩 중(아직 미시드) → 빈 체크 깜빡임 방지용 안내.
                    if (!medSeeded && slotMedsLoading) {
                      return (
                        <Text style={styles.medLoadingText}>{i18n.t('loading.loadingMedList')}</Text>
                      );
                    }
                    // 분기 C: 약 1개 이상 → 복용약 체크리스트(전부 자동연결 → 기본 전부 체크).
                    return (
                      <>
                        <Text style={styles.medPickSub}>
                          {t('doseSlotSetList.uncheckIfNotTaken')}
                        </Text>
                        {medications.map((m) => {
                          const checked = checkedSet.has(m.id);
                          return (
                            <TouchableOpacity
                              key={m.id}
                              activeOpacity={0.8}
                              style={styles.medPickRow}
                              onPress={() => onToggleMedLink(sid, m.id)}
                            >
                              <View
                                style={[styles.medPickChk, checked && styles.medPickChkOn]}
                              >
                                {checked && (
                                  <Ionicons
                                    name="checkmark-sharp"
                                    size={18}
                                    color={Colors.white}
                                  />
                                )}
                              </View>
                              <Text style={styles.medPickName}>{m.name}</Text>
                            </TouchableOpacity>
                          );
                        })}
                      </>
                    );
                  })()}
                </View>

                {/* ══ 박스2: 약효 추적 알림 (연한 초록) ══ */}
                <View style={[styles.boxBlock, styles.boxTrack]}>
                  <View style={styles.boxHead}>
                    <Text style={styles.boxTitle}>{t('doseSlotSetList.effectTrackAlarm')}</Text>
                    <Switch
                      value={slot.trackEnabled}
                      onValueChange={(v) => onToggleTrack(slot, v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor={Colors.white}
                    />
                  </View>

                  {slot.trackEnabled && (
                    <>
                      {/* ── 권장 시점 안내(레보도파 계열) ──
                          약 선택은 위 "이 시간에 드시는 약" 독립 박스에서 하고, 여기선 체크된 약 기준
                          권장 추적 시점만 안내(약효추적 박스 맥락 유지).
                          ⚠️ 약 체크/해제 시 시트가 출렁이지 않도록 recBox 는 trackEnabled 동안 '항상 마운트'
                          하고 '고정 높이'를 차지한다. 토글은 박스 안의 글자(내용)만 바꿀 뿐 높이는 불변
                          (조건부 mount 제거 + 각 줄 numberOfLines 클램프 + 각 Text minHeight 로 줄 수 변화 흡수).
                          권장 대상이 없으면 같은 자리·같은 높이에 중립 문구만 채운다. */}
                      <View style={styles.recBox}>
                        {/* numberOfLines 고정 금지: 영문은 약이 여러 개거나 권장 시점이 여러 개면
                            문장이 꽤 길어진다("...after taking A and B and C." 식). 2줄로 자르면
                            정작 중요한 복용 안내 문구가 "..."로 잘려버려 그게 더 나쁘다.
                            recMain은 minHeight(최소값)라 줄이 늘어도 그냥 박스가 커질 뿐 안 깨진다. */}
                        <Text style={styles.recMain}>
                          {showRec && recSentence
                            ? (isOverseasLocale()
                                ? t('doseSlotSetList.recSentenceEn', { subject: recSentence.subject, timing: recSentence.timing })
                                : `${recSentence.subject}${recSentence.particle} ${recSentence.timing}에 몸 상태를 확인하는 걸 추천해요.`)
                            : t('doseSlotSetList.noRecTiming')}
                        </Text>
                        {/* numberOfLines=1 제거: source가 실제로는 "US FDA & manufacturer drug
                            information"처럼 길어서(recSourceLabel 템플릿만 보고 짧다고 착각한 게
                            recMain과 똑같은 실수) 1줄로는 잘렸었다. recSource도 minHeight라 안전. */}
                        <Text style={styles.recSource}>
                          {showRec && rec.source ? t('doseSlotSetList.recSourceLabel', { source: rec.source }) : ' '}
                        </Text>
                        <Text style={styles.recDisclaimer}>
                          {showRec
                            ? t('doseSlotSetList.recDisclaimer')
                            : ' '}
                        </Text>
                      </View>

                      <Text style={styles.qHead}>
                        {t('doseSlotSetList.trackTimeLabel')}{' '}
                        <Text style={styles.qHeadSmall}>{t('doseSlotSetList.multiSelectHint')}</Text>
                      </Text>

                      {(() => {
                        // 프리셋 5개 + track_intervals 의 비프리셋 값들을 분 오름차순으로 2열 배치.
                        // 비프리셋(예 240=4시간) 값도 체크 상태로 떠서 다시 누르면 해제 가능.
                        const extraRows = slot.trackIntervals
                          .filter((m) => !PRESET_MINUTES.has(m))
                          .map((m) => ({ minutes: m, label: minutesToCheckLabel(m) }));
                        const rows = [...getTrackOptions(), ...extraRows].sort(
                          (a, b) => a.minutes - b.minutes,
                        );
                        return (
                          <>
                            {/* 한 줄에 2개씩(2열) — 어르신 가독성 위해 글씨·터치영역 유지 */}
                            <View style={styles.checkGrid}>
                              {rows.map((opt) => {
                                const sel = slot.trackIntervals.includes(opt.minutes);
                                return (
                                  <TouchableOpacity
                                    key={opt.minutes}
                                    activeOpacity={0.8}
                                    style={styles.checkCell}
                                    onPress={() => onToggleInterval(slot, opt.minutes)}
                                  >
                                    <View style={[styles.box, sel && styles.boxSel]}>
                                      {sel && (
                                        <Ionicons name="checkmark-sharp" size={18} color={Colors.white} />
                                      )}
                                    </View>
                                    <View style={styles.checkText}>
                                      <Text style={styles.checkLabel}>{opt.label}</Text>
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}
                              {/* ＋ 직접 추가 — 마지막 옵션(3시간 후) 오른쪽, 같은 크기 칸 */}
                              <TouchableOpacity
                                activeOpacity={0.7}
                                style={styles.addIntervalCell}
                                onPress={() =>
                                  setIntervalSheet({ slotId: slot.id!, hour: 4, minute: 0 })
                                }
                              >
                                {/* "+" 를 윗줄 체크박스 자리에 맞춤(같은 26px 슬롯) */}
                                <View style={styles.addPlusSlot}>
                                  <Ionicons name="add" size={24} color={Colors.dark} />
                                </View>
                                <Text style={styles.addIntervalCellText}>{t('doseSlotSetList.addDirectly')}</Text>
                              </TouchableOpacity>
                            </View>
                            {/* "복용 직후" 힌트 — ⓘ와 본문 분리(행잉 인덴트): 줄바꿈 시 둘째 줄이 본문에 맞춰 시작 */}
                            <View style={styles.checkHintRow}>
                              <Text style={styles.checkHintIcon}>ⓘ</Text>
                              <Text style={[styles.checkHint, styles.checkHintBody]}>
                                {t('doseSlotSetList.rightAfterHint')}
                              </Text>
                            </View>
                          </>
                        );
                      })()}

                      {/* 소프트 경고 (막지 않음) */}
                      {warn && (
                        <View style={styles.warn}>
                          <HangingText text={t('doseSlotSetList.warnTitle')} style={styles.warnTitle} />
                          <Text style={styles.warnBody}>
                            {t('doseSlotSetList.warnBody')}
                          </Text>
                        </View>
                      )}

                      {/* 알림음 선택은 접힌 카드(토글 아래)로 이동 — 여기선 추적 시간만 편집. */}
                    </>
                  )}
                </View>

                {/* ── 박스 밖: 단일 슬롯 편집(solo)=닫기·완료 한 줄, 아니면 완료(접기) ── */}
                {soloSlotId && onSoloClose ? (
                  <View style={{ flexDirection: 'row', gap: 12, marginTop: 14 }}>
                    <TouchableOpacity activeOpacity={0.7} style={styles.sheetCancelBtn} onPress={onSoloClose}>
                      <Text style={styles.sheetCancelBtnText}>{t('common.close')}</Text>
                    </TouchableOpacity>
                    <TouchableOpacity activeOpacity={0.85} style={styles.sheetSaveBtn} onPress={onSoloClose}>
                      <Text style={styles.saveBtnText}>{t('doseSlotSetList.done')}</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <TouchableOpacity
                    activeOpacity={0.85}
                    style={styles.doneBtn}
                    onPress={() => toggleExpand(slot.id!)}
                  >
                    <Text style={styles.doneBtnText}>{t('doseSlotSetList.done')}</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        );
      })}

      {/* ＋ 복용 시간대 추가하기 (전체 관리 진입에서만) */}
      {!soloSlotId && !addOnly && (
        <TouchableOpacity
          activeOpacity={0.7}
          style={styles.addBtn}
          onPress={() => openTimeSheet(null)}
        >
          <Ionicons name="add-circle-outline" size={22} color={Colors.dark} />
          <Text style={styles.addBtnText}>{t('doseSlotSetList.addTimeSlot')}</Text>
        </TouchableOpacity>
      )}

      {/* ── 시간/분 선택 바텀시트 ── */}
      <TimePickerSheet
        state={timeSheet}
        onChange={setTimeSheet}
        onSave={onSaveTime}
        onClose={() => {
          // onClose 는 이미 시트 내부에서 슬라이드-아웃 애니가 끝난 뒤 호출된다(runClose/스와이프 공통).
          //  → 이 시점에 시트는 화면에서 사라진 상태이므로 호스트(animationType="none")를 바로 닫아도
          //    닫힘 슬라이드가 중복되지 않는다(이전의 CLOSE_SLIDE_MS 순차 지연 불필요 → 제거).
          //  ⚠️ 저장(완료) 경로는 onSaveTime 이 처리하므로 여기 변경의 영향 없음(추가→편집 전환 무손상).
          setTimeSheet(null);
          if (addOnly) onAddDone?.();
        }}
      />

      {/* ── 추적 시각 직접 추가 바텀시트 ── */}
      <IntervalPickerSheet
        state={intervalSheet}
        onChange={setIntervalSheet}
        onAdd={onAddInterval}
        onClose={() => setIntervalSheet(null)}
      />
    </View>
  );
}

// 시각/간격 선택 시트(TimePickerSheet·IntervalPickerSheet)의 단일-애니 슬라이드 파라미터.
// Modal animationType="none" + translateY 하나로 열기/닫기를 직접 구동한다(닫힘 애니 2겹 방지).
const SHEET_ENTER_OFFSET = 600;  // 열기 시작 위치(화면 아래) px
const SHEET_ENTER_MS = 240;      // 슬라이드-인 시간
const SHEET_CLOSE_OFFSET = 700;  // 닫기 목표 위치(화면 밖) px — 훅 closeTo 기본값과 동일
const SHEET_CLOSE_MS = 220;      // 슬라이드-아웃 시간 — 훅 스와이프 닫힘 200ms와 근사

// ─── 시간/분 선택용 데이터 ─────────────────────────────────
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTES = Array.from({ length: 12 }, (_, i) => i * 5); // 0,5,…,55 (5분 단위)

// ─── 스크롤 컬럼 선택기 (진료 일정 시간선택과 동일 방식 — 탭 선택, 휠 아님) ──────────
const PICK_ITEM_H = 50;
const PICK_COL_H = 250; // colsRow 높이(=뷰포트). 이 안에 다 들어오는 짧은 목록은 스크롤 불필요.
function PickerCol<T extends string | number>({
  items, selected, onSelect,
}: {
  items: { value: T; label: string }[];
  selected: T;
  onSelect: (v: T) => void;
}) {
  const ref = useRef<FlatList<{ value: T; label: string }>>(null);
  const selectedIndex = Math.max(0, items.findIndex((it) => it.value === selected));
  // 항목이 뷰포트에 다 들어오면(예: 오전/오후 2개) 선택 항목을 맨 위로 스크롤하지 않는다.
  //   안 그러면 오후(index 1) 선택 시 오전(index 0)이 위로 밀려 숨어 고를 수 없다.
  const fitsAll = items.length * PICK_ITEM_H <= PICK_COL_H;
  useEffect(() => {
    if (fitsAll) return;
    if (ref.current) ref.current.scrollToOffset({ offset: selectedIndex * PICK_ITEM_H, animated: false });
  }, [selected, selectedIndex, fitsAll]);
  return (
    <View style={{ flex: 1 }}>
      <FlatList
        ref={ref}
        data={items}
        keyExtractor={(it) => String(it.value)}
        initialScrollIndex={fitsAll ? 0 : selectedIndex}
        getItemLayout={(_, index) => ({ length: PICK_ITEM_H, offset: PICK_ITEM_H * index, index })}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => {}}
        onLayout={() => { if (!fitsAll && ref.current) ref.current.scrollToOffset({ offset: selectedIndex * PICK_ITEM_H, animated: false }); }}
        renderItem={({ item }) => {
          const isSel = item.value === selected;
          return (
            <TouchableOpacity
              style={[pickStyles.item, isSel && pickStyles.itemActive]}
              onPress={() => onSelect(item.value)}
              activeOpacity={0.7}
            >
              <Text style={[pickStyles.itemText, isSel && pickStyles.itemTextActive]}>{item.label}</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

const pickStyles = StyleSheet.create({
  colsRow: { flexDirection: 'row', height: 250 },
  col: { flex: 1 },
  colHeader: {
    fontSize: 15, fontWeight: '600', color: Colors.textSub,
    textAlign: 'center', paddingBottom: 6,
    borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 4,
  },
  colDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 8 },
  item: {
    height: PICK_ITEM_H, justifyContent: 'center', alignItems: 'center',
    borderRadius: 8, marginHorizontal: 3, marginVertical: 1,
  },
  itemActive: { backgroundColor: Colors.light },
  itemText: { color: Colors.text, fontSize: 20 },
  itemTextActive: { color: Colors.primary, fontWeight: '700' },
});

interface TimeSheetState {
  mode: 'edit' | 'add';
  slotId: string | null;
  ampm: AmPm;
  hour: number;
  minute: number;
}

function TimePickerSheet({
  state,
  onChange,
  onSave,
  onClose,
}: {
  state: TimeSheetState | null;
  onChange: (s: TimeSheetState) => void;
  onSave: () => void;
  onClose: () => void;
}) {
  // 스와이프 닫기는 공용 훅(translateY 1개)이 처리. 닫힘 애니가 2개(Modal slide-out + 훅
  // translateY)면 "두 번 닫힘"이 보이므로, Modal animationType="none" 으로 두고 열기/닫기
  // 슬라이드를 이 translateY 하나로만 구동한다(MealTimeModal 패턴). 닫기 4경로 전부 한 번만.
  const { t } = useTranslation();
  const { translateY, panHandlers } = useSwipeDownDismiss(onClose);
  const sheetPad = useBottomSheetPadding(32);
  const visible = !!state;
  // 열기: 화면 밖(아래) → 0 슬라이드-인. (animationType none 이라 직접 구동해야 툭 안 뜬다.)
  React.useEffect(() => {
    if (visible) {
      translateY.setValue(SHEET_ENTER_OFFSET);
      Animated.timing(translateY, {
        toValue: 0,
        duration: SHEET_ENTER_MS,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);
  // 닫기 공통: 슬라이드-아웃 후 onClose(스와이프 경로의 훅 동작과 동일한 단일 애니).
  const runClose = React.useCallback(() => {
    Animated.timing(translateY, {
      toValue: SHEET_CLOSE_OFFSET,
      duration: SHEET_CLOSE_MS,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [onClose, translateY]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={runClose}>
      <View style={styles.backdrop}>
        {/* 닫기 터치는 시트 뒤 절대배치 레이어로 분리 → 휠 위엔 터치 조상 0개 */}
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={runClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: sheetPad, transform: [{ translateY }] }]}
        >
          {/* 스와이프-닫기는 상단 손잡이/제목 영역에만 (휠 스크롤과 충돌 방지) */}
          <View {...panHandlers}>
            <View style={styles.handle} />
            {state && (
              <Text style={styles.sheetTitle}>
                {state.mode === 'add' ? t('doseSlotSetList.addTimeSlot') : t('doseSlotSetList.editAlarmTime')}
              </Text>
            )}
          </View>
          {state && (
            <View>
              {/* 오전/오후 · 시 · 분 — 스크롤 컬럼(탭 선택, 진료 일정 시간선택과 동일) */}
              <View style={pickStyles.colsRow}>
                <View style={pickStyles.col}>
                  <Text style={pickStyles.colHeader}>{t('doseSlotSetList.ampmHeader')}</Text>
                  <PickerCol
                    items={[
                      { value: 'am', label: t('common.am') },
                      { value: 'pm', label: t('common.pm') },
                    ]}
                    selected={state.ampm}
                    onSelect={(v) => {
                      // 오후로 전환 시 이전 시각(오전 값)이 그대로 남아 불편 → 1시로 초기화.
                      const nextHour = v === 'pm' ? 1 : state.hour;
                      onChange({ ...state, ampm: v as AmPm, hour: nextHour });
                    }}
                  />
                </View>
                <View style={pickStyles.colDivider} />
                <View style={pickStyles.col}>
                  <Text style={pickStyles.colHeader}>{t('doseSlotSetList.hourHeader')}</Text>
                  <PickerCol
                    items={HOURS.map((h) => ({ value: h, label: String(h) }))}
                    selected={state.hour}
                    onSelect={(v) => onChange({ ...state, hour: v as number })}
                  />
                </View>
                <View style={pickStyles.colDivider} />
                <View style={pickStyles.col}>
                  <Text style={pickStyles.colHeader}>{t('doseSlotSetList.minuteHeader')}</Text>
                  <PickerCol
                    items={MINUTES.map((m) => ({ value: m, label: String(m).padStart(2, '0') }))}
                    selected={state.minute}
                    onSelect={(v) => onChange({ ...state, minute: v as number })}
                  />
                </View>
              </View>

              {/* 닫기 · 완료 한 줄(완료 우측) */}
              <View style={styles.sheetBtnRow}>
                <TouchableOpacity activeOpacity={0.7} style={styles.sheetCancelBtn} onPress={runClose}>
                  <Text style={styles.sheetCancelBtnText}>{t('common.close')}</Text>
                </TouchableOpacity>
                <TouchableOpacity activeOpacity={0.85} style={styles.sheetSaveBtn} onPress={onSave}>
                  <Text style={styles.saveBtnText}>{t('doseSlotSetList.done')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── 추적 시각 직접 추가 바텀시트 (스와이프 다운 닫기) ──────────────────────────
// 선택 위주: 흔한 추가 시각(4·5·6시간) 큰 버튼 + 정밀 조정용 시/분 스텝퍼.
interface IntervalSheetState {
  slotId: string;
  hour: number;
  minute: number;
}

function IntervalPickerSheet({
  state,
  onChange,
  onAdd,
  onClose,
}: {
  state: IntervalSheetState | null;
  onChange: (s: IntervalSheetState) => void;
  onAdd: (slotId: string, minutes: number) => void;
  onClose: () => void;
}) {
  // 닫힘 애니 1개 원칙(TimePickerSheet 와 동일): Modal none + translateY 하나로 열기/닫기.
  const { t } = useTranslation();
  const { translateY, panHandlers } = useSwipeDownDismiss(onClose);
  const sheetPad = useBottomSheetPadding(32);
  const visible = !!state;
  React.useEffect(() => {
    if (visible) {
      translateY.setValue(SHEET_ENTER_OFFSET);
      Animated.timing(translateY, {
        toValue: 0,
        duration: SHEET_ENTER_MS,
        useNativeDriver: true,
      }).start();
    }
  }, [visible]);
  const runClose = React.useCallback(() => {
    Animated.timing(translateY, {
      toValue: SHEET_CLOSE_OFFSET,
      duration: SHEET_CLOSE_MS,
      useNativeDriver: true,
    }).start(() => onClose());
  }, [onClose, translateY]);

  const totalMinutes = state ? state.hour * 60 + state.minute : 0;
  const clampHour = (h: number) => Math.max(0, Math.min(12, h));
  const clampMinute = (m: number) => Math.max(0, Math.min(55, m));

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={runClose}>
      {/* 휠 위에 Touchable/PanResponder 조상 두면 스크롤 가로채 닫힘 → 배경 View + 뒤 닫기터치 */}
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={runClose} />
        <Animated.View
          style={[styles.sheet, { paddingBottom: sheetPad, transform: [{ translateY }] }]}
        >
          {/* 스와이프-닫기는 상단 손잡이/제목 영역에만 */}
          <View {...panHandlers}>
            <View style={styles.handle} />
            {state && <Text style={styles.sheetTitle}>{t('doseSlotSetList.addTrackTimeTitle')}</Text>}
          </View>
          {state && (
            <View>
              {/* 시간·분 — 스크롤 컬럼(탭 선택) */}
              <View style={pickStyles.colsRow}>
                <View style={pickStyles.col}>
                  <Text style={pickStyles.colHeader}>{t('doseSlotSetList.hourHeader')}</Text>
                  <PickerCol
                    items={INTERVAL_HOURS.map((h) => ({ value: h, label: String(h) }))}
                    selected={state.hour}
                    onSelect={(v) => onChange({ ...state, hour: v as number })}
                  />
                </View>
                <View style={pickStyles.colDivider} />
                <View style={pickStyles.col}>
                  <Text style={pickStyles.colHeader}>{t('doseSlotSetList.minuteHeader')}</Text>
                  <PickerCol
                    items={INTERVAL_MINS.map((m) => ({ value: m, label: String(m).padStart(2, '0') }))}
                    selected={state.minute}
                    onSelect={(v) => onChange({ ...state, minute: v as number })}
                  />
                </View>
              </View>

              {/* 미리보기 (선택한 값이 프리셋이면 그 프리셋으로 자동 적용됨) */}
              <Text style={styles.intervalPreview}>
                {t('doseSlotSetList.trackPreview', { label: minutesToCheckLabel(totalMinutes) })}
              </Text>

              {/* 닫기 · 추가 한 줄(닫기 왼쪽·추가 오른쪽) */}
              <View style={styles.sheetBtnRow}>
                <TouchableOpacity activeOpacity={0.7} style={styles.sheetCancelBtn} onPress={runClose}>
                  <Text style={styles.sheetCancelBtnText}>{t('common.close')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.sheetSaveBtn}
                  onPress={() => onAdd(state.slotId, totalMinutes)}
                >
                  <Text style={styles.saveBtnText}>{t('doseSlotSetList.addBtn')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}
        </Animated.View>
      </View>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
  // 단일 슬롯 편집 진입 — 섹션 제목 없이 카드가 맨 위에 오도록 여백 제거
  sectionSolo: {
    marginTop: 0,
  },
  soloCloseBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    marginLeft: 'auto', paddingHorizontal: 12, paddingVertical: 8,
    borderRadius: 10, backgroundColor: '#EEF0F3',
  },
  soloCloseText: { fontSize: 16, fontWeight: '700', color: Colors.dark },
  sectionTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
    marginLeft: 2,
    marginBottom: 4,
  },
  sectionDesc: {
    fontSize: 15,
    color: Colors.textSub,
    marginLeft: 2,
    marginBottom: 12,
  },
  loadingText: {
    fontSize: 17,
    color: Colors.textSub,
    padding: 20,
    textAlign: 'center',
  },

  // 안내 박스
  guide: {
    backgroundColor: Colors.light,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
  },
  guideTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark,
  },
  guideBody: {
    fontSize: 15,
    color: '#3a5a3c',
    lineHeight: 22,
    marginTop: 8,
  },

  // 카드
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 18,
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  cardOn: {},
  cardOff: {
    backgroundColor: '#F9F9F9',
  },
  // 단일 슬롯 편집(바텀시트) — 카드 박스 껍데기 제거. 내용이 시트에 바로 채워지도록.
  cardSolo: {
    backgroundColor: 'transparent',
    borderRadius: 0,
    padding: 0,
    marginBottom: 0,
    elevation: 0,
    shadowOpacity: 0,
    shadowRadius: 0,
    shadowOffset: { width: 0, height: 0 },
  },

  // ── 2박스 레이아웃 ──
  boxBlock: {
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginTop: 10,
    // 살짝 그림자(박스 구분감)
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  boxAlarm: {
    backgroundColor: BOX_ALARM_BG, // 연한 파랑
  },
  boxTrack: {
    backgroundColor: '#EAF6EC', // 연한 초록(약 복용 알림 박스와 살짝 구분)
  },
  // 독립 "이 시간에 드시는 약" 박스 — 파랑(알림)·초록(추적)과 구분되는 연한 중립톤.
  boxMeds: {
    backgroundColor: '#F4F6F8',
  },
  // 박스 안 항목 구분선 (테두리 박스 대신 얇은 선)
  innerDivider: {
    height: 1,
    backgroundColor: 'rgba(0,0,0,0.06)',
    marginTop: 6,
  },
  boxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 40,
  },
  boxTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '800',
    color: Colors.text,
  },
  // 박스1: 알림 시간 행 (수정으로 진입) — 평평하게(테두리·흰배경 제거)
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
    // 알림 소리 행(AlarmSoundPickerRow.triggerBtn)과 좌우 라인 정렬: paddingHorizontal 14 동일
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginTop: 2,
  },
  timeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeRowLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  timeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    marginLeft: 'auto',
  },
  timeRowValue: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.dark,
  },
  editPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  editPillText: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.dark,
  },
  slotHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 6,
  },
  slotEmoji: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotEmojiOff: {
    backgroundColor: '#EEEEEE',
  },
  slotEmojiText: {
    fontSize: 20,
  },
  slotTime: {
    flex: 1,
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
  },
  slotHeadActions: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  slotIconBtn: {
    marginLeft: 12,
    padding: 4,
  },
  slotIconBtnDelete: {
    marginLeft: 8,
    padding: 4,
  },
  slotTimeOff: {
    color: '#999999',
  },
  divider: {
    height: 1,
    backgroundColor: Colors.border,
    marginVertical: 14,
  },

  // 토글 행
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 56,
  },
  rowText: {
    flex: 1,
  },
  rowLead: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  rowLeadOff: {
    color: '#999999',
  },
  summary: {
    fontSize: 15,
    color: '#444444',
    marginTop: 8,
    lineHeight: 21,
  },

  // 질문 헤더
  qHead: {
    fontSize: 16,
    color: '#444444',
    fontWeight: '700',
    marginTop: 6,
    marginBottom: 6,
    marginLeft: 2,
  },
  qHeadSmall: {
    fontWeight: '500',
    color: Colors.textSub,
    fontSize: 14,
  },

  // 체크줄 — 한 줄에 2개씩(2열 그리드)
  checkGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
  },
  checkCell: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  // ＋직접추가 — 체크칸과 동일 정렬(테두리 없음, "+"는 체크박스 자리)
  addIntervalCell: {
    width: '48%',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    minHeight: 44,
    paddingVertical: 6,
    paddingHorizontal: 2,
    marginBottom: 2,
  },
  // "+" 슬롯 — 체크박스(26px)와 같은 폭·위치
  addPlusSlot: {
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addIntervalCellText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark,
  },
  box: {
    width: 26,
    height: 26,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#BBBBBB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  boxSel: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  checkText: {
    flex: 1,
  },
  checkLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  checkHint: {
    fontSize: 14,
    color: Colors.accent,
    marginTop: 4,
    marginBottom: 4,
    marginLeft: 2,
    lineHeight: 20,
  },
  // 행잉 인덴트: ⓘ + 본문 분리. 본문이 자기 폭에서 줄바꿈 → 둘째 줄이 본문 시작에 맞춰짐.
  checkHintRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginTop: 4,
    marginBottom: 4,
    marginLeft: 2,
  },
  checkHintIcon: {
    fontSize: 14,
    color: Colors.accent,
    lineHeight: 20,
    marginRight: 4,
  },
  checkHintBody: {
    flex: 1,
    marginTop: 0,
    marginBottom: 0,
    marginLeft: 0,
  },

  // ＋ 다른 시간 더하기 (체크줄 영역 맨 아래, 아웃라인)
  addIntervalBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 14,
    marginTop: 2,
    marginBottom: 12,
  },
  addIntervalBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },

  // 소프트 경고
  warn: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 5,
    borderLeftColor: Colors.accent,
    borderRadius: 12,
    padding: 14,
    marginTop: 4,
    marginBottom: 12,
  },
  warnTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#9a5b00',
  },
  warnBody: {
    fontSize: 14,
    color: '#7a5320',
    lineHeight: 21,
    marginTop: 6,
  },

  // ── 슬롯 약 기반 권장 시점 안내(약효추적 박스2) ──
  // 경고 톤 아님 — 부드러운 안내(연한 초록 카드 + 좌측 강조선). 경고아이콘(⚠️) 금지·ⓘ/💬만.
  // 시각 위계: 메인(19sp, 또렷) > 추천근거(15sp, 차분) > 면책(13sp, 흐림).
  // 안내 카드 — 그림자/elevation 0, 좌측 컬러바·진한 색강조 제거.
  // 아주 연한 중립톤 배경 + radius 12 + 넉넉한 패딩. 위계는 글자 크기·여백으로만.
  recBox: {
    backgroundColor: '#F7F8F9',
    borderRadius: 12,
    paddingVertical: 16,
    paddingHorizontal: 16,
    marginTop: 6,
    marginBottom: 12,
  },
  // 메인 안내 — 시점만(약효 설명 제거). 기본 텍스트색 단색, 일반 weight, 색강조 없음.
  // minHeight = lineHeight(25) × 2줄 = 50: 문장 길이/줄 수가 달라져도(약 토글) 높이 불변.
  recMain: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 25,
    minHeight: 50,
  },
  // 추천근거 = 출처 표기 한 줄 — 흐린 단색(textSub), 라벨 색강조 없음
  // minHeight = lineHeight(18) × 1줄: 출처 유무에 상관없이 같은 높이 차지(빈 줄도 자리 유지).
  recSource: {
    fontSize: 13,
    color: Colors.textHint,
    lineHeight: 18,
    marginTop: 10,
    minHeight: 18,
  },
  // 약 등록 버튼(분기3) — 56dp+ (액션 버튼이라 primary 유지)
  recRegisterBtn: {
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
    paddingHorizontal: 16,
  },
  recRegisterBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  // 면책 — 가장 작고 연하게, 맨 아래 별행 (더 흐림)
  // minHeight = lineHeight(18) × 2줄 = 36: 면책 문구는 실제 2줄로 렌더되므로 2줄로 예약한다.
  //  - 상/하 패딩 대칭(작업2): 기존 54(3줄)는 마지막 줄 아래 18px 잔여가 생겨 하단 여백이
  //    recBox.paddingTop(16)보다 커 보였다. 실제 줄 수(2줄)에 맞춰 잔여를 없애면
  //    마지막 글자 아래 = paddingBottom(16) = 상단 여백과 같아진다.
  //  - 고정 높이 유지(토글 시 안 출렁임): showRec on=2줄(36)·off=빈칸(minHeight 36 유지)으로
  //    두 상태 높이가 동일 → 약 토글로 문구가 채워지거나 비어도 박스 높이 불변.
  recDisclaimer: {
    fontSize: 13,
    color: Colors.textHint,
    lineHeight: 18,
    marginTop: 10,
    minHeight: 36,
  },

  // ── 복용약 체크리스트(이 시간에 드시는 약) ──
  // 약 0개 빈 상태 블록 / 로딩 안내(깜빡임 방지).
  medEmptyBlock: {
    marginTop: 4,
  },
  medLoadingText: {
    fontSize: 16,
    color: Colors.textSub,
    marginTop: 8,
    paddingVertical: 8,
  },
  medPickSub: {
    fontSize: 14,
    color: Colors.textSub,
    marginTop: 4,
    marginBottom: 8,
    lineHeight: 20,
  },
  medPickRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    minHeight: 52,
    paddingVertical: 6,
  },
  medPickChk: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#BBBBBB',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medPickChkOn: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  medPickName: {
    flex: 1,
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },

  // 하단 버튼들
  cardFootRight: {
    alignItems: 'flex-end',
    marginTop: 10,
  },
  btnText: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  btnTextLabel: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.dark,
  },
  doneBtn: {
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 14,
  },
  doneBtnText: {
    fontSize: 18,
    fontWeight: '800',
    color: Colors.white,
  },
  delBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 14,
    marginTop: 8,
  },
  delBtnText: {
    fontSize: 15,
    fontWeight: '700',
    color: Colors.danger,
  },

  // 추가 버튼 (테두리 없음)
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    paddingVertical: 16,
    marginBottom: 4,
  },
  addBtnText: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.dark,
  },

  // 바텀시트
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingTop: 12,
    paddingBottom: 32,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 2,
    marginBottom: 12,
  },
  sheetTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 16,
  },
  ampmRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginBottom: 20,
    gap: 12,
  },
  ampmBtn: {
    flex: 1,
    height: 60,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
  },
  ampmBtnActive: {
    backgroundColor: Colors.primary,
    borderColor: Colors.primary,
  },
  ampmBtnInactive: {
    backgroundColor: Colors.white,
    borderColor: Colors.border,
  },
  ampmBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
  },
  ampmBtnTextActive: {
    color: Colors.white,
  },
  ampmBtnTextInactive: {
    color: Colors.textSub,
  },
  unitLabel: {
    fontSize: 16,
    color: Colors.textSub,
    marginLeft: 24,
    marginBottom: 8,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 20,
    gap: 8,
  },
  gridBtn: {
    height: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  gridBtnActive: {
    backgroundColor: Colors.primary,
  },
  gridBtnInactive: {
    backgroundColor: Colors.background,
  },
  gridBtnText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  gridBtnTextActive: {
    color: Colors.white,
  },
  gridBtnTextInactive: {
    color: Colors.text,
  },
  saveBtn: {
    marginHorizontal: 20,
    marginTop: 20,
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.white,
  },
  // 닫기·완료 한 줄(완료 우측)
  sheetBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 20,
  },
  sheetCancelBtn: {
    flex: 1,
    minHeight: 60,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheetCancelBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  sheetSaveBtn: {
    flex: 1,
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginTop: 10,
    paddingVertical: 18,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  cancelLinkText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '700',
  },

  // 추적 시각 직접 추가 시트 — 흔한 시각 큰 버튼
  extraPresetBtn: {
    width: '100%',
    minHeight: 56,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 14,
  },
  extraPresetText: {
    fontSize: 18,
    fontWeight: 'bold',
  },
  // 정밀 조정 스텝퍼
  stepperRow: {
    flexDirection: 'row',
    gap: 12,
    paddingHorizontal: 20,
    marginTop: 4,
  },
  stepperGroup: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: Colors.background,
    borderRadius: 12,
    padding: 6,
  },
  stepBtn: {
    width: 48,
    height: 48,
    borderRadius: 10,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepBtnText: {
    fontSize: 26,
    fontWeight: 'bold',
    color: Colors.dark,
    lineHeight: 30,
  },
  stepValueBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepValue: {
    fontSize: 24,
    fontWeight: 'bold',
    color: Colors.text,
  },
  stepUnit: {
    fontSize: 13,
    color: Colors.textSub,
    marginTop: 2,
  },
  intervalPreview: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.dark,
    textAlign: 'center',
    marginTop: 18,
  },
});
