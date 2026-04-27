/**
 * HistoryTimeline.tsx
 * 약복용 / 몸상태 / 운동 화면 하단 "과거 기록 보기" 타임라인 컴포넌트
 *
 * - 오늘부터 최초 기록 날짜까지 하루도 빠짐없이 표시
 * - 기본 14일 표시 → "더보기" 버튼으로 14일씩 추가
 * - 가운데 세로줄 기반 타임라인 레이아웃
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
  time: string;   // HH:MM
  content: string;
}

interface DayData {
  dateStr: string;   // YYYY-MM-DD
  entries: TimelineEntry[];
}

// ISO 문자열 → KST HH:MM 변환
function toKSTTime(isoString: string): string {
  const d = new Date(isoString);
  // getHours()는 로컬 시간 기준이므로, KST 오프셋 명시
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const utcH = kst.getUTCHours();
  const utcM = kst.getUTCMinutes();
  return `${String(utcH).padStart(2, '0')}:${String(utcM).padStart(2, '0')}`;
}

// YYYY-MM-DD → 월.일(요일) 형식
function formatDateLabel(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const date = new Date(y, m - 1, d);
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}.${d}(${dayNames[date.getDay()]})`;
}

// KST 기준 오늘 날짜 문자열 반환
function getKSTTodayStr(): string {
  const now = new Date();
  const kst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return kst.toISOString().slice(0, 10);
}

// 날짜 목록 생성 (오늘부터 earliestDate까지, 최신순)
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

  // 최초 기록 날짜 조회
  const fetchEarliestDate = useCallback(async (): Promise<string | null> => {
    if (!patientId) return null;

    try {
      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs')
          .select('taken_at')
          .eq('patient_id', patientId)
          .order('taken_at', { ascending: true })
          .limit(1)
          .single();
        if (data?.taken_at) {
          const kst = new Date(new Date(data.taken_at).getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().slice(0, 10);
        }
      } else if (type === 'bodystate') {
        const { data } = await supabase
          .from('on_off_logs')
          .select('logged_at')
          .eq('patient_id', patientId)
          .order('logged_at', { ascending: true })
          .limit(1)
          .single();
        if (data?.logged_at) {
          const kst = new Date(new Date(data.logged_at).getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().slice(0, 10);
        }
      } else if (type === 'exercise') {
        const { data } = await supabase
          .from('exercise_logs')
          .select('logged_at')
          .eq('patient_id', patientId)
          .order('logged_at', { ascending: true })
          .limit(1)
          .single();
        if (data?.logged_at) {
          const kst = new Date(new Date(data.logged_at).getTime() + 9 * 60 * 60 * 1000);
          return kst.toISOString().slice(0, 10);
        }
      }
    } catch {
      // 기록 없음
    }
    return null;
  }, [patientId, type]);

  // 날짜 범위 전체 데이터 한 번에 조회
  const fetchAllLogs = useCallback(async (earliest: string) => {
    if (!patientId) return;

    const { start: rangeStart } = getKSTDayRange(earliest);
    const { end: rangeEnd } = getKSTDayRange(todayStr);

    const newMap: Record<string, TimelineEntry[]> = {};

    try {
      if (type === 'medication') {
        const { data } = await supabase
          .from('med_logs')
          .select('taken_at, meal_time')
          .eq('patient_id', patientId)
          .gte('taken_at', rangeStart)
          .lte('taken_at', rangeEnd)
          .order('taken_at', { ascending: false });

        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.taken_at).getTime() + 9 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          newMap[kstDate].push({
            time: toKSTTime(row.taken_at),
            content: MEAL_TIME_KO[row.meal_time] ?? row.meal_time,
          });
        });
      } else if (type === 'bodystate') {
        const { data } = await supabase
          .from('on_off_logs')
          .select('logged_at, body_state, mood')
          .eq('patient_id', patientId)
          .gte('logged_at', rangeStart)
          .lte('logged_at', rangeEnd)
          .order('logged_at', { ascending: false });

        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.logged_at).getTime() + 9 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
          if (!newMap[kstDate]) newMap[kstDate] = [];
          const parts: string[] = [];
          if (row.body_state != null) parts.push(`몸상태 ${row.body_state}점`);
          if (row.mood != null) parts.push(`기분 ${row.mood}점`);
          newMap[kstDate].push({
            time: toKSTTime(row.logged_at),
            content: parts.join(' · ') || '기록',
          });
        });
      } else if (type === 'exercise') {
        const { data } = await supabase
          .from('exercise_logs')
          .select('logged_at, exercise_type, duration_minutes')
          .eq('patient_id', patientId)
          .gte('logged_at', rangeStart)
          .lte('logged_at', rangeEnd)
          .order('logged_at', { ascending: false });

        (data ?? []).forEach((row: any) => {
          const kstDate = new Date(new Date(row.logged_at).getTime() + 9 * 60 * 60 * 1000)
            .toISOString().slice(0, 10);
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

  // 펼쳤을 때 초기 데이터 로드
  const handleExpand = useCallback(async () => {
    setExpanded(true);
    if (initialLoaded) return;
    setLoading(true);

    const earliest = await fetchEarliestDate();
    setEarliestDate(earliest);

    if (earliest) {
      await fetchAllLogs(earliest);
    }

    setInitialLoaded(true);
    setLoading(false);
  }, [initialLoaded, fetchEarliestDate, fetchAllLogs]);

  // 날짜 목록 계산
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
      {/* 접기 버튼 */}
      <TouchableOpacity
        style={styles.toggleButton}
        onPress={() => setExpanded(false)}
        activeOpacity={0.8}
      >
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
                    {/* 왼쪽: 날짜 텍스트 */}
                    <View style={styles.dateCol}>
                      <Text style={styles.dateLabel}>{formatDateLabel(dateStr)}</Text>
                    </View>

                    {/* 가운데: 세로줄 + 원 */}
                    <View style={styles.lineCol}>
                      {/* 위쪽 세로줄 (첫 번째 아이템은 없음) */}
                      <View style={[styles.lineTop, idx === 0 && styles.lineInvisible]} />
                      {/* 원 */}
                      <View style={hasRecord ? styles.dotFilled : styles.dotEmpty} />
                      {/* 아래쪽 세로줄 (마지막 아이템은 없음) */}
                      <View style={[styles.lineBottom, isLast && styles.lineInvisible]} />
                    </View>

                    {/* 오른쪽: 기록 내용 */}
                    <View style={styles.contentCol}>
                      {hasRecord ? (
                        entries.map((entry, eIdx) => (
                          <View key={eIdx} style={styles.entryRow}>
                            <Text style={styles.entryTime}>{entry.time}</Text>
                            <Text style={styles.entryContent}>{entry.content}</Text>
                          </View>
                        ))
                      ) : (
                        <Text style={styles.emptyDay}>기록 없음</Text>
                      )}
                    </View>
                  </View>
                );
              })}

              {/* 더보기 버튼 */}
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

const styles = StyleSheet.create({
  toggleWrap: {
    paddingHorizontal: 16,
    paddingBottom: 32,
  },
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
  toggleButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
  },
  toggleArrow: {
    fontSize: 14,
    color: Colors.textHint,
  },

  container: {
    paddingBottom: 40,
  },

  loadingWrap: {
    alignItems: 'center',
    paddingVertical: 32,
    gap: 12,
  },
  loadingText: {
    fontSize: 17,
    color: Colors.textSub,
  },

  emptyWrap: {
    alignItems: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 18,
    color: Colors.textHint,
  },

  timeline: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 48,
  },

  // 날짜 컬럼 (왼쪽)
  dateCol: {
    width: 80,
    paddingTop: 14,
    alignItems: 'flex-end',
    paddingRight: 8,
  },
  dateLabel: {
    fontSize: 15,
    color: '#888888',
    fontWeight: '500',
  },

  // 세로줄 + 원 컬럼 (가운데)
  lineCol: {
    width: 28,
    alignItems: 'center',
    flexDirection: 'column',
  },
  lineTop: {
    width: 2,
    height: 14,
    backgroundColor: '#E0E0E0',
  },
  lineBottom: {
    width: 2,
    flex: 1,
    minHeight: 14,
    backgroundColor: '#E0E0E0',
  },
  lineInvisible: {
    backgroundColor: 'transparent',
  },
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

  // 기록 내용 컬럼 (오른쪽)
  contentCol: {
    flex: 1,
    paddingLeft: 10,
    paddingTop: 6,
    paddingBottom: 12,
  },
  entryRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 6,
    gap: 8,
  },
  entryTime: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.text,
    minWidth: 44,
  },
  entryContent: {
    fontSize: 17,
    color: Colors.text,
    flex: 1,
  },
  emptyDay: {
    fontSize: 16,
    color: '#CCCCCC',
    paddingTop: 2,
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
