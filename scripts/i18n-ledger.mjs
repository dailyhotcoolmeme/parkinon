#!/usr/bin/env node
/**
 * 한글 대장 — 발견된 한글 하나하나에 "번역 대상 / 제외" 판정을 붙인 목록.
 *
 *   node scripts/i18n-ledger.mjs          → qa/ledger.json + 요약 출력
 *   node scripts/i18n-ledger.mjs --list 앱 → 해당 구역 항목 전부 출력
 *
 * 이 대장의 "번역 대상" 줄이 그대로 번역 작업 목록이 되고,
 * 거기 적힌 파일·줄이 "이 문구가 어느 화면에 나오나"를 정리할 때 출발점이 된다.
 *
 * 원칙(2026-07-30 오너 확정):
 *   - 기본값은 **번역 대상**이다. 빼는 것은 아래 EXCLUDE 규칙에 걸릴 때뿐이고,
 *     규칙에는 사유와 승인일이 반드시 있어야 한다(없으면 실패).
 *   - 목록은 사람이 타이핑하지 않는다. 파일은 파일시스템에서, DB 컬럼은
 *     information_schema 에서 긁는다. 그래야 내가 모르는 자리도 빠지지 않는다.
 *   - console 안의 문구는 번역하지 않고 **영어로 고정**한다(2026-07-30 오너 확정).
 *     이건 내 판정이 아니라 코드에 console.error 라고 적혀 있는지로 기계가 가른다.
 *     262개 문구가 화면 쪽에서도 쓰이는지 전체 소스에서 재검색했고 겹침은 0건이었다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.resolve(ROOT, '../parkinon-web');
const PROJECT_REF = 'avqaflxufyadgzjiojkk';
const OUT = path.join(ROOT, 'qa/ledger.json');
const HANGUL = /[가-힣]/;

const args = process.argv.slice(2);
const LIST = args.includes('--list') ? args[args.indexOf('--list') + 1] : null;

/**
 * 소스 제외 규칙. 경로/내용이 여기 걸리면 번역 대상에서 뺀다.
 * 줄을 추가하려면 오너 승인이 필요하고, 추가한 사실은 git diff 에 보인다.
 */
const EXCLUDE_SOURCE = [
  { where: 'web', match: /pages\/Admin\.tsx$/, reason: '관리자 페이지 — 오너가 직접 보며 작업', approved: '2026-07-30' },
  { where: '*', match: /[Mm]easurement|TapGame|ReactionGame|utils\/biomarker\.ts$/, reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  // 웹 증상 상세의 탭 횟수·반응시간은 측정 기능 화면이다(같은 결정).
  { where: 'web', match: /pages\/SymptomDetail\.tsx$/, reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  { where: '*', match: /ExerciseVideo/, reason: '운동 영상 — 국내 전용', approved: '2026-07-29' },
  { where: '*', match: /screens\/feed\/|components\/feed\/|PostWrite|PostDetail/, reason: '커뮤니티 — 국내 전용', approved: '2026-07-29' },
  { where: '*', match: /i18n\/locales\/(ko|en|fr|ja)\.json$/, reason: '번역 파일 자체(ko 는 원문)', approved: '2026-07-29' },
  // 서버 번역표. locales/ko.json 과 같은 성격 — ko: 블록이 원문이다.
  { where: 'server', match: /_shared\/i18n\.ts$/, reason: '서버 번역 파일 자체(ko 는 원문)', approved: '2026-07-29' },
  { where: '*', match: /kakao-auth|kakaoAuth/, reason: '카카오 로그인 — 국내 전용 로그인 방식', approved: '2026-07-30' },
  { where: '*', match: /mfds-proxy/, reason: '식약처 API — 국내 전용', approved: '2026-07-30' },
  // OCR 프롬프트의 따옴표 안 한국어는 지시문이 아니라 **처방전에 인쇄된 글자**다.
  // 모델이 사진에서 찾아야 할 대상이라 그대로 둔다. 사용자 화면에 나가지 않는다(오너 확정).
  { where: 'server', match: /claude-medical-record\/index\.ts$/, reason: 'OCR 프롬프트 — 처방전에 인쇄된 글자', approved: '2026-07-30' },
  { where: '*', match: /i18n\/(hangulGuard|textHook|qaProbe|qaWalk)\.ts$/, reason: '한글 검출 가드 자신', approved: '2026-07-30' },
  { where: '*', match: /scripts\/i18n-|scripts\/qa-/, reason: '검수 도구 자신', approved: '2026-07-30' },
  // 약 이름 대조 키워드 — 사용자가 등록한 한글 약 이름에 이 글자가 있는지 보는 표다.
  // 화면에 나가지 않는다. medication_pk_profile.product_name 과 같은 성격(오너 확정).
  { where: '*', match: /constants\/medEffectProfiles\.ts$/, reason: '약 이름 대조 키워드 — 화면 비노출', approved: '2026-07-30' },
  { where: '*', match: /^locales\/(ko|en|fr|ja)\.json$/, reason: 'iOS 네이티브 권한 문구(언어별 파일)', approved: '2026-07-30' },
];

/**
 * DB 컬럼 판정. 여기 없는 컬럼에 한글이 있으면 "미분류"로 실패한다.
 * kind: translate=키로 바꿔 번역 파일에서 표시 / exclude=대상 아님 / done=처리 완료
 */
const DB_RULES = [
  { col: 'dose_slots.label', kind: 'translate', reason: '복용 시간대 표시명 — 키로 저장하고 표시명은 번역 파일에서', approved: '2026-07-30' },
  { col: 'medications.dosage', kind: 'translate', reason: '용량 표시값 — dosage_unit 키로 통일', approved: '2026-07-30' },
  // 언어별 칸(body_ko/en/fr/ja)이 갖춰졌다 — ko 칸의 한글은 한국어 본문이므로 정상이다.
  { col: 'dev_letter.body_ko', kind: 'done', reason: '개발자 편지 — 언어별 칸 4개 완비(2026-07-30)', approved: '2026-07-30' },
  { col: 'dev_letter.signature_ko', kind: 'done', reason: '개발자 편지 서명 — 언어별 칸 4개 완비(2026-07-30)', approved: '2026-07-30' },

  { col: 'medication_pk_profile.notes', kind: 'done', reason: 'notes_key 로 대체하고 원본 삭제(2026-07-30)', approved: '2026-07-30' },
  { col: 'medication_pk_profile.product_name', kind: 'exclude', reason: '국내 제품명 대조표 — 한글로 등록해야만 걸림', approved: '2026-07-30' },

  { col: 'users.name', kind: 'exclude', reason: '사용자 이름', approved: '2026-07-30' },
  { col: 'users.relation_note', kind: 'exclude', reason: '사용자가 쓴 메모', approved: '2026-07-30' },
  { col: 'custom_sounds.label', kind: 'exclude', reason: '사용자가 붙인 녹음 이름', approved: '2026-07-30' },
  { col: 'diary_entries.text', kind: 'exclude', reason: '사용자가 쓴 일기', approved: '2026-07-30' },
  { col: 'symptom_notes.note', kind: 'exclude', reason: '사용자가 쓴 몸 상태 메모', approved: '2026-07-30' },
  { col: 'med_logs.note', kind: 'exclude', reason: '사용자가 쓴 복약 메모', approved: '2026-07-30' },
  { col: 'medications.name', kind: 'exclude', reason: '사용자·OCR 이 넣은 약 이름', approved: '2026-07-30' },
  { col: 'medical_appointments.doctor_name', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_appointments.hospital_name', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_records.doctor_name', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_records.hospital_name', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_records.consultation_notes', kind: 'exclude', reason: '사용자가 쓴 진료 메모', approved: '2026-07-30' },
  { col: 'medical_record_medications.medication_name', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_record_medications.dosage', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'medical_record_medications.frequency', kind: 'exclude', reason: '사용자가 입력', approved: '2026-07-30' },
  { col: 'prescriptions.hospital', kind: 'exclude', reason: '처방전 OCR 결과', approved: '2026-07-30' },
  { col: 'prescriptions.raw_ocr_text', kind: 'exclude', reason: '처방전 OCR 원문', approved: '2026-07-30' },
  { col: 'prescription_items.product_name', kind: 'exclude', reason: '처방전 OCR 결과', approved: '2026-07-30' },
  { col: 'prescription_items.free_text', kind: 'exclude', reason: '처방전 OCR 결과', approved: '2026-07-30' },

  { col: 'notification_logs.title', kind: 'exclude', reason: '발송 시점 수신자 언어로 굳은 이력', approved: '2026-07-30' },
  { col: 'notification_logs.body', kind: 'exclude', reason: '발송 시점 수신자 언어로 굳은 이력', approved: '2026-07-30' },

  { col: 'posts.title', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'posts.content', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'posts.author_name_override', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'posts.hidden_reason', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'comments.content', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'comments.hidden_reason', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'post_reports.reason', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'post_reports.detail', kind: 'exclude', reason: '커뮤니티 — 국내 전용', approved: '2026-07-30' },
  { col: 'news_feed.title', kind: 'exclude', reason: '뉴스 크롤링 — 미사용', approved: '2026-07-30' },
  { col: 'news_feed.summary', kind: 'exclude', reason: '뉴스 크롤링 — 미사용', approved: '2026-07-30' },
  { col: 'news_feed.content', kind: 'exclude', reason: '뉴스 크롤링 — 미사용', approved: '2026-07-30' },
  { col: 'news_feed.source', kind: 'exclude', reason: '뉴스 크롤링 — 미사용', approved: '2026-07-30' },
  { col: 'users.banned_reason', kind: 'exclude', reason: '운영자 기록 — 사용자 화면에 노출 안 됨', approved: '2026-07-30' },
];

const walk = (dir, exts, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (/node_modules|\.git|\/dist|\/build|\.expo|\.qa/.test(p)) continue;
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};

/**
 * 파일에서 화면·알림·로그에 나갈 수 있는 한글 문자열을 뽑는다.
 * 주석은 뺀다(코드가 아니다). 로그는 **빼지 않는다** — A-1 확정.
 */
function scanFile(file) {
  const src = fs.readFileSync(file, 'utf8');
  const lines = src.split('\n');
  const hits = [];
  let inBlock = false;
  lines.forEach((raw, i) => {
    let l = raw;
    if (inBlock) {
      const end = l.indexOf('*/');
      if (end === -1) return;
      l = l.slice(end + 2);
      inBlock = false;
    }
    // 한 줄 안에서 열고 닫는 주석(/* ... */)도 걷어낸다.
    // 이게 없으면 {/* "닫기" 버튼 */} 같은 주석 문구가 번역 대상으로 잡힌다(2026-07-30 발견).
    l = l.replace(/\/\*[\s\S]*?\*\//g, '');
    const bs = l.indexOf('/*');
    if (bs !== -1) { inBlock = true; l = l.slice(0, bs); }
    const ls = l.indexOf('//');
    if (ls !== -1 && !/https?:/.test(l.slice(Math.max(0, ls - 6), ls))) l = l.slice(0, ls);
    if (!HANGUL.test(l)) return;
    // 한국어 문법 처리(조사 은/는 판정)는 번역 대상이 아니라 언어 규칙 자체다.
    // 다른 언어에는 조사가 없어 옮길 곳도 없다(2026-07-30 오너 승인).
    if (/topicParticle|josa|particle/i.test(l) || /'(은|는|이|가|을|를|와|과)'/.test(l)) return;
    // 옛 DB 값을 알아보기 위한 비교값(includes/startsWith)은 표시 문자열이 아니다.
    // 예: label.includes('직후'), s.includes('아침') — 미업데이트 앱이 쓴 값과 맞춰야 한다.
    if (/\.(includes|startsWith|endsWith)\(\s*['"][^'"]*[가-힣]/.test(l)) return;
    // 옛 저장값 → 키 역매핑 표. 한국어뿐 아니라 영어·프랑스어·일본어 라벨도 함께 들어 있고,
    // 미업데이트 앱이 다시 쓸 수 있어 지울 수 없다(오너 승인 2026-07-30).
    if (/RAW_LABEL_TO_ID|RAW_EXERCISE_TYPE_TO_ID/.test(src)) {
      const inTable = lines.slice(Math.max(0, i - 25), i).some((x) => /RAW_(LABEL|EXERCISE_TYPE)_TO_ID/.test(x));
      if (inTable) return;
    }
    for (const m of l.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (!HANGUL.test(m[2])) continue;
      // 한글이 객체 키로 쓰이면 표시 문자열이 아니라 식별자다 — 영어 키로 바꿔야 할 자리.
      const after = l.slice(m.index + m[0].length).trimStart();
      hits.push({
        line: i + 1,
        text: m[2],
        identifier: after.startsWith(':'),
        // 개발자 콘솔에만 찍히는 문구 — 번역하지 않고 영어로 고정한다.
        log: /console\.(log|warn|error|info|debug)/.test(raw),
      });
    }
  });
  return hits;
}

function classifySource(where, rel) {
  for (const r of EXCLUDE_SOURCE) {
    if (r.where !== '*' && r.where !== where) continue;
    if (!r.match.test(rel)) continue;
    if (!r.approved) return { kind: 'unclassified', reason: `제외 규칙에 승인일이 없습니다: ${rel}` };
    return { kind: 'exclude', reason: r.reason, approved: r.approved };
  }
  return { kind: 'translate', reason: '기본값 — 번역 대상' };
}

const zones = [
  { where: '앱', key: 'app', root: path.join(ROOT, 'src'), exts: ['.ts', '.tsx'] },
  { where: '서버', key: 'server', root: path.join(ROOT, 'supabase/functions'), exts: ['.ts'] },
  { where: '웹', key: 'web', root: path.join(WEB_ROOT, 'src'), exts: ['.ts', '.tsx'] },
];

const entries = [];
for (const z of zones) {
  for (const file of walk(z.root, z.exts)) {
    const rel = path.relative(z.key === 'web' ? WEB_ROOT : ROOT, file);
    const verdict = classifySource(z.key, rel);
    for (const h of scanFile(file)) {
      entries.push({
        zone: z.where,
        location: `${rel}:${h.line}`,
        text: h.text.length > 90 ? h.text.slice(0, 90) + '…' : h.text,
        kind: verdict.kind !== 'translate' ? verdict.kind
          : h.log ? 'log-en'
            : h.identifier ? 'identifier'
              : 'translate',
        reason: verdict.kind !== 'translate' ? verdict.reason
          : h.log ? 'console 전용 — 영어로 고정'
            : h.identifier ? '한글이 식별자로 쓰임 — 영어 키로 교체'
              : verdict.reason,
      });
    }
  }
}

// ── DB ────────────────────────────────────────────────────────────
let dbRows = [];
const srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (srk) {
  const res = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/rpc/qa_hangul_scan`, {
    method: 'POST',
    headers: { apikey: srk, Authorization: `Bearer ${srk}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (res.ok) dbRows = (await res.json()).filter((r) => r.hangul_rows > 0);
}
for (const r of dbRows) {
  const col = `${r.table_name}.${r.column_name}`;
  const rule = DB_RULES.find((x) => x.col === col);
  entries.push({
    zone: 'DB',
    location: col,
    text: `${r.hangul_rows}/${r.total_rows}행 · 예: ${String(r.sample ?? '').slice(0, 50)}`,
    kind: rule ? rule.kind : 'unclassified',
    reason: rule ? rule.reason : '판정되지 않은 컬럼 — 오너 결정 필요',
  });
}

const by = (k) => entries.filter((e) => e.kind === k);
const summary = {
  translate: by('translate').length,
  logEn: by('log-en').length,
  identifier: by('identifier').length,
  exclude: by('exclude').length,
  done: by('done').length,
  unclassified: by('unclassified').length,
};

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedFrom: 'scripts/i18n-ledger.mjs',
  summary,
  byZone: Object.fromEntries(['앱', '서버', '웹', 'DB'].map((z) => [z, {
    translate: entries.filter((e) => e.zone === z && e.kind === 'translate').length,
    identifier: entries.filter((e) => e.zone === z && e.kind === 'identifier').length,
    exclude: entries.filter((e) => e.zone === z && e.kind === 'exclude').length,
  }])),
  entries,
}, null, 2) + '\n');

console.log('═══ 한글 대장 ═══');
console.log(`전체 ${entries.length}건 → ${path.relative(ROOT, OUT)}\n`);
console.log(`  번역 대상        ${String(summary.translate).padStart(5)}`);
console.log(`  영어 고정(로그)   ${String(summary.logEn).padStart(5)}`);
console.log(`  식별자 교체 대상  ${String(summary.identifier).padStart(5)}`);
console.log(`  제외             ${String(summary.exclude).padStart(5)}`);
console.log(`  처리 완료        ${String(summary.done).padStart(5)}`);
console.log(`  미분류           ${String(summary.unclassified).padStart(5)}${summary.unclassified ? '  ❌ 오너 결정 필요' : ''}`);
console.log('\n구역별 번역 대상:');
for (const z of ['앱', '서버', '웹', 'DB']) {
  const t = entries.filter((e) => e.zone === z && e.kind === 'translate').length;
  const i = entries.filter((e) => e.zone === z && e.kind === 'identifier').length;
  const x = entries.filter((e) => e.zone === z && e.kind === 'exclude').length;
  console.log(`  ${z.padEnd(4)} 번역 ${String(t).padStart(4)} · 식별자 ${String(i).padStart(3)} · 제외 ${String(x).padStart(4)}`);
}
if (summary.unclassified) {
  console.log('\n── 미분류(오너 결정 필요)');
  for (const e of by('unclassified')) console.log(`  [${e.zone}] ${e.location}  ${e.text}`);
}
if (LIST) {
  console.log(`\n── ${LIST} 구역 상세`);
  for (const e of entries.filter((x) => x.zone === LIST && (x.kind === 'translate' || x.kind === 'identifier'))) {
    console.log(`  ${e.kind === 'identifier' ? '식별자' : '번역'}  ${e.location}  ${JSON.stringify(e.text)}`);
  }
}
if (!srk) console.log('\n⚠️  SUPABASE_SERVICE_ROLE_KEY 가 없어 DB 는 건너뛰었습니다.');
process.exit(summary.unclassified ? 1 : 0);
