/**
 * HistoryTimeline.tsx
 * 약복용 / 몸상태 / 운동 화면 하단 "과거 기록 보기" 타임라인 컴포넌트
 */
import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { isOverseasLocale, displayLocaleTag } from '../../i18n/detectLocale';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../constants/colors';
import { getLocalToday, getLocalDayRange, triggerLabelToText, mealTimeToPeriod } from '../../utils/medUtils';
import { buildSlotTitleMaps } from '../../constants/doseSlots';
import { translateRawExerciseType } from '../../constants/exerciseTypes';

type TimelineType = 'medication' | 'bodystate' | 'exercise';

interface HistoryTimelineProps {
  type: TimelineType;
  patientId: string | null;
  refreshKey?: number;
}

interface TimelineEntry {
  time: string;
  content: string;
  content2?: string;
  tag?: string;  // 몸상태 전용: "(저녁약 +30분)" 형태
}


// 수시 기록의 시간대 단어 추론. 오너 확정 6구간(doseSlots.periodWord)과 일치.
// (이전 4구간은 15시를 '저녁'으로 표기 — 낮인데 저녁/달로 보이던 문제와 같은 경계 오류)
// 라벨은 i18n(timeline.period*)에서 가져와 ko=기존 단어, en=영어 시간대명.
function getPeriodKo(isoString: string): string {
  const h = new Date(isoString).getHours();
  const key =
    h < 6 ? 'periodDawn'
    : h < 11 ? 'periodMorning'
    : h < 13 ? 'periodNoon'
    : h < 17 ? 'periodAfternoon'
    : h < 21 ? 'periodEvening'
    : 'periodNight';
  return i18n.t(`timeline.${key}`);
}


interface DayData {
  dateStr: string;
  entries: TimelineEntry[];
}

function toKSTTime(isoString: string): string {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const h = String(kst.getUTCHours()).padStart(2, '0');
  const m = String(kst.getUTCMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  if (isOverseasLocale()) {
    // 예: "Thu, Jul 3" (연도 생략, 요일 강조).
    return date.toLocaleDateString(displayLocaleTag(), { weekday: 'short', month: 'short', day: 'numeric' });
  }
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}.${d}(${dayNames[date.getDay()]})`;
}

function buildDateRange(todayStr: string, earliestStr: string, limit: number): string[] {
  const result: string[] = [];
  const today = new Date(todayStr);
  const earliest = new Date(earliestStr);
  let cur = new Date(today);
  let count = 0;
  while (cur >= earliest && count < limit) {
    result.push(cur.toISOString().slice(0, 10));
    cur.setDate(cur.getDate() - 1);
    count++;
  }
  return result;
}


const PAGE_SIZE = 14;

export function HistoryTimeline({ type, patientId, refreshKey }: HistoryTimelineProps) {
  const { user } = useAuth();
  const { t } = useTranslation();

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [dayDataMap, setDayDataMap] = useState<Record<string, TimelineEntry[]>>({});
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const tz = user?.timezone || 'Asia/Seoul';
  const todayStr = getLocalToday(tz);

  const fetchEarliestDate = useCallback(async (): Promise<string | null> => {
    if (!patientId) return null;
    try {
      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs').select('taken_at').eq('patient_id', patientId)
          .order('taken_at', { ascending: true }).limit(1).single();
        if (data?.taken_at) {
          return new Date(new Date(data.taken_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        }
      } else if (type === 'bodystate') {
        const { data } = await supabase
          .from('on_off_logs').select('logged_at').eq('patient_id', patientId)
          .order('logged_at', { ascending: true }).limit(1).single();
        if (data?.logged_at) {
          return new Date(new Date(data.logged_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        }
      } else if (type === 'exercise') {
        const { data } = await supabase
          .from('exercise_logs').select('logged_at').eq('patient_id', patientId)
          .order('logged_at', { ascending: true }).limit(1).single();
        if (data?.logged_at) {
          return new Date(new Date(data.logged_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
        }
      }
    } catch {}
    return null;
  }, [patientId, type]);

  const fetchAllLogs = useCallback(async (earliest: string) => {
    if (!patientId) return;
    const { start: rangeStart } = getLocalDayRange(earliest, tz);
    const { end: rangeEnd } = getLocalDayRange(todayStr, tz);
    const newMap: Record<string, TimelineEntry[]> = {};

    // dose_slots 슬롯 표시명(slotTitle) 조회맵 — 약복용/몸상태 분기 공용.
    // byId[dose_slot_id] 우선 → byLegacyKey[meal_time] → legacy 폴백.
    let slotTitleMaps: { byId: Record<string, string>; byLegacyKey: Record<string, string> } = {
      byId: {},
      byLegacyKey: {},
    };
    if (type === 'medication' || type === 'bodystate') {
      try {
        const { data: slotRows } = await supabase
          .from('dose_slots').select('id, label, time').eq('patient_id', patientId);
        slotTitleMaps = buildSlotTitleMaps(
          (slotRows ?? []).map((s: any) => ({ id: s.id, label: s.label, time: s.time }))
        );
      } catch {}
    }

    try {
      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs').select('taken_at, meal_time, dose_slot_id').eq('patient_id', patientId)
          .gte('taken_at', rangeStart).lte('taken_at', rangeEnd).order('taken_at', { ascending: false });
        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.taken_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          // slotTitle(byId 우선 → byLegacyKey) → legacy meal_time period → 원본 meal_time 폴백
          const slotName =
            (row.dose_slot_id && slotTitleMaps.byId[row.dose_slot_id]) ||
            slotTitleMaps.byLegacyKey[row.meal_time] ||
            mealTimeToPeriod(row.meal_time) ||
            row.meal_time ||
            '';
          newMap[kstDate].push({
            time: toKSTTime(row.taken_at),
            content: t('timeline.medEntry', { slot: slotName }),
          });
        });
      } else if (type === 'bodystate') {
        const { data } = await supabase
          .from('on_off_logs').select('logged_at, body_state, mood, sleep_quality, constipation, trigger_time_label, medication_meal_time, dose_slot_id')
          .eq('patient_id', patientId).gte('logged_at', rangeStart).lte('logged_at', rangeEnd)
          .order('logged_at', { ascending: false });
        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.logged_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          const line1: string[] = [];
          if (row.body_state != null) line1.push(t('timeline.bodyCondition', { score: row.body_state }));
          if (row.mood != null) line1.push(t('timeline.mood', { score: row.mood }));
          const line2: string[] = [];
          if (row.sleep_quality != null) line2.push(t('timeline.sleep', { score: row.sleep_quality }));
          if (row.constipation != null) line2.push(row.constipation ? t('timeline.constipationYes') : t('timeline.constipationNo'));
          // 슬롯 표시명: byId[dose_slot_id](시간대+시각, 예 "밤 10:30") 우선
          //  → byLegacyKey[medication_meal_time] → legacy period → 시간대 단어 폴백(옛 기록).
          // dose_slot_id 있는 기록은 슬롯의 실제 시각까지 표기, 없는 옛 기록만 시간대 단어로 폴백.
          const slotName =
            (row.dose_slot_id && slotTitleMaps.byId[row.dose_slot_id]) ||
            (row.medication_meal_time
              ? (slotTitleMaps.byLegacyKey[row.medication_meal_time]
                  || mealTimeToPeriod(row.medication_meal_time)
                  || getPeriodKo(row.logged_at))
              : getPeriodKo(row.logged_at));
          // 시점 표기: "(슬롯명 · 간격)" — 간격은 표준 풀텍스트("복용 직후" / "N분 후" / "N시간 후")
          // triggerLabelToText는 "복용 30분 후" 형태이므로, 괄호 안에서는 선행 "복용 " 제거("복용 직후"는 유지)
          const fullText = row.trigger_time_label ? triggerLabelToText(row.trigger_time_label) : '';
          // ko: 괄호 안에서는 선행 "복용 " 제거("복용 직후"는 유지).
          // en: triggerLabelToText 가 접두 없는 표현("30 min later" 등)을 반환하므로 그대로 사용.
          const interval = isOverseasLocale()
            ? fullText
            : (fullText === '복용 직후' ? fullText : fullText.replace(/^복용\s+/, ''));
          const tag = interval ? t('timeline.tag', { slot: slotName, interval }) : undefined;
          newMap[kstDate].push({
            time: toKSTTime(row.logged_at),
            content: line1.join(' | ') || t('timeline.recorded'),
            content2: line2.length > 0 ? line2.join(' | ') : undefined,
            tag,
          });
        });
      } else if (type === 'exercise') {
        const { data } = await supabase
          .from('exercise_logs').select('logged_at, exercise_type, duration_minutes')
          .eq('patient_id', patientId).gte('logged_at', rangeStart).lte('logged_at', rangeEnd)
          .order('logged_at', { ascending: false });
        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.logged_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          newMap[kstDate].push({
            time: toKSTTime(row.logged_at),
            content: t('timeline.exerciseEntry', { type: translateRawExerciseType(row.exercise_type), minutes: row.duration_minutes }),
          });
        });
      }
    } catch (err) {
      console.error('[HistoryTimeline] fetchAllLogs 오류:', err);
    }

    setDayDataMap(newMap);
  }, [patientId, type, todayStr, tz, t]);

  const handleExpand = useCallback(async () => {
    setExpanded(true);
    if (initialLoaded) return;
    setLoading(true);
    const earliest = await fetchEarliestDate();
    setEarliestDate(earliest);
    if (earliest) await fetchAllLogs(earliest);
    setInitialLoaded(true);
    setLoading(false);
  }, [initialLoaded, fetchEarliestDate, fetchAllLogs]);

  // 외부에서 refreshKey가 바뀌면 즉시 데이터 갱신
  useEffect(() => {
    if (!refreshKey) return;
    if (expanded && initialLoaded) {
      fetchEarliestDate().then(earliest => {
        const target = earliest ?? todayStr;
        if (earliest && earliest !== earliestDate) setEarliestDate(earliest);
        fetchAllLogs(target);
      });
    } else {
      // 아직 열려있지 않으면 다음 열 때 새로 로드하도록 초기화
      setInitialLoaded(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  const dateList: string[] = earliestDate
    ? buildDateRange(todayStr, earliestDate, displayCount)
    : buildDateRange(todayStr, todayStr, displayCount);

  const hasMore = earliestDate
    ? (() => {
        const diff = Math.floor(
          (new Date(todayStr).getTime() - new Date(earliestDate).getTime()) / (1000 * 60 * 60 * 24)
        ) + 1;
        return displayCount < diff;
      })()
    : false;

  if (!expanded) {
    return (
      <View style={styles.toggleWrap}>
        <TouchableOpacity style={styles.toggleButton} onPress={handleExpand} activeOpacity={0.8}>
          <Text style={styles.toggleButtonText}>{t('timeline.toggleShow')}</Text>
          <Text style={styles.toggleArrow}>▼</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.toggleButton} onPress={() => setExpanded(false)} activeOpacity={0.8}>
        <Text style={styles.toggleButtonText}>{t('timeline.toggleHide')}</Text>
        <Text style={styles.toggleArrow}>▲</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>{t('timeline.loading')}</Text>
        </View>
      ) : (
        <>
          {(!earliestDate || dateList.length === 0) ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>{t('timeline.empty')}</Text>
            </View>
          ) : (
            <View style={styles.timeline}>
              {dateList.map((dateStr, idx) => {
                const entries = dayDataMap[dateStr] ?? [];
                const hasRecord = entries.length > 0;
                const isLast = idx === dateList.length - 1;

                return (
                  <View key={dateStr} style={styles.dayRow}>
                    {/* 왼쪽: 날짜 — 동그라미 중심과 수평 정렬 */}
                    <View style={styles.dateCol}>
                      <Text style={styles.dateLabel}>{formatDateLabel(dateStr)}</Text>
                    </View>

                    {/* 가운데: 세로줄 + 원 */}
                    <View style={styles.lineCol}>
                      <View style={[styles.lineTop, idx === 0 && styles.lineInvisible]} />
                      <View style={hasRecord ? styles.dotFilled : styles.dotEmpty} />
                      <View style={[styles.lineBottom, isLast && styles.lineInvisible]} />
                    </View>

                    {/* 오른쪽: 기록 — 첫 줄이 동그라미 중심과 수평 정렬 */}
                    <View style={styles.contentCol}>
                      {hasRecord ? (
                        entries.map((entry, eIdx) => (
                          <View key={eIdx} style={[styles.entryRow, eIdx > 0 && styles.entryRowExtra]}>
                            <Text style={styles.entryTime}>{entry.time}</Text>
                            <View style={styles.entryContentWrap}>
                              <Text style={styles.entryContent}>{entry.content}</Text>
                              {entry.content2 ? (
                                <Text style={styles.entryContent2}>{entry.content2}</Text>
                              ) : null}
                              {entry.tag ? (
                                <Text style={styles.entryTag}>{entry.tag}</Text>
                              ) : null}
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.emptyDay}>{t('timeline.noRecord')}</Text>
                      )}
                    </View>
                  </View>
                );
              })}

              {hasMore && (
                <TouchableOpacity
                  style={styles.moreButton}
                  onPress={() => setDisplayCount((c) => c + PAGE_SIZE)}
                  activeOpacity={0.8}
                >
                  <Text style={styles.moreButtonText}>{t('timeline.more')}</Text>
                </TouchableOpacity>
              )}
            </View>
          )}
        </>
      )}
    </View>
  );
}

// lineTop 높이 = T, dot 중심 Y = T + 7
// dateCol/contentCol paddingTop = T - 2 (폰트 중심 오프셋 보정)
const LINE_TOP_H = 14;   // T
const FIRST_ROW_PT = 12; // T - 2

const styles = StyleSheet.create({
  toggleWrap: { paddingBottom: 32 },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  toggleButtonText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  toggleArrow: { fontSize: 14, color: Colors.textHint },

  container: { paddingBottom: 40 },

  loadingWrap: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  loadingText: { fontSize: 17, color: Colors.textSub },

  emptyWrap: { alignItems: 'center', paddingVertical: 32 },
  emptyText: { fontSize: 18, color: Colors.textHint },

  timeline: { paddingHorizontal: 16, paddingTop: 8 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 48,
  },

  // 날짜 컬럼: paddingTop으로 첫 줄 중심을 dot 중심에 맞춤
  dateCol: {
    width: 80,
    paddingTop: FIRST_ROW_PT,
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  dateLabel: {
    fontSize: 15,
    color: '#888888',
    fontWeight: '500',
  },

  // 세로줄 + 원 컬럼
  lineCol: {
    width: 28,
    alignItems: 'center',
    flexDirection: 'column',
  },
  lineTop: {
    width: 2,
    height: LINE_TOP_H,
    backgroundColor: '#E0E0E0',
  },
  lineBottom: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: '#E0E0E0',
  },
  lineInvisible: { backgroundColor: 'transparent' },
  dotFilled: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
  },
  dotEmpty: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#CCCCCC',
    backgroundColor: Colors.white,
  },

  // 기록 컬럼: paddingTop으로 첫 줄 중심을 dot 중심에 맞춤
  contentCol: {
    flex: 1,
    paddingLeft: 10,
    paddingTop: FIRST_ROW_PT,
    paddingBottom: 12,
  },

  // 각 기록 행: 시간 + 내용 수평 배치, flex-start로 상단 정렬
  entryRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  entryRowExtra: {
    marginTop: 8,
  },

  entryTime: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    minWidth: 46,
    lineHeight: 22,
  },
  entryContentWrap: {
    flex: 1,
  },
  entryContent: {
    fontSize: 16,
    color: Colors.text,
    lineHeight: 22,
  },
  entryContent2: {
    fontSize: 16,
    color: Colors.text,
    marginTop: 2,
    lineHeight: 22,
  },
  entryTag: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 3,
    lineHeight: 20,
  },

  emptyDay: {
    fontSize: 16,
    color: '#CCCCCC',
    lineHeight: 22,
  },

  moreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  moreButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
});
