import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../lib/supabase';
import { useAuth } from '../context/AuthContext';
import { usePatientId } from './usePatientId';
import { triggerLabelToMinutes } from '../utils/medUtils';
import { normalizeMediaOrder } from '../utils/diaryMedia';
import i18n from '../i18n';
import { isOverseasLocale } from '../i18n/detectLocale';


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
  sleep: number | null; // 수면 점수(1~5). 그날 첫 기록값. 없으면 null
  constipation: boolean | null; // 변비 있음/없음. 그날 마지막 기록값. 없으면 null
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
  video_duration_seconds: number | null; // video_media_id로 조인한 media_logs.duration_seconds (없으면 null → 썸네일이 메타로 폴백)
  // 첨부 표시 순서 토큰('photo:<url>'|'video'|'audio'). null이면 기본 순서(사진→영상→음성) 폴백.
  media_order: string[] | null;
  created_at: string;
  updated_at: string;
}

export interface SaveMyEntryInput {
  text: string;
  audioUrl: string | null;
  audioR2Key: string | null;
  photoUrls: string[];
  videoMediaId: string | null;
  // 사용자가 정한 첨부 순서 토큰 배열. 저장 시 현재 첨부 구성에 맞춰 정합화 후 upsert.
  mediaOrder: string[] | null;
}

// ─── 일기 영상 media_logs 행 + R2 파일 삭제 (베스트에포트) ────────────────────
// 일기에서 영상을 제거/교체/글삭제하면 그 video_media_id가 가리키던 media_logs
// 행과 R2 파일도 함께 지워, 영상 기록(VideoList)에서 사라지게 한다.
// VideoListScreen.handleDelete와 동일한 패턴(delete-r2-file Edge Function +
// 실패 시 DB 행만 삭제 fallback)을 재사용한다.
// diary_entries.video_media_id FK는 ON DELETE SET NULL이라, media_logs 행을
// 먼저 지워도 참조하던 일기 행의 video_media_id가 자동으로 null이 된다.
// 삭제 실패는 throw하지 않고 로그만 남긴다(일기 저장/삭제 자체를 막지 않음).
async function deleteDiaryVideoMedia(mediaId: string | null | undefined): Promise<void> {
  if (!mediaId) return;
  try {
    // r2_key 조회 (있으면 R2 파일까지, 없으면 DB 행만 삭제)
    const { data: ml } = await supabase
      .from('media_logs')
      .select('id, r2_key')
      .eq('id', mediaId)
      .maybeSingle();
    if (!ml) return; // 이미 없음

    const r2Key = (ml as { r2_key: string | null }).r2_key;
    if (r2Key) {
      const { error: efError } = await supabase.functions.invoke('delete-r2-file', {
        body: { r2_key: r2Key, media_log_id: mediaId },
      });
      if (efError) {
        console.error('[useDiary] 일기 영상 R2 삭제 실패, DB 행만 삭제 시도:', efError);
        const { error: dbError } = await supabase.from('media_logs').delete().eq('id', mediaId);
        if (dbError) console.error('[useDiary] 일기 영상 media_logs 삭제 실패:', dbError);
      }
    } else {
      const { error } = await supabase.from('media_logs').delete().eq('id', mediaId);
      if (error) console.error('[useDiary] 일기 영상 media_logs 삭제 실패:', error);
    }
  } catch (e) {
    console.error('[useDiary] 일기 영상 정리 중 오류(무시):', e);
  }
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
  const min = (!label || label === 'after_medication') ? 0 : triggerLabelToMinutes(label);
  const h = Math.floor(min / 60);
  const rem = min % 60;
  if (!label || label === 'after_medication' || !isFinite(min) || min === 0) return i18n.t('interval.rightAfter');
  if (min < 60) return i18n.t('interval.minLater', { m: min });
  return rem === 0 ? i18n.t('interval.hourLater', { h }) : i18n.t('interval.hourMinLater', { h, m: rem });
}

// ─── 달력용: 작성 이력 있는 날짜 조회 ─────────────────────────────────────────
// "작성 이력" = 사람이 쓴 일기 엔트리. 그룹(patient_id) 누군가가 그 날짜에
// 글(text)·사진(photo_urls)·영상(video_media_id)·음성(audio_url) 중 하나라도
// 가진 diary_entries 행이 있는 날. (자동 기록인 약/약효/운동만 있는 날은 제외 —
// diary_entries는 사람이 쓴 한마디 테이블이라 그 행의 내용 유무로 판별한다.)
//
// 주어진 KST 월(year, month0=0~11)의 [1일, 말일] 범위 entry_date를 가진 행만 조회해
// 내용 있는 날짜(YYYY-MM-DD)들의 Set을 반환한다. RLS는 기존 일기 조회와 동일.
export async function fetchDiaryEntryDates(
  patientId: string,
  year: number,
  month0: number,
): Promise<Set<string>> {
  const pad = (n: number) => String(n).padStart(2, '0');
  const firstDay = `${year}-${pad(month0 + 1)}-01`;
  const lastDate = new Date(year, month0 + 1, 0).getDate();
  const lastDay = `${year}-${pad(month0 + 1)}-${pad(lastDate)}`;

  const { data, error } = await supabase
    .from('diary_entries' as any)
    .select('entry_date, text, photo_urls, video_media_id, audio_url')
    .eq('patient_id', patientId)
    .gte('entry_date', firstDay)
    .lte('entry_date', lastDay);

  if (error) {
    console.error('[useDiary] fetchDiaryEntryDates 오류:', error);
    return new Set();
  }

  const result = new Set<string>();
  for (const r of (data as any[] | null) ?? []) {
    const hasText = typeof r.text === 'string' && r.text.trim().length > 0;
    const hasPhoto = Array.isArray(r.photo_urls) && r.photo_urls.length > 0;
    const hasVideo = !!r.video_media_id;
    const hasAudio = !!r.audio_url;
    if (hasText || hasPhoto || hasVideo || hasAudio) {
      result.add(r.entry_date);
    }
  }
  return result;
}

interface UseDiaryReturn {
  autoSummary: AutoSummary | null;
  entries: DiaryEntry[];
  loading: boolean;
  patientId: string | null;
  // existingId 없으면 새 글 insert, 있으면 그 글만 수정(author_id 일치 확인).
  saveEntry: (input: SaveMyEntryInput, existingId?: string | null) => Promise<void>;
  deleteEntry: (id: string) => Promise<void>;
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
          .select('id, body_state, mood, sleep_quality, constipation, logged_at, trigger_time_label')
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
              sleep_quality: number | null;
              constipation: boolean | null;
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

      // 수면: 그날 첫 기록(가장 이른 logged_at)의 sleep_quality. onOffRows는 오름차순 정렬.
      // 변비: 그날 마지막 기록(가장 늦은 logged_at)의 constipation. 값이 없으면 null.
      const sleep = onOffRows.find((r) => r.sleep_quality != null)?.sleep_quality ?? null;
      const constipation =
        [...onOffRows].reverse().find((r) => r.constipation != null)?.constipation ?? null;

      setAutoSummary({
        med: {
          count: medRows.length,
          times: medRows.map((r) => utcToKstHHMM(r.taken_at)).sort(),
        },
        bodyByTime: aggregateByTime('body_state'),
        moodByTime: aggregateByTime('mood'),
        exercise: exRows.map((r) => ({ type: r.exercise_type, minutes: r.duration_minutes })),
        exerciseCount: exRows.length,
        sleep,
        constipation,
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
      // 영상 길이(초) 맵 — 저장돼 있으면 썸네일에서 재생 전에도 길이 배지 표시(몸상태와 동일).
      let videoDurationMap: Record<string, number> = {};
      if (videoIds.length > 0) {
        const { data: vData } = await supabase
          .from('media_logs')
          .select('id, r2_url, duration_seconds')
          .in('id', videoIds);
        for (const v of (vData as { id: string; r2_url: string; duration_seconds: number | null }[] | null) ?? []) {
          videoUrlMap[v.id] = v.r2_url;
          if (typeof v.duration_seconds === 'number' && v.duration_seconds > 0) {
            videoDurationMap[v.id] = v.duration_seconds;
          }
        }
      }

      const mapped: DiaryEntry[] = diaryRows.map((r) => ({
        id: r.id,
        patient_id: r.patient_id,
        author_id: r.author_id,
        author_name: authorMap[r.author_id]?.name ?? i18n.t('authHook.defaultUserName'),
        author_role: authorMap[r.author_id]?.role ?? null,
        entry_date: r.entry_date,
        text: r.text ?? null,
        audio_url: r.audio_url ?? null,
        audio_r2_key: r.audio_r2_key ?? null,
        photo_urls: Array.isArray(r.photo_urls) ? r.photo_urls : [],
        video_media_id: r.video_media_id ?? null,
        video_url: r.video_media_id ? videoUrlMap[r.video_media_id] ?? null : null,
        video_duration_seconds: r.video_media_id ? videoDurationMap[r.video_media_id] ?? null : null,
        media_order: Array.isArray(r.media_order) ? r.media_order : null,
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

  // existingId 없으면 새 글 insert(하루 여러 건 허용), 있으면 그 글만 update.
  const saveEntry = useCallback(
    async (input: SaveMyEntryInput, existingId?: string | null) => {
      if (!patientId || !user) throw new Error(i18n.t('diaryHook.saveInfoMissingError'));
      const nowIso = new Date().toISOString();
      // 최종 첨부 구성에 맞춰 순서 토큰을 정합화(삭제된 토큰 제거·신규 토큰 append).
      // input.mediaOrder가 null이면 기본 순서(사진→영상→음성)로 만들어진다.
      const mediaOrder = normalizeMediaOrder(input.mediaOrder, {
        photoUrls: input.photoUrls,
        hasVideo: !!input.videoMediaId,
        hasAudio: !!input.audioUrl,
      });

      let prevVideoMediaId: string | null = null;

      if (existingId) {
        // 수정: 저장 전 이 글의 기존 video_media_id를 조회해 둔다.
        // 사용자가 영상을 ✕로 제거(새 video_media_id=null)했거나 다른 영상으로
        // 교체(새 id≠이전 id)한 경우, 더 이상 참조되지 않는 이전 영상의
        // media_logs 행 + R2 파일을 정리하기 위함이다.
        const { data: prevRow } = await supabase
          .from('diary_entries' as any)
          .select('video_media_id')
          .eq('id', existingId)
          .eq('author_id', user.id)
          .maybeSingle();
        prevVideoMediaId = (prevRow as { video_media_id: string | null } | null)?.video_media_id ?? null;

        const { error } = await supabase
          .from('diary_entries' as any)
          .update({
            text: input.text || null,
            audio_url: input.audioUrl,
            audio_r2_key: input.audioR2Key,
            photo_urls: input.photoUrls,
            video_media_id: input.videoMediaId,
            media_order: mediaOrder,
            updated_at: nowIso,
          })
          .eq('id', existingId)
          .eq('author_id', user.id);
        if (error) throw new Error(error.message);
      } else {
        // 새 글: 하루에 여러 건 허용 — 항상 insert.
        const { error } = await supabase.from('diary_entries' as any).insert({
          patient_id: patientId,
          author_id: user.id,
          entry_date: dateStr,
          text: input.text || null,
          audio_url: input.audioUrl,
          audio_r2_key: input.audioR2Key,
          photo_urls: input.photoUrls,
          video_media_id: input.videoMediaId,
          media_order: mediaOrder,
          updated_at: nowIso,
        });
        if (error) throw new Error(error.message);

        // 가족 일기 알림 — '새로 작성'일 때만 그룹의 다른 가족에게 푸시(오너 결정: 수정은 X).
        //   cross-user 라 서버(edge function) 경유. 실패해도 저장 흐름은 막지 않음(베스트에포트).
        supabase.functions
          .invoke('notify-diary-entry', {
            body: { patient_id: patientId, entry_date: dateStr, author_id: user.id },
          })
          .catch(() => {});
      }

      // 저장(diary_entries.video_media_id 갱신) 후에 이전 영상을 정리한다.
      // 순서상 일기 행이 먼저 새 값을 가리키므로 FK(SET NULL) 충돌 없이 안전하다.
      // 이전 영상이 있고 + 더 이상 참조되지 않으면(제거 또는 교체) 삭제. 베스트에포트.
      if (prevVideoMediaId && prevVideoMediaId !== input.videoMediaId) {
        await deleteDiaryVideoMedia(prevVideoMediaId);
      }

      await fetchAll();
    },
    [patientId, user, dateStr, fetchAll],
  );

  // 글 하나 삭제 (RLS: author 본인만 삭제 허용, id로 특정)
  const deleteEntry = useCallback(
    async (id: string) => {
      if (!user) throw new Error(i18n.t('diaryHook.deleteInfoMissingError'));

      // 글에 첨부된 영상(video_media_id)을 미리 조회 → 글 삭제 후 함께 정리.
      const { data: row } = await supabase
        .from('diary_entries' as any)
        .select('video_media_id')
        .eq('id', id)
        .eq('author_id', user.id)
        .maybeSingle();
      const videoMediaId = (row as { video_media_id: string | null } | null)?.video_media_id ?? null;

      const { error } = await supabase
        .from('diary_entries' as any)
        .delete()
        .eq('id', id)
        .eq('author_id', user.id);
      if (error) throw new Error(error.message);

      // 글 삭제 성공 후 그 글의 영상 media_logs 행 + R2 파일 정리(베스트에포트).
      await deleteDiaryVideoMedia(videoMediaId);

      await fetchAll();
    },
    [user, fetchAll],
  );

  return {
    autoSummary,
    entries,
    loading: loading || pidLoading,
    patientId,
    saveEntry,
    deleteEntry,
    refresh: fetchAll,
  };
}
