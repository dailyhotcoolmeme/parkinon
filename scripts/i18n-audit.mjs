#!/usr/bin/env node
/**
 * 한글 전수 감사 — 앱·웹·서버·DB 전부에서 한글을 찾아 실패시킨다.
 *
 *   node scripts/i18n-audit.mjs
 *
 * 왜 이 파일이 존재하나:
 *   2026-07-29 에 "앱·웹·서버·DB 의 모든 한글을 조사해 번역한다"는 지시를 받고,
 *   나는 소스 코드를 grep 했다. 그런데 `dose_slots.label` 처럼 **DB 에 들어 있는**
 *   한글은 소스에 한 글자도 없어서 grep 에 걸리지 않았고, 나는 그걸 조사 대상에서
 *   조용히 빠뜨린 채 "전부 조사했다"고 보고했다. 다음 날 보호자 푸시 알림에
 *   "아침" 이 그대로 나갔다.
 *
 *   그래서 이 감사는 **목록을 사람이 타이핑하지 않는다**:
 *     - DB  : information_schema 에서 모든 text 컬럼을 긁는다
 *     - 소스: 확장자로 파일을 전부 모은다
 *   빼먹는 것이 구조적으로 불가능해야 하고, 빼려면 아래 EXCLUDE 에 줄을 추가하는
 *   수밖에 없다 — 그건 git diff 에 보인다.
 *
 * 통과 못 하면 exit 1. 배포 전에 반드시 통과해야 한다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.resolve(ROOT, '../parkinon-web');
const PROJECT_REF = 'avqaflxufyadgzjiojkk';
const HANGUL = /[가-힣]/;

/**
 * 제외 목록 — 여기 없으면 무조건 실패한다.
 * 오너 승인 없이 줄을 추가하지 않는다(규칙 R1). approved 가 비면 실패시킨다.
 */
const EXCLUDE_DB = [
  // 사용자가 직접 쓴 내용 — 번역 대상이 아니다(2026-07-29 오너 승인).
  { table: 'posts', column: 'title', reason: '사용자가 쓴 글 제목', approved: '2026-07-29' },
  { table: 'posts', column: 'content', reason: '사용자가 쓴 글 본문', approved: '2026-07-29' },
  { table: 'comments', column: 'content', reason: '사용자가 쓴 댓글', approved: '2026-07-29' },
  { table: 'users', column: 'name', reason: '사용자 이름', approved: '2026-07-29' },
  { table: 'users', column: 'relation_note', reason: '사용자가 쓴 관계 메모', approved: '2026-07-29' },
  { table: 'symptom_notes', column: 'note', reason: '사용자가 쓴 몸 상태 메모', approved: '2026-07-29' },
  { table: 'medications', column: 'name', reason: '처방전 OCR/사용자 입력 약 이름', approved: '2026-07-29' },
  { table: 'news_feed', column: 'title', reason: '국내 뉴스 크롤링 원문', approved: '2026-07-29' },
  { table: 'news_feed', column: 'summary', reason: '국내 뉴스 크롤링 원문', approved: '2026-07-29' },
  { table: 'news_feed', column: 'content', reason: '국내 뉴스 크롤링 원문', approved: '2026-07-29' },
];

const EXCLUDE_SOURCE = [
  // 한국어 원문 파일과 감사 도구 자신.
  { match: /src\/i18n\/locales\/ko\.json$/, reason: '한국어 원문(번역 소스)', approved: '2026-07-29' },
  { match: /src\/i18n\/locales\/(en|fr|ja)\.json$/, reason: '번역 결과(i18n-check 가 따로 본다)', approved: '2026-07-29' },
  { match: /scripts\/i18n-.*\.mjs$/, reason: '감사 도구 자신', approved: '2026-07-30' },
  { match: /src\/i18n\/(hangulGuard|textHook|qaProbe|qaWalk)\.ts$/, reason: '한글 검출 가드 자신', approved: '2026-07-30' },
  { match: /locales\/(ko|en|fr|ja)\.json$/, reason: 'iOS 네이티브 권한 문구(언어별 파일)', approved: '2026-07-30' },
];

const fail = [];
const warn = [];

/** 소스에서 "화면에 나갈 수 있는" 한글 문자열만 뽑는다(주석·로그는 뺀다). */
function scanSourceFile(file, rel) {
  const text = fs.readFileSync(file, 'utf8');
  const hits = [];
  const lines = text.split('\n');
  let inBlockComment = false;
  lines.forEach((line, i) => {
    let l = line;
    if (inBlockComment) {
      const end = l.indexOf('*/');
      if (end === -1) return;
      l = l.slice(end + 2);
      inBlockComment = false;
    }
    const bs = l.indexOf('/*');
    if (bs !== -1 && l.indexOf('*/', bs) === -1) { inBlockComment = true; l = l.slice(0, bs); }
    const ls = l.indexOf('//');
    if (ls !== -1) l = l.slice(0, ls);
    if (/console\.(log|warn|error|info)/.test(l)) return;
    if (!HANGUL.test(l)) return;
    // 문자열 리터럴 안의 한글만 — 식별자나 타입에 든 건 화면에 안 나간다.
    for (const m of l.matchAll(/(['"`])((?:\\.|(?!\1)[\s\S])*?)\1/g)) {
      if (HANGUL.test(m[2])) hits.push({ line: i + 1, text: m[2].slice(0, 70) });
    }
  });
  return hits.length ? { rel, hits } : null;
}

function walk(dir, exts, out = [], skip = /node_modules|\.git|ios|android|dist|build|\.expo|\.qa/) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (skip.test(p)) continue;
    if (e.isDirectory()) walk(p, exts, out, skip);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
}

function excludedSource(rel) {
  const hit = EXCLUDE_SOURCE.find((e) => e.match.test(rel));
  if (!hit) return null;
  if (!hit.approved) { fail.push(`제외 목록에 승인 표시가 없습니다: ${rel}`); return null; }
  return hit;
}

function scanTree(label, root, exts) {
  const files = walk(root, exts);
  const found = [];
  for (const f of files) {
    const rel = path.relative(root, f);
    if (excludedSource(rel)) continue;
    const r = scanSourceFile(f, rel);
    if (r) found.push(r);
  }
  console.log(`\n── ${label}  파일 ${files.length}개 검사`);
  if (!found.length) { console.log('   ✅ 한글 없음'); return; }
  const n = found.reduce((a, b) => a + b.hits.length, 0);
  console.log(`   ❌ ${found.length}개 파일 / ${n}건`);
  for (const f of found.slice(0, 40)) {
    console.log(`   ${f.rel}`);
    for (const h of f.hits.slice(0, 4)) console.log(`      :${h.line}  ${JSON.stringify(h.text)}`);
  }
  if (found.length > 40) console.log(`   … 외 ${found.length - 40}개 파일`);
  fail.push(`${label}: ${n}건`);
}

async function scanDb() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    warn.push('DB 검사 건너뜀 — SUPABASE_SERVICE_ROLE_KEY 가 없습니다');
    console.log('\n── DB\n   ⚠️  SUPABASE_SERVICE_ROLE_KEY 미설정으로 건너뜀');
    return;
  }
  const res = await fetch(`https://${PROJECT_REF}.supabase.co/rest/v1/rpc/qa_hangul_scan`, {
    method: 'POST',
    headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: '{}',
  });
  if (!res.ok) { fail.push(`DB 스캔 실패 (${res.status})`); console.log(`\n── DB\n   ❌ 호출 실패 ${res.status}`); return; }
  const rows = await res.json();
  console.log(`\n── DB  한글이 든 컬럼 ${rows.length}개 (information_schema 에서 직접 열거)`);
  const bad = [];
  for (const r of rows) {
    const ex = EXCLUDE_DB.find((e) => e.table === r.table_name && e.column === r.column_name);
    const mark = ex ? (ex.approved ? '제외' : '승인없음') : null;
    if (!ex || !ex.approved) bad.push(r);
    console.log(
      `   ${mark === '제외' ? '⚪' : '❌'} ${r.table_name}.${r.column_name}` +
      `  ${r.hangul_rows}/${r.total_rows}행  ${JSON.stringify(r.sample ?? '')}` +
      (ex ? `  [${mark}: ${ex.reason}]` : ''),
    );
  }
  if (bad.length) fail.push(`DB: 승인되지 않은 컬럼 ${bad.length}개에 한글`);
}

console.log('═══ 한글 전수 감사 ═══');
scanTree('앱 소스', path.join(ROOT, 'src'), ['.ts', '.tsx']);
scanTree('서버 함수', path.join(ROOT, 'supabase/functions'), ['.ts']);
scanTree('웹', path.join(WEB_ROOT, 'src'), ['.ts', '.tsx', '.json']);
await scanDb();

console.log('\n═══ 결과 ═══');
for (const w of warn) console.log(`⚠️  ${w}`);
if (fail.length) {
  for (const f of fail) console.log(`❌ ${f}`);
  console.log('\n한글이 남아 있습니다. 배포 금지.');
  process.exit(1);
}
console.log('✅ 통과 — 앱·서버·웹·DB 어디에도 승인되지 않은 한글이 없습니다.');
