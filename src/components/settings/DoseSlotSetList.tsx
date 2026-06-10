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
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import {
  useDoseSlots,
  invalidateDoseSlotsCache,
  type DoseSlot,
} from '../../hooks/useDoseSlots';
import { usePatientId } from '../../hooks/usePatientId';
import {
  formatSlotTime,
  slotSortValue,
  autoSlotLabel,
  labelContainsTime,
  LEGACY_SLOT_META,
} from '../../constants/doseSlots';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { AlarmSoundPickerRow, AlarmSoundOption } from '../common/AlarmSoundPickerRow';

if (
  Platform.OS === 'android' &&
  UIManager.setLayoutAnimationEnabledExperimental
) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// 박스1(약 복용 알림) 배경색 — 연한 파랑. boxAlarm 스타일과 AlarmSoundPickerRow 양쪽에서 재사용.
const BOX_ALARM_BG = '#EAF2FB';

// ── 추적 시간 체크줄 항목 (분 단위, 0 = 복용 직후) ──────────────────────
interface TrackOption {
  minutes: number;
  label: string;
}
const TRACK_OPTIONS: TrackOption[] = [
  { minutes: 0, label: '복용 직후' },
  { minutes: 30, label: '30분 후' },
  { minutes: 60, label: '1시간 후' },
  { minutes: 120, label: '2시간 후' },
  { minutes: 180, label: '3시간 후' },
];
// 프리셋 분(중복 행 방지용 빠른 조회)
const PRESET_MINUTES = new Set(TRACK_OPTIONS.map((o) => o.minutes));

// 신규 슬롯 기본 추적 시간 = 복용 직후(0) + 30분
const DEFAULT_TRACK_INTERVALS = [0, 30];

// 분 → "복용 직후 / 4시간 후" 체크줄 라벨 (비프리셋 값 표시용)
function minutesToCheckLabel(min: number): string {
  if (min === 0) return '복용 직후';
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

// "직접 추가" 바텀시트의 자주 쓰는 추가 시간 큰 버튼 (분)
const EXTRA_MINUTE_PRESETS = [240, 300, 360];

// 추적 시간 리스트 → 접힌 카드 요약 ("복용 직후, 30분 후")
function summarizeTrackIntervals(intervals: number[]): string {
  const sorted = [...intervals].sort((a, b) => a - b);
  if (sorted.length === 0) return '추적 시간을 선택해 주세요';
  return sorted.map(minutesToCheckLabel).join(', ');
}

// ── 슬롯 이모지 (legacy 매핑이 있으면 그 이모지, 없으면 시각대 기준) ───────────────
function slotEmoji(slot: DoseSlot): string {
  if (slot.legacyKey) return LEGACY_SLOT_META[slot.legacyKey].emoji;
  const v = slotSortValue(slot.time);
  if (v < 6 * 60) return '🌙';
  if (v < 11 * 60) return '🌅';
  if (v < 17 * 60) return '☀️';
  if (v < 21 * 60) return '🌆';
  return '🌙';
}

// 시각 제목 ("아침 오전 8:00" 또는 비표준 "오후 3:00")
// 비표준 슬롯은 label 이 이미 "시간대 시각"(예 "오후 3:00")이므로 시각을 또 붙이지 않는다.
function slotTitle(slot: DoseSlot): string {
  const t = formatSlotTime(slot.time);
  if (labelContainsTime(slot.label, slot.legacyKey)) return slot.label!.trim();
  if (slot.label && slot.label.trim()) return `${slot.label.trim()} ${t}`;
  return t;
}

interface Props {
  /** 그룹 녹음 목록 (알림별 소리 선택용) */
  alarmSounds: AlarmSoundOption[];
}

export function DoseSlotSetList({ alarmSounds }: Props) {
  const { slots, loading, refresh } = useDoseSlots();
  const { patientId: resolvedPatientId } = usePatientId();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
    ampm: '오전' | '오후';
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
  const displaySlots: DoseSlot[] = [...mergedSlots, ...pendingAdded];

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
          console.error('[DoseSlotSetList] dose_slots update 실패:', e);
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

  // 약 드실 시간 알림 토글
  const onToggleRemind = useCallback(
    (slot: DoseSlot, value: boolean) => {
      if (!slot.id) return;
      patchSlot(slot.id, { remind_enabled: value }, { remindEnabled: value });
    },
    [patchSlot],
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
    },
    [patchSlot],
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
      if (next.length === 0) {
        // 마지막 항목까지 끄면 약효추적 자체를 끔
        patchSlot(
          slot.id,
          { track_intervals: [], track_enabled: false },
          { trackIntervals: [], trackEnabled: false },
        );
      } else {
        patchSlot(slot.id, { track_intervals: next }, { trackIntervals: next });
      }
    },
    [patchSlot],
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
    },
    [slots, overrides, patchSlot],
  );

  // 비표준 추가 슬롯 삭제(is_active=false). 표준 4슬롯은 호출 안 됨.
  // 삭제는 목록에서 사라져야 하므로 낙관적 오버레이가 아니라 refresh 로 반영.
  const onDeleteSlot = useCallback(
    async (slot: DoseSlot) => {
      if (!slot.id) return;
      const id = slot.id;
      setExpandedId(null);
      try {
        const { error } = await supabase
          .from('dose_slots')
          .update({ is_active: false })
          .eq('id', id);
        if (error) throw error;
        if (patientIdRef.current) invalidateDoseSlotsCache(patientIdRef.current);
        // 삭제된 슬롯의 잔여 오버레이 제거 후 base 갱신.
        setOverrides((prev) => {
          if (!(id in prev)) return prev;
          const next = { ...prev };
          delete next[id];
          return next;
        });
        await refresh();
      } catch (e) {
        console.error('[DoseSlotSetList] dose_slots 삭제 실패:', e);
      }
    },
    [refresh],
  );

  // ── 시간/분 바텀시트 ───────────────────────────────────────────────────────
  const openTimeSheet = useCallback((slot: DoseSlot | null) => {
    if (slot) {
      // 편집: 기존 시각으로 초기화
      const parts = slot.time.split(':');
      const h24 = parseInt(parts[0] ?? '8', 10);
      const minute = parseInt(parts[1] ?? '0', 10);
      let ampm: '오전' | '오후';
      let hour: number;
      if (h24 === 0) { ampm = '오전'; hour = 12; }
      else if (h24 < 12) { ampm = '오전'; hour = h24; }
      else if (h24 === 12) { ampm = '오후'; hour = 12; }
      else { ampm = '오후'; hour = h24 - 12; }
      setTimeSheet({ mode: 'edit', slotId: slot.id, ampm, hour, minute });
    } else {
      // 추가: 기본 오전 9:00
      setTimeSheet({ mode: 'add', slotId: null, ampm: '오전', hour: 9, minute: 0 });
    }
  }, []);

  const sheetToHHMM = (s: { ampm: '오전' | '오후'; hour: number; minute: number }): string => {
    let h24: number;
    if (s.ampm === '오전') h24 = s.hour === 12 ? 0 : s.hour;
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
    } else {
      // 추가: dose_slots insert.
      // insert→refresh 왕복 동안 화면이 비는 걸 막으려고 새 슬롯을 즉시 낙관적으로 띄운다.
      const pid = patientIdRef.current;
      setTimeSheet(null);
      if (!pid) return;
      if (insertingRef.current) return;
      insertingRef.current = true;

      const maxSort = slots.reduce((mx, s) => Math.max(mx, s.sortOrder), 0);
      const newSort = maxSort + 1;
      // 비표준(추가) 슬롯 라벨 = "[시간대] [12시간 시각]" (예 "오후 3:00"). 기존 '추가' 폐기.
      const newLabel = autoSlotLabel(newTime);
      // 임시 슬롯(낙관적). id 는 'opt:' 접두 임시값 — refresh 로 진짜 행이 오면 정리됨.
      const optimistic: DoseSlot = {
        id: `opt:${Date.now()}`,
        patientId: pid,
        time: newTime,
        label: newLabel,
        sortOrder: newSort,
        remindEnabled: true,
        remindSoundId: null,
        trackEnabled: true,
        trackIntervals: DEFAULT_TRACK_INTERVALS,
        trackSoundId: null,
        legacyKey: null,
        isReal: false,
      };
      setAddedSlots((prev) => [...prev, optimistic]);

      try {
        const { error } = await supabase.from('dose_slots').insert({
          patient_id: pid,
          time: newTime,
          label: newLabel,
          sort_order: newSort,
          remind_enabled: true,
          remind_sound_id: null,
          track_enabled: true,
          track_intervals: DEFAULT_TRACK_INTERVALS,
          track_sound_id: null,
          is_active: true,
        } as any);
        if (error) throw error;
        invalidateDoseSlotsCache(pid);
        await refresh();
      } catch (e) {
        console.error('[DoseSlotSetList] dose_slots insert 실패:', e);
        // 실패 시 낙관적 슬롯 롤백.
        setAddedSlots((prev) => prev.filter((s) => s.id !== optimistic.id));
      } finally {
        insertingRef.current = false;
      }
    }
  }, [timeSheet, slots, patchSlot, refresh]);

  // ── 소프트 경고 판정: 이 슬롯의 추적 시각 중 (슬롯시각+분) > 다음 active 슬롯 시각? ──
  // 정렬된 active 슬롯에서 "이 슬롯 바로 다음" 시각을 찾음. 마지막 복용이면 경고 없음.
  const sortedActive = [...displaySlots].sort(
    (a, b) =>
      a.sortOrder - b.sortOrder || slotSortValue(a.time) - slotSortValue(b.time),
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
        <Text style={styles.sectionTitle}>복용 시각별 알림</Text>
        <View style={styles.card}>
          <Text style={styles.loadingText}>불러오는 중입니다...</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>복용 시각별 알림</Text>
      <Text style={styles.sectionDesc}>
        복용 시각마다 약 복용 알림과 약효 추적 알림을 정할 수 있어요
      </Text>

      {/* 안내 박스 */}
      <View style={styles.guide}>
        <Text style={styles.guideTitle}>복용 시각마다 따로 정할 수 있어요</Text>
        <Text style={styles.guideBody}>
          약 복용 알림과 약효 추적 알림을 시각별로 설정합니다.
          기본값이 미리 맞춰져 있으니 그대로 두셔도 괜찮아요.
        </Text>
      </View>

      {displaySlots.map((slot) => {
        if (!slot.id) return null;
        const expanded = expandedId === slot.id;
        // 왼쪽 띠: 약 복용/약효 추적 중 하나라도 켜져 있으면 오렌지, 둘 다 꺼지면 회색
        const cardOn = slot.remindEnabled || slot.trackEnabled;
        // 시각 제목 dim: 약 복용 알림이 꺼져 있으면 흐리게 (와이어프레임 점심 카드)
        const timeDim = !slot.remindEnabled;
        const isStandard = !!slot.legacyKey; // 표준 4슬롯 → 삭제 불가
        const warn = getOverlapWarning(slot);
        return (
          <View
            key={slot.id}
            style={[styles.card, cardOn ? styles.cardOn : styles.cardOff]}
          >
            {/* ── 시각 제목 줄 ── */}
            <View style={styles.slotHead}>
              <View style={[styles.slotEmoji, timeDim && styles.slotEmojiOff]}>
                <Text style={styles.slotEmojiText}>{slotEmoji(slot)}</Text>
              </View>
              <Text style={[styles.slotTime, timeDim && styles.slotTimeOff]}>
                {slotTitle(slot)}
              </Text>
            </View>

            {!expanded ? (
              /* ── 접힌 카드: 두 알림 토글 + 추적 요약 + 수정 ── */
              <>
                <View style={styles.row}>
                  <View style={styles.rowText}>
                    <Text style={[styles.rowLead, !slot.remindEnabled && styles.rowLeadOff]}>
                      약 복용 알림
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
                      약효 추적 알림
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

                <View style={styles.cardFootRight}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.btnText}
                    onPress={() => toggleExpand(slot.id!)}
                  >
                    <Ionicons name="create-outline" size={18} color={Colors.dark} />
                    <Text style={styles.btnTextLabel}>수정</Text>
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              /* ── 펼친 카드: 2박스 레이아웃 ── */
              <>
                {/* ══ 박스1: 약 복용 알림 (연한 파랑) ══ */}
                <View style={[styles.boxBlock, styles.boxAlarm]}>
                  <View style={styles.boxHead}>
                    <Text style={styles.boxTitle}>약 복용 알림</Text>
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
                          <Ionicons name="time-outline" size={20} color={Colors.dark} />
                          <Text style={styles.timeRowLabel}>알림 시간</Text>
                        </View>
                        <View style={styles.timeRowRight}>
                          <Text style={styles.timeRowValue}>
                            {formatSlotTime(slot.time)}
                          </Text>
                          <View style={styles.editPill}>
                            <Ionicons name="create-outline" size={16} color={Colors.dark} />
                            <Text style={styles.editPillText}>수정</Text>
                          </View>
                        </View>
                      </TouchableOpacity>

                      {/* 알림 소리 — 파란 박스에 맞춰 연한 파랑 배경 */}
                      <AlarmSoundPickerRow
                        soundId={slot.remindSoundId}
                        sounds={alarmSounds}
                        onSelect={(sid) => onRemindSound(slot, sid)}
                        backgroundColor={BOX_ALARM_BG}
                      />
                    </>
                  )}
                </View>

                {/* ══ 박스2: 약효 추적 알림 (연한 초록) ══ */}
                <View style={[styles.boxBlock, styles.boxTrack]}>
                  <View style={styles.boxHead}>
                    <Text style={styles.boxTitle}>약효 추적 알림</Text>
                    <Switch
                      value={slot.trackEnabled}
                      onValueChange={(v) => onToggleTrack(slot, v)}
                      trackColor={{ false: Colors.border, true: Colors.primary }}
                      thumbColor={Colors.white}
                    />
                  </View>

                  {slot.trackEnabled && (
                    <>
                      <Text style={styles.qHead}>
                        추적 시간{' '}
                        <Text style={styles.qHeadSmall}>(여러 개 선택)</Text>
                      </Text>

                      {(() => {
                        // 프리셋 5개 + track_intervals 의 비프리셋 값들을 분 오름차순으로 2열 배치.
                        // 비프리셋(예 240=4시간) 값도 체크 상태로 떠서 다시 누르면 해제 가능.
                        const extraRows = slot.trackIntervals
                          .filter((m) => !PRESET_MINUTES.has(m))
                          .map((m) => ({ minutes: m, label: minutesToCheckLabel(m) }));
                        const rows = [...TRACK_OPTIONS, ...extraRows].sort(
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
                                    style={[styles.checkCell, sel && styles.checkRowSel]}
                                    onPress={() => onToggleInterval(slot, opt.minutes)}
                                  >
                                    <View style={[styles.box, sel && styles.boxSel]}>
                                      {sel && (
                                        <Ionicons name="checkmark" size={18} color={Colors.white} />
                                      )}
                                    </View>
                                    <View style={styles.checkText}>
                                      <Text style={styles.checkLabel}>{opt.label}</Text>
                                    </View>
                                  </TouchableOpacity>
                                );
                              })}
                            </View>
                            {/* "복용 직후" 힌트 — 2열 셀 안에선 좁아 어색하므로 그리드 아래 풀너비로 */}
                            <Text style={styles.checkHint}>
                              ⓘ "복용 직후"는 복용하자마자 바로 알림이 와요
                            </Text>
                          </>
                        );
                      })()}

                      {/* ＋ 직접 추가 (프리셋에 없는 임의 시간 추가) */}
                      <TouchableOpacity
                        activeOpacity={0.7}
                        style={styles.addIntervalBtn}
                        onPress={() =>
                          setIntervalSheet({ slotId: slot.id!, hour: 4, minute: 0 })
                        }
                      >
                        <Ionicons name="add-outline" size={22} color={Colors.dark} />
                        <Text style={styles.addIntervalBtnText}>직접 추가</Text>
                      </TouchableOpacity>

                      {/* 소프트 경고 (막지 않음) */}
                      {warn && (
                        <View style={styles.warn}>
                          <Text style={styles.warnTitle}>
                            🟠 다음 복용 시간과 가까워요
                          </Text>
                          <Text style={styles.warnBody}>
                            이 시간에 추적하면 다음 복용 기록과 섞일 수 있어요.
                            그대로 두시겠어요?
                          </Text>
                        </View>
                      )}

                      {/* 알림 소리 */}
                      <AlarmSoundPickerRow
                        soundId={slot.trackSoundId}
                        sounds={alarmSounds}
                        onSelect={(sid) => onTrackSound(slot, sid)}
                      />
                    </>
                  )}
                </View>

                {/* ── 박스 밖: 완료 + (비표준만) 삭제 ── */}
                <TouchableOpacity
                  activeOpacity={0.85}
                  style={styles.doneBtn}
                  onPress={() => toggleExpand(slot.id!)}
                >
                  <Text style={styles.doneBtnText}>완료</Text>
                </TouchableOpacity>

                {!isStandard && (
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.delBtn}
                    onPress={() => onDeleteSlot(slot)}
                  >
                    <Ionicons name="trash-outline" size={18} color={Colors.danger} />
                    <Text style={styles.delBtnText}>이 복용 시간 삭제</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        );
      })}

      {/* ＋ 복용 시각 추가하기 */}
      <TouchableOpacity
        activeOpacity={0.7}
        style={styles.addBtn}
        onPress={() => openTimeSheet(null)}
      >
        <Ionicons name="add-circle-outline" size={22} color={Colors.dark} />
        <Text style={styles.addBtnText}>복용 시간 추가</Text>
      </TouchableOpacity>

      {/* ── 시간/분 선택 바텀시트 ── */}
      <TimePickerSheet
        state={timeSheet}
        onChange={setTimeSheet}
        onSave={onSaveTime}
        onClose={() => setTimeSheet(null)}
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

// ─── 시간/분 선택 바텀시트 (스와이프 다운 닫기) ─────────────────────────────────
const HOURS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const MINUTE_PRESETS = [0, 5, 10, 15, 20, 30, 40, 45, 50];

interface TimeSheetState {
  mode: 'edit' | 'add';
  slotId: string | null;
  ampm: '오전' | '오후';
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
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);
  const visible = !!state;
  React.useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  const hourBtnWidth = (SCREEN_WIDTH - 88) / 4;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          {...panHandlers}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          {state && (
            <>
              <Text style={styles.sheetTitle}>
                {state.mode === 'add' ? '복용 시간 추가' : '복용 시간 수정'}
              </Text>

              {/* 오전/오후 */}
              <View style={styles.ampmRow}>
                {(['오전', '오후'] as const).map((ap) => {
                  const active = state.ampm === ap;
                  return (
                    <TouchableOpacity
                      key={ap}
                      activeOpacity={0.7}
                      onPress={() => onChange({ ...state, ampm: ap })}
                      style={[styles.ampmBtn, active ? styles.ampmBtnActive : styles.ampmBtnInactive]}
                    >
                      <Text style={[styles.ampmBtnText, active ? styles.ampmBtnTextActive : styles.ampmBtnTextInactive]}>
                        {ap}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={styles.unitLabel}>시</Text>
              <View style={styles.grid}>
                {HOURS.map((h) => {
                  const active = state.hour === h;
                  return (
                    <TouchableOpacity
                      key={h}
                      activeOpacity={0.7}
                      onPress={() => onChange({ ...state, hour: h })}
                      style={[styles.gridBtn, { width: hourBtnWidth }, active ? styles.gridBtnActive : styles.gridBtnInactive]}
                    >
                      <Text style={[styles.gridBtnText, active ? styles.gridBtnTextActive : styles.gridBtnTextInactive]}>
                        {h}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <Text style={[styles.unitLabel, { marginTop: 16 }]}>분</Text>
              <View style={styles.grid}>
                {MINUTE_PRESETS.map((m) => {
                  const active = state.minute === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.7}
                      onPress={() => onChange({ ...state, minute: m })}
                      style={[styles.gridBtn, { width: hourBtnWidth }, active ? styles.gridBtnActive : styles.gridBtnInactive]}
                    >
                      <Text style={[styles.gridBtnText, active ? styles.gridBtnTextActive : styles.gridBtnTextInactive]}>
                        {String(m).padStart(2, '0')}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity activeOpacity={0.85} style={styles.saveBtn} onPress={onSave}>
                <Text style={styles.saveBtnText}>완료</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} style={styles.cancelLink} onPress={onClose}>
                <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                <Text style={styles.cancelLinkText}>닫기</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </TouchableOpacity>
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
  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(onClose);
  const visible = !!state;
  React.useEffect(() => {
    if (visible) resetPosition();
  }, [visible]);

  const totalMinutes = state ? state.hour * 60 + state.minute : 0;
  const clampHour = (h: number) => Math.max(0, Math.min(12, h));
  const clampMinute = (m: number) => Math.max(0, Math.min(55, m));

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={styles.backdrop} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[styles.sheet, { transform: [{ translateY }] }]}
          {...panHandlers}
          onStartShouldSetResponder={() => true}
        >
          <View style={styles.handle} />
          {state && (
            <>
              <Text style={styles.sheetTitle}>추적 시간 추가</Text>

              {/* 자주 쓰는 추가 시간 큰 버튼들 */}
              <Text style={[styles.unitLabel, { marginLeft: 24 }]}>자주 쓰는 시간</Text>
              <View style={[styles.grid, { marginBottom: 6 }]}>
                {EXTRA_MINUTE_PRESETS.map((m) => {
                  const active = totalMinutes === m;
                  return (
                    <TouchableOpacity
                      key={m}
                      activeOpacity={0.7}
                      onPress={() =>
                        onChange({ ...state, hour: Math.floor(m / 60), minute: m % 60 })
                      }
                      style={[
                        styles.extraPresetBtn,
                        active ? styles.gridBtnActive : styles.gridBtnInactive,
                      ]}
                    >
                      <Text
                        style={[
                          styles.extraPresetText,
                          active ? styles.gridBtnTextActive : styles.gridBtnTextInactive,
                        ]}
                      >
                        {minutesToCheckLabel(m)}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 정밀 조정용 시/분 스텝퍼 */}
              <Text style={[styles.unitLabel, { marginLeft: 24, marginTop: 14 }]}>
                직접 맞추기
              </Text>
              <View style={styles.stepperRow}>
                <View style={styles.stepperGroup}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.stepBtn}
                    onPress={() => onChange({ ...state, hour: clampHour(state.hour - 1) })}
                  >
                    <Text style={styles.stepBtnText}>－</Text>
                  </TouchableOpacity>
                  <View style={styles.stepValueBox}>
                    <Text style={styles.stepValue}>{state.hour}</Text>
                    <Text style={styles.stepUnit}>시간</Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.stepBtn}
                    onPress={() => onChange({ ...state, hour: clampHour(state.hour + 1) })}
                  >
                    <Text style={styles.stepBtnText}>＋</Text>
                  </TouchableOpacity>
                </View>

                <View style={styles.stepperGroup}>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.stepBtn}
                    onPress={() => onChange({ ...state, minute: clampMinute(state.minute - 5) })}
                  >
                    <Text style={styles.stepBtnText}>－</Text>
                  </TouchableOpacity>
                  <View style={styles.stepValueBox}>
                    <Text style={styles.stepValue}>{state.minute}</Text>
                    <Text style={styles.stepUnit}>분</Text>
                  </View>
                  <TouchableOpacity
                    activeOpacity={0.7}
                    style={styles.stepBtn}
                    onPress={() => onChange({ ...state, minute: clampMinute(state.minute + 5) })}
                  >
                    <Text style={styles.stepBtnText}>＋</Text>
                  </TouchableOpacity>
                </View>
              </View>

              {/* 미리보기 */}
              <Text style={styles.intervalPreview}>
                {minutesToCheckLabel(totalMinutes)} 추적
              </Text>

              <TouchableOpacity
                activeOpacity={0.85}
                style={styles.saveBtn}
                onPress={() => onAdd(state.slotId, totalMinutes)}
              >
                <Text style={styles.saveBtnText}>추가</Text>
              </TouchableOpacity>
              <TouchableOpacity activeOpacity={0.7} style={styles.cancelLink} onPress={onClose}>
                <Ionicons name="close-outline" size={22} color={Colors.textSub} />
                <Text style={styles.cancelLinkText}>닫기</Text>
              </TouchableOpacity>
            </>
          )}
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  section: {
    marginTop: 16,
  },
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
  cardOn: {
    borderLeftWidth: 5,
    borderLeftColor: Colors.accent,
  },
  cardOff: {
    backgroundColor: '#F9F9F9',
    borderLeftWidth: 5,
    borderLeftColor: Colors.border,
  },

  // ── 2박스 레이아웃 ──
  boxBlock: {
    borderRadius: 14,
    padding: 14,
    marginTop: 12,
  },
  boxAlarm: {
    backgroundColor: BOX_ALARM_BG, // 연한 파랑
  },
  boxTrack: {
    backgroundColor: Colors.light, // 연한 초록
  },
  boxHead: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 44,
  },
  boxTitle: {
    flex: 1,
    fontSize: 18,
    fontWeight: '800',
    color: Colors.text,
  },
  // 박스1: 알림 시간 행 (수정으로 진입)
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 56,
    backgroundColor: Colors.white,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginTop: 10,
    borderWidth: 1.5,
    borderColor: '#DFE7F1',
  },
  timeRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  timeRowLabel: {
    fontSize: 17,
    fontWeight: '700',
    color: Colors.text,
  },
  timeRowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
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
    fontSize: 15,
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
    fontSize: 22,
    fontWeight: '800',
    color: Colors.text,
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
    marginTop: 10,
    marginBottom: 10,
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
    minHeight: 56,
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    marginBottom: 8,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  checkRowSel: {
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
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
    marginTop: 2,
    marginBottom: 10,
    marginLeft: 2,
    lineHeight: 20,
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

  // 추가 버튼
  addBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderWidth: 2,
    borderStyle: 'dashed',
    borderColor: Colors.primary,
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
    height: 60,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.white,
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
