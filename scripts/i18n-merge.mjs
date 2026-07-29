#!/usr/bin/env node
/**
 * 번역 조각을 언어 파일에 병합한다.
 *
 * 1,881개 키를 한 번에 쓰면 실수 하나로 파일 전체가 깨진다. 네임스페이스 단위로
 * 조각을 만들어 이 스크립트로 합치면, 각 단계마다 JSON 유효성이 보장되고
 * 중간에 검사기를 돌려볼 수 있다.
 *
 *   node scripts/i18n-merge.mjs fr /tmp/part.json
 *
 * 같은 키가 이미 있으면 조각 값으로 덮어쓴다(재작업 가능).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const [lang, partPath] = process.argv.slice(2);
if (!lang || !partPath) {
  console.error('사용법: node scripts/i18n-merge.mjs <언어> <조각파일.json>');
  process.exit(1);
}

const target = path.join(ROOT, 'src/i18n/locales', `${lang}.json`);
const base = fs.existsSync(target) ? JSON.parse(fs.readFileSync(target, 'utf8')) : {};
const part = JSON.parse(fs.readFileSync(partPath, 'utf8'));

const deepMerge = (dst, src) => {
  for (const [k, v] of Object.entries(src)) {
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      dst[k] = deepMerge(dst[k] && typeof dst[k] === 'object' ? dst[k] : {}, v);
    } else dst[k] = v;
  }
  return dst;
};

const merged = deepMerge(base, part);

// 키 순서를 원본(ko)과 맞춰 diff 를 읽기 쉽게 유지한다.
const ko = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/i18n/locales/ko.json'), 'utf8'));
const ordered = (model, obj) => {
  if (!model || typeof model !== 'object' || Array.isArray(model)) return obj;
  const out = {};
  for (const k of Object.keys(model)) if (k in obj) out[k] = ordered(model[k], obj[k]);
  for (const k of Object.keys(obj)) if (!(k in out)) out[k] = obj[k];
  return out;
};

fs.writeFileSync(target, JSON.stringify(ordered(ko, merged), null, 2) + '\n', 'utf8');

const count = (o) => Object.values(o).reduce((n, v) => n + (v && typeof v === 'object' ? count(v) : 1), 0);
console.log(`${lang}.json — 총 ${count(merged)}개 키 (원본 ${count(ko)}개)`);
