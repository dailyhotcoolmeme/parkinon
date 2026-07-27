import { supabase } from '../lib/supabase';
import i18n from '../i18n';

// ────────────────────────────────────────────────────────────────────────────
// 내 건강기록 내보내기 (사람이 읽기 쉬운 텍스트)
//
// 역할을 환자 → 보호자로 바꾸면 기록이 완전 삭제되므로, 삭제 전에 본인이 자신의
// 기록을 파일로 보관할 수 있게 한다. 내부 식별자(id/UUID)·이미지 URL 등은 빼고,
// 날짜·시간대·운동종류 등은 사람이 읽는 말로 바꿔 정리한다.
//
// ⚠️ 문구는 반드시 앱 언어를 따라야 한다. 예전엔 제목·항목명·시간대·운동종류가 전부
//   한국어로 고정돼 있어, 영어 사용자는 자기 기록을 읽을 수 없는 파일로 받았다
//   (실측 2026-07-27). 이건 기록이 삭제되기 직전의 마지막 백업이라 되돌릴 수 없다.
// ────────────────────────────────────────────────────────────────────────────

/** 내보내기 문구는 호출 시점의 앱 언어로 만든다(모듈 로드 시점이 아니라). */
const tx = (key: string, opts?: Record<string, unknown>): string =>
  String(i18n.t(`healthExport.${key}`, opts as any));

type Fmt = (v: any, row?: any) => string;

// ── 값 포맷터 ───────────────────────────────────────────────────────────────
const pad = (n: number) => String(n).padStart(2, '0');
/** ISO 일시 → "YYYY-MM-DD HH:MM" (로컬 시간). 파싱 실패 시 원문. */
const dt: Fmt = (v) => {
  if (!v) return '';
  const d = new Date(v);
  if (isNaN(d.getTime())) return String(v);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const asIs: Fmt = (v) => (v === null || v === undefined ? '' : String(v));
const bool: Fmt = (v) => (v ? tx('yes') : tx('no'));

// DB 값 → 표시어. 'bed' 는 구버전 'bedtime' 값이라 같은 문구로 맞춘다.
const MEAL_KEY: Record<string, string> = {
  breakfast: 'breakfast', lunch: 'lunch', dinner: 'dinner', bedtime: 'bedtime', bed: 'bedtime',
};
const mealWord = (v: any): string => {
  const k = MEAL_KEY[String(v)];
  return k ? tx(`meal.${k}`) : asIs(v);
};
const meal: Fmt = (v) => mealWord(v);
const mealArr: Fmt = (v) => (Array.isArray(v) ? v.map(mealWord).join(' / ') : asIs(v));

const EXERCISE_KEYS = new Set([
  'walking', 'strength', 'balance', 'stretching',
  'cycling', 'swimming', 'dance', 'boxing', 'yoga', 'jogging',
]);
const exercise: Fmt = (v) => (EXERCISE_KEYS.has(String(v)) ? tx(`exercise.${v}`) : asIs(v));
const arr: Fmt = (v) => (Array.isArray(v) ? v.join(' / ') : asIs(v));
const count: Fmt = (v, row) => (v ? `${v}${row?.count_unit ?? ''}` : '');
const photoCount: Fmt = (v) =>
  Array.isArray(v) && v.length > 0 ? tx('photos', { count: v.length }) : '';
const hasAudio: Fmt = (v) => (v ? tx('audio') : '');

// ── 섹션(테이블 → 제목 + 내보낼 컬럼) ─────────────────────────────────────────
// title/label 은 번역 "키"만 담는다. 실제 문구는 내보내는 시점에 앱 언어로 만든다
// (모듈 로드 시점에 굳히면 언어를 바꿔도 옛 언어로 남는다).
type ColDef = { col: string; labelKey: string; fmt: Fmt };
type Section = { table: string; titleKey: string; key: 'patient_id' | 'user_id'; cols: ColDef[] };

const SECTIONS: Section[] = [
  { table: 'medications', titleKey: 'medications', key: 'patient_id', cols: [
    { col: 'name', labelKey: 'name', fmt: asIs },
    { col: 'dosage', labelKey: 'dosage', fmt: asIs },
    { col: 'daily_count', labelKey: 'dailyCount', fmt: count },
    { col: 'meal_times', labelKey: 'mealTimes', fmt: mealArr },
    { col: 'scheduled_times', labelKey: 'scheduledTimes', fmt: arr },
    { col: 'is_active', labelKey: 'isActive', fmt: bool },
    { col: 'created_at', labelKey: 'createdAt', fmt: dt },
  ] },
  { table: 'med_logs', titleKey: 'medLogs', key: 'patient_id', cols: [
    { col: 'taken_at', labelKey: 'takenAt', fmt: dt },
    { col: 'meal_time', labelKey: 'mealTime', fmt: meal },
    { col: 'note', labelKey: 'note', fmt: asIs },
  ] },
  { table: 'on_off_logs', titleKey: 'onOffLogs', key: 'patient_id', cols: [
    { col: 'logged_at', labelKey: 'loggedAt', fmt: dt },
    { col: 'body_state', labelKey: 'bodyState', fmt: asIs },
    { col: 'mood', labelKey: 'mood', fmt: asIs },
    { col: 'sleep_quality', labelKey: 'sleep', fmt: asIs },
    { col: 'constipation', labelKey: 'constipation', fmt: asIs },
    { col: 'trigger_time_label', labelKey: 'triggerPoint', fmt: asIs },
    { col: 'medication_meal_time', labelKey: 'medMealTime', fmt: meal },
  ] },
  { table: 'symptom_notes', titleKey: 'symptomNotes', key: 'patient_id', cols: [
    { col: 'logged_at', labelKey: 'loggedAt', fmt: dt },
    { col: 'note', labelKey: 'content', fmt: asIs },
  ] },
  { table: 'exercise_logs', titleKey: 'exerciseLogs', key: 'patient_id', cols: [
    { col: 'logged_at', labelKey: 'loggedAt', fmt: dt },
    { col: 'exercise_type', labelKey: 'exerciseType', fmt: exercise },
    { col: 'duration_minutes', labelKey: 'durationMin', fmt: asIs },
  ] },
  { table: 'diary_entries', titleKey: 'diary', key: 'patient_id', cols: [
    { col: 'entry_date', labelKey: 'date', fmt: asIs },
    { col: 'text', labelKey: 'content', fmt: asIs },
    { col: 'photo_urls', labelKey: 'photos', fmt: photoCount },
    { col: 'audio_r2_key', labelKey: 'audio', fmt: hasAudio },
  ] },
  { table: 'medical_appointments', titleKey: 'appointments', key: 'patient_id', cols: [
    { col: 'appointment_date', labelKey: 'appointmentDate', fmt: asIs },
    { col: 'hospital_name', labelKey: 'hospital', fmt: asIs },
    { col: 'doctor_name', labelKey: 'doctor', fmt: asIs },
  ] },
  { table: 'medical_records', titleKey: 'medicalRecords', key: 'patient_id', cols: [
    { col: 'visit_date', labelKey: 'visitDate', fmt: asIs },
    { col: 'hospital_name', labelKey: 'hospital', fmt: asIs },
    { col: 'doctor_name', labelKey: 'doctor', fmt: asIs },
    { col: 'consultation_notes', labelKey: 'consultationNotes', fmt: asIs },
  ] },
  { table: 'measurements', titleKey: 'measurements', key: 'user_id', cols: [
    { col: 'started_at', labelKey: 'startedAt', fmt: dt },
    { col: 'ended_at', labelKey: 'endedAt', fmt: dt },
    { col: 'type', labelKey: 'type', fmt: asIs },
    { col: 'med_phase', labelKey: 'medPhase', fmt: asIs },
    { col: 'context', labelKey: 'context', fmt: asIs },
  ] },
];

/** 한 셀 값 정리: 개행 → 공백, 앞뒤 공백 제거. */
function cell(s: string): string {
  return s.replace(/\r?\n/g, ' ').trim();
}

/**
 * 사용자의 모든 건강기록을 사람이 읽기 쉬운 텍스트로 만든다.
 * 표 기호(마크다운) 없이 "한 줄=한 기록"으로 정리 → 카톡·메일에서 렌더링 없이도 한눈에 훑기 좋음.
 * 각 줄: `· <첫값>  ·  <라벨> <값>  ·  …` (빈 값은 생략, 첫 값은 라벨 없이 앵커로).
 * @param userId 대상 사용자(=환자 본인) id
 * @returns { text, hasData } 내보낼 텍스트와 실제 기록 존재 여부
 */
export async function buildHealthRecordsExport(userId: string): Promise<{ text: string; hasData: boolean }> {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const parts: string[] = [tx('title', { date: stamp }), ''];
  let hasData = false;

  for (const sec of SECTIONS) {
    let rows: any[] = [];
    try {
      const { data } = await (supabase as any).from(sec.table).select('*').eq(sec.key, userId);
      rows = Array.isArray(data) ? data : [];
    } catch {
      rows = [];
    }

    parts.push(tx('sectionHeader', { title: tx(`section.${sec.titleKey}`), count: rows.length }));
    if (rows.length === 0) {
      parts.push(tx('noRecords'));
    } else {
      hasData = true;
      for (const r of rows) {
        const fields = sec.cols
          .map((c) => ({ label: tx(`col.${c.labelKey}`), val: cell(c.fmt(r[c.col], r)) }))
          .filter((f) => f.val !== '');
        if (fields.length === 0) continue;
        // 첫 값(주로 날짜/이름)은 앵커로 라벨 없이, 나머지는 "라벨 값".
        const line = '· ' + fields.map((f, i) => (i === 0 ? f.val : `${f.label} ${f.val}`)).join('  ·  ');
        parts.push(line);
      }
    }
    parts.push('');
  }

  return { text: parts.join('\n'), hasData };
}
