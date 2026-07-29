#!/usr/bin/env node
/**
 * 번역 길이 감사 — 버튼/칩/탭이 터지는 걸 번역 단계에서 막는다.
 *
 * 왜 필요한가:
 *   파킨온은 60대 타겟이라 글씨 18sp+·버튼 56dp+ 로 이미 크다. 여유 공간이 적어
 *   번역이 조금만 길어져도 버튼을 넘치거나 박스를 흉하게 늘린다.
 *   폰트를 줄이는 건 이 앱에선 답이 아니므로(가독성), 번역 길이를 예산 안에 묶는다.
 *
 * 쓰는 법:
 *   node scripts/i18n-length-audit.mjs <대상언어> [기준언어=en]
 *   node scripts/i18n-length-audit.mjs fr
 *   node scripts/i18n-length-audit.mjs ja ko
 *
 * 판정:
 *   키 이름으로 "좁은 UI에 들어가는 문자열"을 추정해 예산을 다르게 준다.
 *   버튼/탭/칩은 넘칠 여유가 거의 없고, 안내문(Msg/Desc)은 줄바꿈이 되므로 관대하다.
 *
 * 폭 계산은 글자 수가 아니라 근사 시각폭을 쓴다.
 *   한중일 전각은 라틴의 약 2배 폭이라 글자 수로 비교하면 일본어가 과대평가된다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LOCALES = path.join(ROOT, 'src/i18n/locales');

const target = process.argv[2];
const base = process.argv[3] || 'en';
if (!target) {
  console.error('사용법: node scripts/i18n-length-audit.mjs <대상언어> [기준언어=en]');
  process.exit(1);
}

/** 좁은 UI 요소로 추정되는 키 이름 패턴 → 허용 배율(기준언어 대비). */
const BUDGETS = [
  // 버튼/탭/칩 — 한 줄 고정. 거의 못 늘어난다.
  { re: /(Btn|Button|Cta|Tab|Chip|Badge|Action)$/i, ratio: 1.10, kind: '버튼·탭·칩' },
  // 짧은 라벨 — 보통 값과 나란히 배치돼 폭이 제한된다.
  { re: /(Label|Unit|Short|Name)$/i, ratio: 1.20, kind: '라벨' },
  // 제목 — 헤더/모달 타이틀. 두 줄 되면 레이아웃이 흔들린다.
  { re: /(Title|Header|Heading)$/i, ratio: 1.25, kind: '제목' },
  // 그 외(본문·안내) — 줄바꿈되므로 관대하게.
  { re: /.*/, ratio: 1.60, kind: '본문' },
];

/** 전각(한중일·기호)은 2, 그 외는 1로 근사한 시각 폭. */
function visualWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    const c = ch.codePointAt(0);
    const wide =
      (c >= 0x1100 && c <= 0x115f) ||
      (c >= 0x2e80 && c <= 0xa4cf) ||
      (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xf900 && c <= 0xfaff) ||
      (c >= 0xfe30 && c <= 0xfe6f) ||
      (c >= 0xff00 && c <= 0xff60) ||
      (c >= 0xffe0 && c <= 0xffe6);
    w += wide ? 2 : 1;
  }
  return w;
}

/** 가장 긴 줄만 본다 — 줄바꿈이 있으면 그 줄이 폭을 결정한다. */
function widestLine(s) {
  return Math.max(...String(s).split('\n').map(visualWidth));
}

function flatten(obj, prefix = '', out = {}) {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
}

function budgetFor(key) {
  const leaf = key.split('.').pop();
  return BUDGETS.find((b) => b.re.test(leaf));
}

const load = (lang) => {
  const p = path.join(LOCALES, `${lang}.json`);
  if (!fs.existsSync(p)) {
    console.error(`파일 없음: ${p}`);
    process.exit(1);
  }
  return flatten(JSON.parse(fs.readFileSync(p, 'utf8')));
};

const baseMap = load(base);
const targetMap = load(target);

const missing = [];
const over = [];

for (const [key, bv] of Object.entries(baseMap)) {
  const tv = targetMap[key];
  if (tv == null) { missing.push(key); continue; }
  if (typeof bv !== 'string' || typeof tv !== 'string') continue;

  const bw = widestLine(bv);
  const tw = widestLine(tv);
  if (bw === 0) continue;

  const { ratio, kind } = budgetFor(key);
  const allowed = Math.max(Math.ceil(bw * ratio), bw + 2); // 아주 짧은 문자열의 과민반응 방지
  if (tw > allowed) {
    over.push({ key, kind, bw, tw, allowed, ratio, bv, tv });
  }
}

over.sort((a, b) => (b.tw - b.allowed) - (a.tw - a.allowed));

console.log(`\n기준 ${base} → 대상 ${target}`);
console.log(`전체 키 ${Object.keys(baseMap).length}개 · 누락 ${missing.length}개 · 예산 초과 ${over.length}개\n`);

if (missing.length) {
  console.log(`── 번역 누락 (${missing.length}) ──`);
  for (const k of missing.slice(0, 30)) console.log(`  ${k}`);
  if (missing.length > 30) console.log(`  … 외 ${missing.length - 30}개`);
  console.log('');
}

if (over.length) {
  console.log('── 예산 초과 (넘친 폭이 큰 순) ──');
  for (const o of over.slice(0, 40)) {
    console.log(`\n  [${o.kind}] ${o.key}`);
    console.log(`    ${base}: ${JSON.stringify(o.bv).slice(0, 90)}  (폭 ${o.bw})`);
    console.log(`    ${target}: ${JSON.stringify(o.tv).slice(0, 90)}  (폭 ${o.tw} / 허용 ${o.allowed})`);
  }
  if (over.length > 40) console.log(`\n  … 외 ${over.length - 40}개`);
}

if (!missing.length && !over.length) console.log('문제 없음');
process.exit(over.length || missing.length ? 1 : 0);
