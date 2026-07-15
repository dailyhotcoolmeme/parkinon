import { supabase } from '../lib/supabase';

// ────────────────────────────────────────────────────────────────────────────
// 내 건강기록 내보내기
//
// 역할을 환자 → 보호자로 바꾸면 기록이 "완전 삭제"되므로, 삭제 전에 본인이 자신의
// 기록을 파일로 보관할 수 있게 한다(법적·UX 안전장치 — 데이터를 회사가 아닌 사용자가 갖게 함).
//
// 형식: 사람이 읽기 쉬운 CSV(섹션별 표). 네이티브 모듈 추가 없이(OTA 안전)
//       expo-file-system(legacy) 로 파일 저장 후 RN 내장 Share 로 공유한다.
// ────────────────────────────────────────────────────────────────────────────

// 내보낼 섹션(테이블 → 한글 제목). 시스템/설정성 테이블(dose_slots·queue·debug)은 제외.
const SECTIONS: { table: string; title: string; key: 'patient_id' | 'user_id' }[] = [
  { table: 'medications',          title: '약 목록',            key: 'patient_id' },
  { table: 'med_logs',             title: '약 복용 기록',        key: 'patient_id' },
  { table: 'symptom_notes',        title: '몸상태·기분 기록',     key: 'patient_id' },
  { table: 'on_off_logs',          title: '약효(온·오프) 기록',   key: 'patient_id' },
  { table: 'exercise_logs',        title: '운동 기록',           key: 'patient_id' },
  { table: 'diary_entries',        title: '일기',               key: 'patient_id' },
  { table: 'medical_appointments', title: '진료 일정',           key: 'patient_id' },
  { table: 'medical_records',      title: '진료 기록',           key: 'patient_id' },
  { table: 'measurements',         title: '동작 측정',           key: 'user_id' },
];

/** CSV 한 칸 이스케이프 (콤마·따옴표·개행 포함 시 큰따옴표로 감쌈). */
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  let s: string;
  if (typeof v === 'object') s = JSON.stringify(v);
  else s = String(v);
  if (/[",\n\r]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
  return s;
}

/**
 * 사용자의 모든 건강기록을 사람이 읽기 쉬운 CSV 텍스트로 만든다.
 * @param userId 대상 사용자(=환자 본인) id
 * @returns { text, hasData } 내보낼 텍스트와 실제 기록 존재 여부
 */
export async function buildHealthRecordsExport(userId: string): Promise<{ text: string; hasData: boolean }> {
  const now = new Date();
  const stamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const parts: string[] = [`파킨온 건강기록 내보내기 (${stamp})`, ''];
  let hasData = false;

  for (const sec of SECTIONS) {
    let rows: any[] = [];
    try {
      const { data } = await (supabase as any)
        .from(sec.table)
        .select('*')
        .eq(sec.key, userId);
      rows = Array.isArray(data) ? data : [];
    } catch {
      rows = [];
    }

    parts.push(`■ ${sec.title} (${rows.length}건)`);
    if (rows.length > 0) {
      hasData = true;
      // 컬럼 순서: 첫 행 기준. 내부 식별자(id/patient_id/user_id)는 가독성 위해 뒤로.
      const cols = Object.keys(rows[0]).sort((a, b) => {
        const idish = (k: string) => (/^id$|_id$/.test(k) ? 1 : 0);
        return idish(a) - idish(b);
      });
      parts.push(cols.join(','));
      for (const r of rows) parts.push(cols.map((c) => csvCell(r[c])).join(','));
    }
    parts.push('');
  }

  return { text: parts.join('\n'), hasData };
}
