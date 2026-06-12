import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePatientId } from './usePatientId';
import { triggerLabelToMinutes } from '../utils/medUtils';

// ─── 자동 수집 요약 타입 ──────────────────────────────────────────────────────

export interface MedSummary {
  count: number;
  times: string[]; // 'HH:MM' 형식 복용 시각 목록 (KST)
}

// 시간대(trigger_time_label)별 평균 점수 한 줄.
// 같은 시점 라벨(복용직후/30분 후/2시간 후…)이 하루에 여러 복용 회차에 걸쳐
// 반복되므로, 라벨별로 평균을 내어 소수 첫째 자리로 표현한다.
export interface TimePointAvg {
  label: string; // 사람이 읽는 시점 라벨 (예: '복용직후', '30분 후', '2시간 후')
  avg: number; // 해당 시점 라벨의 평균 점수 (소수 첫째 자리)
}

export interface ExerciseSummaryItem {
  type: string;
  minutes: number;
}

export interface MediaSummaryItem {
  id: string;
  mediaType: 'video' | 'photo';
  url: string;
}

export interface AutoSummary {
  med: MedSummary;
  bodyByTime: TimePointAvg[]; // 몸상태(body_state) 시간대별 평균
  moodByTime: TimePointAvg[]; // 기분(mood) 시간대별 평균
  exercise: ExerciseSummaryItem[];
  exerciseCount: number;
  media: MediaSummaryItem[];
}

// ─── 사람 작성 "한마디" 타입 ──────────────────────────────────────────────────

export interface DiaryEntry {
  id: string;
  patient_id: string;
  author_id: string;
  author_name: string;
  author_role: 'patient' | 'caregiver' | null;
  entry_date: string;
  text: string | null;
  audio_url: string | null;
  audio_r2_key: string | null;
  photo_urls: string[];
  video_media_id: string | null;
  video_url: string | null; // video_media_id로 조인한 media_logs.r2_url
  created_at: string;
  updated_at: string;
}

export interface SaveMyEntryInput {
  text: string;
  audioUrl: string | null;
  audioR2Key: string | null;
  photoUrls: string[];
  videoMediaId: string | null;
}

// ─── KST 날짜 → UTC 경계 변환 ─────────────────────────────────────────────────
// dateStr(YYYY-MM-DD, KST)의 [00:00 KST, 다음날 00:00 KST) 범위를 UTC ISO로 반환.
// KST = UTC+9 이므로 KST 00:00 = 전날 UTC 15:00.
function kstDayRangeUtc(dateStr: string): { startUtc: string; endUtc: string } {
  // dateStr 00:00:00 KST 의 UTC = dateStr 00:00:00 - 9h
  const startKst = new Date(`${dateStr}T00:00:00.000+09:00`);
  const endKst = new Date(startKst.getTime() + 24 * 60 * 60 * 1000);
  return { startUtc: startKst.toISOString(), endUtc: endKst.toISOString() };
}

// UTC ISO 문자열 → KST 'HH:MM'
function utcToKstHHMM(iso: string): string {
  const d = new Date(new Date(iso).getTime() + 9 * 60 * 60 * 1000);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${hh}:${mm}`;
}

// trigger_time_label → 짧은 사람용 라벨 (칩용). 'after_medication'→'복용직후', '30min_after'→'30분 후', '2hour_after'→'2시간 후'
// 공용 분 환산(triggerLabelToMinutes) 재사용해 일관성 유지.
function triggerLabelToChip(label: string | null | undefined): string {
  if (!label || label === 'after_medication') return '복용직후';
  const min = triggerLabelToMinutes(label);
  if (!isFinite(min) || min === 0) return '복용직후';
  if (min < 60) return `${min}분 후`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h}시간 후` : `${h}시간 ${rem}분 후`;
}

interface UseDiaryReturn {
  autoSummary: AutoSummary | null;
  entries: DiaryEntry[];
  loading: boolean;
  patientId: string | null;
  saveMyEntry: (input: SaveMyEntryInput) => Promise<void>;
  deleteMyEntry: () => Promise<void>;
  refresh: () => Promise<void>;
}

/**
 * 종합 데일리 저널 데이터 훅.
 * @param dateStr YYYY-MM-DD (KST 기준 날짜)
 */
export function useDiary(dateStr: string): UseDiaryReturn {
  const { user } = useAuth();
  const { patientId, loading: pidLoading } = usePatientId();
  const [autoSummary, setAutoSummary] = useState<AutoSummary | null>(null);
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchAll = useCallback(async () => {
    if (!patientId || !dateStr) {
      setAutoSummary(null);
      setEntries([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const { startUtc, endUtc } = kstDayRangeUtc(dateStr);

    try {
      // ── 자동 수집: 약 복용 / 약효추적 / 운동 / 미디어 ──
      const [medRes, onOffRes, exRes, mediaRes] = await Promise.all([
        supabase
          .from('med_logs')
          .select('id, taken_at')
          .eq('patient_id', patientId)
          .gte('taken_at', startUtc)
          .lt('taken_at', endUtc)
          .order('taken_at', { ascending: true }),
        supabase
          .from('on_off_logs')
          .select('id, body_state, mood, logged_at, trigger_time_label')
          .eq('patient_id', patientId)
          .gte('logged_at', startUtc)
          .lt('logged_at', endUtc)
          .order('logged_at', { ascending: true }),
        supabase
          .from('exercise_logs')
          .select('id, exercise_type, duration_minutes, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', startUtc)
          .lt('logged_at', endUtc)
          .order('logged_at', { ascending: true }),
        supabase
          .from('media_logs')
          .select('id, media_type, r2_url, logged_at')
          .eq('patient_id', patientId)
          .gte('logged_at', startUtc)
          .lt('logged_at', endUtc)
          .order('logged_at', { ascending: true }),
      ]);

      const medRows = (medRes.data as { id: string; taken_at: string }[] | null) ?? [];
      const onOffRows =
        (onOffRes.data as
          | {
              id: string;
              body_state: number | null;
              mood: number | null;
              logged_at: string;
              trigger_time_label: string | null;
            }[]
          | null) ?? [];
      const exRows =
        (exRes.data as { id: string; exercise_type: string; duration_minutes: number }[] | null) ?? [];
      const mediaRows =
        (mediaRes.data as { id: string; media_type: 'video' | 'photo'; r2_url: string }[] | null) ?? [];

      // 약효추적 기록을 trigger_time_label(시점)별로 묶어 평균을 낸다.
      // 하루에 약을 여러 번 먹으면 복용직후/30분/2시간 라벨이 회차마다 반복되므로
      // 같은 시점끼리 평균(소수 첫째 자리)을 내어 한 줄로 요약한다.
      // 몸상태(body_state)·기분(mood)을 각각 별도로 집계한다.
      const aggregateByTime = (field: 'body_state' | 'mood'): TimePointAvg[] => {
        // rawLabel별 { sum, count } 누적 (정렬 키로 rawLabel 분 환산값 사용)
        const buckets = new Map<string, { sum: number; count: number }>();
        for (const r of onOffRows) {
          const v = r[field];
          if (v == null) continue;
          const key = r.trigger_time_label ?? 'after_medication';
          const cur = buckets.get(key) ?? { sum: 0, count: 0 };
          cur.sum += v;
          cur.count += 1;
          buckets.set(key, cur);
        }
        return Array.from(buckets.entries())
          .map(([rawLabel, { sum, count }]) => ({
            rawLabel,
            label: triggerLabelToChip(rawLabel),
            avg: Math.round((sum / count) * 10) / 10, // 소수 첫째 자리
          }))
          .sort((a, b) => triggerLabelToMinutes(a.rawLabel) - triggerLabelToMinutes(b.rawLabel))
          .map(({ label, avg }) => ({ label, avg }));
      };

      setAutoSummary({
        med: {
          count: medRows.length,
          times: medRows.map((r) => utcToKstHHMM(r.taken_at)).sort(),
        },
        bodyByTime: aggregateByTime('body_state'),
        moodByTime: aggregateByTime('mood'),
        exercise: exRows.map((r) => ({ type: r.exercise_type, minutes: r.duration_minutes })),
        exerciseCount: exRows.length,
        media: mediaRows.map((r) => ({ id: r.id, mediaType: r.media_type, url: r.r2_url })),
      });

      // ── 사람 작성 "한마디" (diary_entries) ──
      const { data: diaryData } = await supabase
        .from('diary_entries' as any)
        .select('*')
        .eq('patient_id', patientId)
        .eq('entry_date', dateStr)
        .order('created_at', { ascending: true });

      const diaryRows = (diaryData as any[] | null) ?? [];

      // 작성자 이름/역할 조회
      const authorIds = Array.from(new Set(diaryRows.map((r) => r.author_id)));
      let authorMap: Record<string, { name: string; role: 'patient' | 'caregiver' | null }> = {};
      if (authorIds.length > 0) {
        const { data: usersData } = await supabase
          .from('users')
          .select('id, name, role')
          .in('id', authorIds);
        for (const u of (usersData as { id: string; name: string; role: any }[] | null) ?? []) {
          authorMap[u.id] = { name: u.name, role: u.role ?? null };
        }
      }

      // video_media_id → media_logs.r2_url 조회
      const videoIds = diaryRows.map((r) => r.video_media_id).filter((v): v is string => !!v);
      let videoUrlMap: Record<string, string> = {};
      if (videoIds.length > 0) {
        const { data: vData } = await supabase
          .from('media_logs')
          .select('id, r2_url')
          .in('id', videoIds);
        for (const v of (vData as { id: string; r2_url: string }[] | null) ?? []) {
          videoUrlMap[v.id] = v.r2_url;
        }
      }

      const mapped: DiaryEntry[] = diaryRows.map((r) => ({
        id: r.id,
        patient_id: r.patient_id,
        author_id: r.author_id,
        author_name: authorMap[r.author_id]?.name ?? '사용자',
        author_role: authorMap[r.author_id]?.role ?? null,
        entry_date: r.entry_date,
        text: r.text ?? null,
        audio_url: r.audio_url ?? null,
        audio_r2_key: r.audio_r2_key ?? null,
        photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
        video_media_id: r.video_media_id ?? null,
        video_url: r.video_media_id ? videoUrlMap[r.video_media_id] ?? null : null,
        created_at: r.created_at,
        updated_at: r.updated_at,
      }));

      setEntries(mapped);
    } catch (e) {
      console.error('[useDiary] fetchAll 오류:', e);
    } finally {
      setLoading(false);
    }
  }, [patientId, dateStr]);

  useEffect(() => {
    if (pidLoading) return;
    fetchAll();
  }, [fetchAll, pidLoading]);

  const saveMyEntry = useCallback(
    async (input: SaveMyEntryInput) => {
      if (!patientId || !user) throw new Error('저장에 필요한 정보가 없어요.');
      const nowIso = new Date().toISOString();
      const { error } = await supabase
        .from('diary_entries' as any)
        .upsert(
          {
            patient_id: patientId,
            author_id: user.id,
            entry_date: dateStr,
            text: input.text || null,
            audio_url: input.audioUrl,
            audio_r2_key: input.audioR2Key,
            photo_urls: input.photoUrls,
            video_media_id: input.videoMediaId,
            updated_at: nowIso,
          },
          { onConflict: 'patient_id,entry_date,author_id' },
        );
      if (error) throw new Error(error.message);
      await fetchAll();
    },
    [patientId, user, dateStr, fetchAll],
  );

  // 내가 쓴 그날의 글 삭제 (RLS: author 본인만 삭제 허용)
  const deleteMyEntry = useCallback(async () => {
    if (!patientId || !user) throw new Error('삭제에 필요한 정보가 없어요.');
    const { error } = await supabase
      .from('diary_entries' as any)
      .delete()
      .eq('patient_id', patientId)
      .eq('entry_date', dateStr)
      .eq('author_id', user.id);
    if (error) throw new Error(error.message);
    await fetchAll();
  }, [patientId, user, dateStr, fetchAll]);

  return {
    autoSummary,
    entries,
    loading: loading || pidLoading,
    patientId,
    saveMyEntry,
    deleteMyEntry,
    refresh: fetchAll,
  };
}
