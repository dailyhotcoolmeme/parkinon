import { supabase } from '../lib/supabase';

// ────────────────────────────────────────────────────────────────────────────
// 내 건강기록 내보내기 (사람이 읽기 쉬운 한글 CSV — 엑셀에서 바로 열림)
//
// 역할을 환자 → 보호자로 바꾸면 기록이 완전 삭제되므로, 삭제 전에 본인이 자신의
// 기록을 파일로 보관할 수 있게 한다. 내부 식별자(id/UUID)·이미지 URL 등은 빼고,
// 날짜·시간대·운동종류 등은 한글로 변환해 표(CSV)로 만든다.
// ────────────────────────────────────────────────────────────────────────────

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
const bool: Fmt = (v) => (v ? '예' : '아니오');

const MEAL: Record<string, string> = { breakfast: '아침', lunch: '점심', dinner: '저녁', bedtime: '취침', bed: '취침' };
const meal: Fmt = (v) => MEAL[String(v)] ?? asIs(v);
const mealArr: Fmt = (v) => (Array.isArray(v) ? v.map((x) => MEAL[String(x)] ?? String(x)).join(' / ') : asIs(v));

const EXERCISE: Record<string, string> = {
  walking: '걷기', strength: '근력', balance: '균형', stretching: '스트레칭',
  cycling: '자전거', swimming: '수영', dance: '댄스', boxing: '복싱', yoga: '요가', jogging: '조깅',
};
const exercise: Fmt = (v) => EXERCISE[String(v)] ?? asIs(v);
const arr: Fmt = (v) => (Array.isArray(v) ? v.join(' / ') : asIs(v));
const count: Fmt = (v, row) => (v ? `${v}${row?.count_unit ?? ''}` : '');
const photoCount: Fmt = (v) => (Array.isArray(v) && v.length > 0 ? `사진 ${v.length}장` : '');
const hasAudio: Fmt = (v) => (v ? '음성 있음' : '');

// ── 섹션(테이블 → 제목 + 내보낼 컬럼) ─────────────────────────────────────────
type ColDef = { col: string; label: string; fmt: Fmt };
type Section = { table: string; title: string; key: 'patient_id' | 'user_id'; cols: ColDef[] };

const SECTIONS: Section[] = [
  { table: 'medications', title: '약 목록', key: 'patient_id', cols: [
    { col: 'name', label: '약 이름', fmt: asIs },
    { col: 'dosage', label: '용량', fmt: asIs },
    { col: 'daily_count', label: '하루 복용', fmt: count },
    { col: 'meal_times', label: '복용 시간대', fmt: mealArr },
    { col: 'scheduled_times', label: '복용 시각', fmt: arr },
    { col: 'is_active', label: '복용 중', fmt: bool },
    { col: 'created_at', label: '등록일', fmt: dt },
  ] },
  { table: 'med_logs', title: '약 복용 기록', key: 'patient_id', cols: [
    { col: 'taken_at', label: '복용 시각', fmt: dt },
    { col: 'meal_time', label: '시간대', fmt: meal },
    { col: 'note', label: '메모', fmt: asIs },
  ] },
  { table: 'on_off_logs', title: '몸상태·기분 기록', key: 'patient_id', cols: [
    { col: 'logged_at', label: '기록 시각', fmt: dt },
    { col: 'body_state', label: '몸상태', fmt: asIs },
    { col: 'mood', label: '기분', fmt: asIs },
    { col: 'sleep_quality', label: '수면', fmt: asIs },
    { col: 'constipation', label: '변비', fmt: asIs },
    { col: 'trigger_time_label', label: '시점', fmt: asIs },
    { col: 'medication_meal_time', label: '약 시간대', fmt: meal },
  ] },
  { table: 'symptom_notes', title: '증상 메모', key: 'patient_id', cols: [
    { col: 'logged_at', label: '기록 시각', fmt: dt },
    { col: 'note', label: '내용', fmt: asIs },
  ] },
  { table: 'exercise_logs', title: '운동 기록', key: 'patient_id', cols: [
    { col: 'logged_at', label: '기록 시각', fmt: dt },
    { col: 'exercise_type', label: '운동 종류', fmt: exercise },
    { col: 'duration_minutes', label: '시간(분)', fmt: asIs },
  ] },
  { table: 'diary_entries', title: '일기', key: 'patient_id', cols: [
    { col: 'entry_date', label: '날짜', fmt: asIs },
    { col: 'text', label: '내용', fmt: asIs },
    { col: 'photo_urls', label: '사진', fmt: photoCount },
    { col: 'audio_r2_key', label: '음성', fmt: hasAudio },
  ] },
  { table: 'medical_appointments', title: '진료 일정', key: 'patient_id', cols: [
    { col: 'appointment_date', label: '진료일', fmt: asIs },
    { col: 'hospital_name', label: '병원', fmt: asIs },
    { col: 'doctor_name', label: '의사', fmt: asIs },
  ] },
  { table: 'medical_records', title: '진료 기록', key: 'patient_id', cols: [
    { col: 'visit_date', label: '방문일', fmt: asIs },
    { col: 'hospital_name', label: '병원', fmt: asIs },
    { col: 'doctor_name', label: '의사', fmt: asIs },
    { col: 'consultation_notes', label: '진료 메모', fmt: asIs },
  ] },
  { table: 'measurements', title: '동작 측정', key: 'user_id', cols: [
    { col: 'started_at', label: '시작', fmt: dt },
    { col: 'ended_at', label: '종료', fmt: dt },
    { col: 'type', label: '종류', fmt: asIs },
    { col: 'med_phase', label: '약효 단계', fmt: asIs },
    { col: 'context', label: '상황', fmt: asIs },
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
  const parts: string[] = [`파킨온 건강기록 (${stamp})`, ''];
  let hasData = false;

  for (const sec of SECTIONS) {
    let rows: any[] = [];
    try {
      const { data } = await (supabase as any).from(sec.table).select('*').eq(sec.key, userId);
      rows = Array.isArray(data) ? data : [];
    } catch {
      rows = [];
    }

    parts.push(`■ ${sec.title} (${rows.length}건)`);
    if (rows.length === 0) {
      parts.push('  기록 없음');
    } else {
      hasData = true;
      for (const r of rows) {
        const fields = sec.cols
          .map((c) => ({ label: c.label, val: cell(c.fmt(r[c.col], r)) }))
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
