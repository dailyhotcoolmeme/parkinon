#!/usr/bin/env node
/**
 * 번역 완성도 검사 — 배포 전 게이트.
 *
 * 막으려는 사고:
 *   1) 번역 누락  → fallbackLng='en' 이 받아주지만, 영어가 섞여 나오는 건 품질 문제다.
 *   2) 키 자체 없음 → 화면에 'medication.title' 같은 개발자 문자열이 그대로 노출된다.
 *   3) 번역 파일에 한글 잔존 → 해외 사용자에게 한글이 보인다. 가장 치명적.
 *   4) 치환 변수 불일치 → {{name}} 이 빠지면 문장이 깨지거나 값이 안 나온다.
 *
 * 실행:
 *   node scripts/i18n-check.mjs            (모든 언어)
 *   node scripts/i18n-check.mjs fr ja      (지정 언어만)
 *
 * 하나라도 걸리면 종료코드 1 — 배포 스크립트에서 그대로 게이트로 쓸 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/i18n/locales');
const BASE = 'ko'; // 키의 원본(가장 완전한 파일)
const HANGUL = /[가-힣]/;
const VAR = /\{\{\s*([\w.]+)\s*\}\}/g;

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

const langs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

const baseMap = flatten(JSON.parse(fs.readFileSync(path.join(DIR, `${BASE}.json`), 'utf8')));
const baseKeys = Object.keys(baseMap);

let failed = false;

for (const lang of langs) {
  if (lang === BASE) continue;
  const file = path.join(DIR, `${lang}.json`);
  if (!fs.existsSync(file)) {
    console.log(`\n${lang}: 파일 없음 — 건너뜀`);
    continue;
  }
  const map = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));

  const missing = baseKeys.filter((k) => map[k] == null || map[k] === '');
  const extra = Object.keys(map).filter((k) => baseMap[k] == null);
  const hangul = Object.entries(map).filter(
    ([, v]) => typeof v === 'string' && HANGUL.test(v),
  );
  const varMismatch = [];
  for (const k of baseKeys) {
    const bv = baseMap[k];
    const tv = map[k];
    if (typeof bv !== 'string' || typeof tv !== 'string') continue;
    // 복수형 단수 변형(_one)은 "1"을 문장에 직접 쓰는 게 자연스럽다.
    //   ko "{{count}}일 남음" → en "1 day left"
    // {{count}} 가 빠져도 정상이므로 검사에서 제외한다.
    if (/_one$/.test(k)) continue;
    const bs = new Set([...bv.matchAll(VAR)].map((m) => m[1]));
    const ts = new Set([...tv.matchAll(VAR)].map((m) => m[1]));
    const lost = [...bs].filter((x) => !ts.has(x));
    const added = [...ts].filter((x) => !bs.has(x));
    if (lost.length || added.length) varMismatch.push({ k, lost, added, bv, tv });
  }

  const ok = !missing.length && !hangul.length && !varMismatch.length;
  console.log(`\n═══ ${lang} ═══  키 ${Object.keys(map).length}/${baseKeys.length}  ${ok ? '✅ 통과' : '❌ 실패'}`);

  if (missing.length) {
    failed = true;
    console.log(`\n  ❌ 번역 누락 ${missing.length}건 (영어로 폴백되지만 품질 문제)`);
    for (const k of missing.slice(0, 25)) console.log(`      ${k}`);
    if (missing.length > 25) console.log(`      … 외 ${missing.length - 25}개`);
  }
  if (hangul.length) {
    failed = true;
    console.log(`\n  ❌ 한글 잔존 ${hangul.length}건 — 해외 사용자에게 한글 노출됨`);
    for (const [k, v] of hangul.slice(0, 25)) console.log(`      ${k}: ${JSON.stringify(String(v).slice(0, 60))}`);
    if (hangul.length > 25) console.log(`      … 외 ${hangul.length - 25}개`);
  }
  if (varMismatch.length) {
    failed = true;
    console.log(`\n  ❌ 치환 변수 불일치 ${varMismatch.length}건 — 값이 안 나오거나 문장이 깨짐`);
    for (const m of varMismatch.slice(0, 15)) {
      console.log(`      ${m.k}  빠짐:[${m.lost}] 추가됨:[${m.added}]`);
      console.log(`        ${BASE}: ${JSON.stringify(m.bv.slice(0, 60))}`);
      console.log(`        ${lang}: ${JSON.stringify(m.tv.slice(0, 60))}`);
    }
  }
  if (extra.length) {
    console.log(`\n  ⚠️ 원본에 없는 키 ${extra.length}건 (오타 가능성, 실패 처리는 안 함)`);
    for (const k of extra.slice(0, 10)) console.log(`      ${k}`);
  }
}

console.log('');
process.exit(failed ? 1 : 0);
