#!/usr/bin/env node
/**
 * 번역 검수 리포트 — 케이스 단위로 "무엇을 아직 안 봤는지" 계산한다.
 *
 *   node scripts/qa-report.mjs fr
 *   node scripts/qa-report.mjs fr --pending screen     # 미실행 케이스 목록
 *
 * 판정:
 *   1) 한글 노출 — 해외 언어인데 화면에 한글. 0건이어야 한다.
 *   2) 글자 넘침 — 렌더된 줄 폭 > 상자 폭(실측).
 *   3) 케이스 실행 — qa/cases.json 의 케이스 중 실제로 돌아간 것.
 *   4) 키 커버리지 — 참고용. 케이스가 진짜 분모다.
 *
 * "몇 화면 봤다" 로 보고하지 않기 위해 존재한다. 케이스 목록은 코드에서 생성되므로
 * (scripts/qa-cases-gen.mjs) 내가 아는 만큼만 커지지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const LANG = args.find((a) => !a.startsWith('--')) || 'fr';
const PENDING = args.includes('--pending') ? args[args.indexOf('--pending') + 1] ?? 'all' : null;

const casesPath = path.join(ROOT, 'qa/cases.json');
if (!fs.existsSync(casesPath)) {
  console.error('케이스 목록이 없습니다. 먼저: node scripts/qa-cases-gen.mjs');
  process.exit(2);
}
const { cases, roles } = JSON.parse(fs.readFileSync(casesPath, 'utf8'));

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

const events = fs.readFileSync(jsonl, 'utf8').split('\n').filter(Boolean)
  .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);

const rendered = new Set();
const routesSeen = new Set();
const marks = [];
const hangul = [];
const overflow = [];
for (const e of events) {
  if (e.route && e.route !== '?' && e.route !== 'test') routesSeen.add(e.route);
  if (e.type === 'text') rendered.add(e.text);
  else if (e.type === 'hangul') hangul.push(e);
  else if (e.type === 'overflow') overflow.push(e);
  else if (e.type === 'mark') marks.push(e.text);
}
const renderedArr = [...rendered];
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function keyRendered(key) {
  const v = dict[key];
  if (typeof v !== 'string' || !v.trim()) return false;
  if (rendered.has(v)) return true;
  if (v.includes('{{')) {
    const re = new RegExp('^' + v.split(/\{\{[^}]+\}\}/).map(esc).join('[\\s\\S]{0,80}') + '$');
    if (renderedArr.some((t) => re.test(t))) return true;
  }
  return v.length >= 6 && renderedArr.some((t) => t.length > v.length && t.includes(v));
}

function executed(c) {
  if (c.kind === 'screen') return routesSeen.has(c.id.slice('screen:'.length));
  if (c.kind === 'dialog') return (c.keys ?? []).some(keyRendered);
  if (c.kind === 'notification' || c.kind === 'data-state') return marks.includes(c.id);
  return false;
}

const active = cases.filter((c) => !c.excluded);
const done = active.filter(executed);
const pending = active.filter((c) => !executed(c));

console.log(`\n═══ 번역 검수 리포트 — ${LANG} ═══`);
console.log(`케이스        ${done.length}/${active.length} 실행  (제외 ${cases.length - active.length})`);
for (const k of ['screen', 'dialog', 'notification', 'data-state']) {
  const all = active.filter((c) => c.kind === k);
  if (!all.length) continue;
  const d = all.filter(executed).length;
  console.log(`  ${k.padEnd(13)} ${String(d).padStart(4)}/${String(all.length).padEnd(4)} ${d === all.length ? '✅' : ''}`);
}
console.log(`역할 축       ${roles.map((r) => r.label).join(' / ')}`);
console.log(`한글 노출     ${hangul.length ? '❌ ' + hangul.length + '건' : '✅ 0건'}`);
console.log(`글자 넘침     ${overflow.length ? '❌ ' + overflow.length + '건' : '✅ 0건'}`);

if (hangul.length) {
  console.log('\n── 한글 노출');
  for (const h of hangul) console.log(`  [${h.route}] ${JSON.stringify(h.text)}`);
}
if (overflow.length) {
  console.log('\n── 글자 넘침');
  for (const o of overflow) {
    console.log(`  [${o.route}] ${JSON.stringify(o.text)}`);
    console.log(`      줄폭 ${o.lineW}pt / 상자 ${o.boxW}pt (numberOfLines=${o.numberOfLines})`);
  }
}

console.log(`\n── 미실행 케이스 ${pending.length}개`);
const byKind = new Map();
for (const c of pending) byKind.set(c.kind, (byKind.get(c.kind) ?? 0) + 1);
for (const [k, n] of byKind) console.log(`  ${String(n).padStart(4)}  ${k}`);
if (PENDING) {
  for (const c of pending) {
    if (PENDING !== 'all' && c.kind !== PENDING) continue;
    console.log(`  ${c.id}`);
    console.log(`      ${c.title}  · 진입: ${c.entry.how}${c.entry.note ? ' — ' + c.entry.note : ''}`);
  }
}
console.log('');
process.exit(hangul.length || overflow.length ? 1 : 0);
