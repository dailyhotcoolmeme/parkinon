#!/usr/bin/env node
/**
 * 번역 검수 리포트 — 수집기가 쌓은 렌더 기록으로 "무엇을 아직 못 봤는지" 계산한다.
 *
 *   node scripts/qa-report.mjs fr
 *   node scripts/qa-report.mjs fr --uncovered      # 미노출 키 전체 목록
 *   node scripts/qa-report.mjs fr --ns doseSlots   # 특정 네임스페이스만
 *
 * 판정 세 가지:
 *   1) 한글노출 — 해외 언어인데 화면에 한글. 0건이어야 한다(무조건 실패 조건).
 *   2) 글자넘침 — 렌더된 줄 폭 > 상자 폭. 실측이라 추정이 아니다.
 *   3) 커버리지 — 번역 키 중 실제로 화면에 뜬 비율. 미노출 키가 곧 남은 숙제다.
 *
 * 매칭은 보수적으로 한다(못 본 걸 봤다고 하는 쪽이 위험하므로):
 *   exact  값이 그대로 그려짐
 *   tmpl   {{변수}} 자리를 채운 형태로 그려짐
 *   part   6자 이상인 값이 더 긴 문장 안에 통째로 들어 있음
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LANG = args.find((a) => !a.startsWith('--')) || 'fr';
const SHOW_ALL = args.includes('--uncovered');
const NS_ONLY = args.includes('--ns') ? args[args.indexOf('--ns') + 1] : null;

const jsonl = path.join(ROOT, '.qa', `${LANG}.jsonl`);
if (!fs.existsSync(jsonl)) {
  console.error(`수집 기록이 없습니다: ${jsonl}\n먼저 node scripts/qa-collector.mjs ${LANG} 로 수집하세요.`);
  process.exit(2);
}

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};
const dict = flatten(JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${LANG}.json`), 'utf8')));
const keys = Object.entries(dict).filter(([, v]) => typeof v === 'string' && v.trim());

const events = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean).map((l) => {
  try { return JSON.parse(l); } catch { return null; }
}).filter(Boolean);

const rendered = new Set();
const routes = new Set();
const hangul = [];
const overflow = [];
for (const e of events) {
  if (e.route && e.route !== '?') routes.add(e.route);
  if (e.type === 'text') rendered.add(e.text);
  else if (e.type === 'hangul') hangul.push(e);
  else if (e.type === 'overflow') overflow.push(e);
}
const renderedArr = [...rendered];

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

const covered = new Map(); // key → 매칭 방식
for (const [key, val] of keys) {
  if (rendered.has(val)) { covered.set(key, 'exact'); continue; }
  if (val.includes('{{')) {
    // {{변수}} 를 "무엇이든"으로 바꿔 실제 그려진 문장과 맞춰본다.
    const re = new RegExp('^' + val.split(/\{\{[^}]+\}\}/).map(esc).join('[\\s\\S]{0,80}') + '$');
    if (renderedArr.some((t) => re.test(t))) { covered.set(key, 'tmpl'); continue; }
  }
  if (val.length >= 6 && renderedArr.some((t) => t.length > val.length && t.includes(val))) {
    covered.set(key, 'part');
  }
}

const uncovered = keys.filter(([k]) => !covered.has(k)).map(([k, v]) => [k, v]);
const pct = ((covered.size / keys.length) * 100).toFixed(1);

console.log(`\n═══ 번역 검수 리포트 — ${LANG} ═══`);
console.log(`방문한 화면       ${routes.size}개`);
console.log(`그려진 문구       ${rendered.size}개`);
console.log(`키 커버리지       ${covered.size}/${keys.length}  (${pct}%)`);
console.log(`한글 노출         ${hangul.length ? '❌ ' + hangul.length + '건' : '✅ 0건'}`);
console.log(`글자 넘침         ${overflow.length ? '❌ ' + overflow.length + '건' : '✅ 0건'}`);

if (hangul.length) {
  console.log('\n── 한글 노출 (해외 사용자에게 그대로 보이는 것)');
  for (const h of hangul) console.log(`  [${h.route}] ${JSON.stringify(h.text)}`);
}
if (overflow.length) {
  console.log('\n── 글자 넘침 (줄 폭 > 상자 폭)');
  for (const o of overflow) {
    console.log(`  [${o.route}] ${JSON.stringify(o.text)}`);
    console.log(`      줄폭 ${o.lineW}pt / 상자 ${o.boxW}pt  (numberOfLines=${o.numberOfLines})`);
  }
}

// 미노출 키는 네임스페이스별로 묶어야 "어느 화면을 더 돌아야 하는지"가 보인다.
const byNs = new Map();
for (const [k, v] of uncovered) {
  const ns = k.split('.')[0];
  if (!byNs.has(ns)) byNs.set(ns, []);
  byNs.get(ns).push([k, v]);
}
const sorted = [...byNs.entries()].sort((a, b) => b[1].length - a[1].length);

console.log(`\n── 아직 화면에 안 뜬 키  ${uncovered.length}개  (네임스페이스 ${sorted.length}개)`);
for (const [ns, list] of sorted) {
  if (NS_ONLY && ns !== NS_ONLY) continue;
  console.log(`  ${String(list.length).padStart(4)}  ${ns}`);
  if (SHOW_ALL || NS_ONLY === ns) {
    for (const [k, v] of list) console.log(`        ${k}  ${JSON.stringify(v.slice(0, 60))}`);
  }
}
console.log('');
process.exit(hangul.length || overflow.length ? 1 : 0);
