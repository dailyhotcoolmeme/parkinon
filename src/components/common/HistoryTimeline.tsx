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
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { Colors } from '../../constants/colors';
import { getKSTDayRange } from '../../utils/medUtils';

type TimelineType = 'medication' | 'bodystate' | 'exercise';

interface HistoryTimelineProps {
  type: TimelineType;
  patientId: string | null;
}

interface TimelineEntry {
  time: string;    // HH:MM
  content: string; // 약복용/운동: 한 줄 내용 | 몸상태: 몸상태 N점  기분 N점
  content2?: string; // 몸상태 전용 두 번째 줄: 수면 N점  변비 있음/없음
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
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}.${d}(${dayNames[date.getDay()]})`;
}

function getKSTTodayStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
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

const MEAL_TIME_KO: Record<string, string> = {
  morning: '아침',
  lunch: '점심',
  dinner: '저녁',
  bedtime: '취침',
};

const PAGE_SIZE = 14;

export function HistoryTimeline({ type, patientId }: HistoryTimelineProps) {
  const { user } = useAuth();

  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [earliestDate, setEarliestDate] = useState<string | null>(null);
  const [dayDataMap, setDayDataMap] = useState<Record<string, TimelineEntry[]>>({});
  const [displayCount, setDisplayCount] = useState(PAGE_SIZE);

  const todayStr = getKSTTodayStr();

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
    const { start: rangeStart } = getKSTDayRange(earliest);
    const { end: rangeEnd } = getKSTDayRange(todayStr);
    const newMap: Record<string, TimelineEntry[]> = {};

    try {
      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs').select('taken_at, meal_time').eq('patient_id', patientId)
          .gte('taken_at', rangeStart).lte('taken_at', rangeEnd).order('taken_at', { ascending: false });
        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.taken_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          newMap[kstDate].push({
            time: toKSTTime(row.taken_at),
            content: MEAL_TIME_KO[row.meal_time] ?? row.meal_time,
          });
        });
      } else if (type === 'bodystate') {
        const { data } = await supabase
          .from('on_off_logs').select('logged_at, body_state, mood, sleep_quality, constipation')
          .eq('patient_id', patientId).gte('logged_at', rangeStart).lte('logged_at', rangeEnd)
          .order('logged_at', { ascending: false });
        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.logged_at).getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          const line1: string[] = [];
          if (row.body_state != null) line1.push(`몸상태 ${row.body_state}점`);
          if (row.mood != null) line1.push(`기분 ${row.mood}점`);
          const line2: string[] = [];
          if (row.sleep_quality != null) line2.push(`수면 ${row.sleep_quality}점`);
          if (row.constipation != null) line2.push(`변비 ${row.constipation}`);
          newMap[kstDate].push({
            time: toKSTTime(row.logged_at),
            content: line1.join('  ') || '기록',
            content2: line2.length > 0 ? line2.join('  ') : undefined,
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
            content: `${row.exercise_type} ${row.duration_minutes}분`,
          });
        });
      }
    } catch (err) {
      console.error('[HistoryTimeline] fetchAllLogs 오류:', err);
    }

    setDayDataMap(newMap);
  }, [patientId, type, todayStr]);

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
          <Text style={styles.toggleButtonText}>과거 기록 보기</Text>
          <Text style={styles.toggleArrow}>▼</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <TouchableOpacity style={styles.toggleButton} onPress={() => setExpanded(false)} activeOpacity={0.8}>
        <Text style={styles.toggleButtonText}>과거 기록 접기</Text>
        <Text style={styles.toggleArrow}>▲</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={styles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={styles.loadingText}>기록을 불러오는 중...</Text>
        </View>
      ) : (
        <>
          {(!earliestDate || dateList.length === 0) ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyText}>아직 기록이 없어요</Text>
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
                            </View>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.emptyDay}>기록 없음</Text>
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
                  <Text style={styles.moreButtonText}>더보기 (14일 추가)</Text>
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
  // 몸상태 두 번째 줄 (수면, 변비)
  entryContent2: {
    fontSize: 16,
    color: Colors.text,
    marginTop: 2,
    lineHeight: 22,
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
