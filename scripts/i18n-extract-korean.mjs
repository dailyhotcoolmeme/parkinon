#!/usr/bin/env node
/**
 * 한글 전수 추출 — 거르지 않는다.
 *
 * 규칙 R1: 기본값은 "전부 번역한다". 무엇을 뺄지는 내가 정하지 않는다.
 * 그래서 이 스크립트에는 "화면에 안 나갈 것 같다" 류의 판단이 한 줄도 없다.
 * 위치(파일:줄)와 사실(문자열인지 주석인지)만 기록한다.
 *
 *   node scripts/i18n-extract-korean.mjs > docs/i18n_extract_raw.md
 */
import fs from 'node:fs';
import path from 'node:path';

const HANGUL = /[가-힣]/;

const TARGETS = [
  { name: '앱 코드',  root: '/Users/ourmine/dev/parkinon-app/src',                 ext: /\.(ts|tsx)$/, skipDir: ['locales'] },
  { name: '서버',     root: '/Users/ourmine/dev/parkinon-app/supabase/functions',  ext: /\.ts$/,       skipDir: [] },
  { name: '웹',       root: '/Users/ourmine/dev/parkinon-web/src',                 ext: /\.(ts|tsx|css)$/, skipDir: [] },
  { name: '웹 정적',  root: '/Users/ourmine/dev/parkinon-web/public',              ext: /\.(html|txt)$/,   skipDir: [] },
];

function walk(dir, ext, skipDir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (skipDir.includes(e.name) || e.name === 'node_modules' || e.name === 'dist') continue;
      walk(p, ext, skipDir, out);
    } else if (ext.test(e.name)) out.push(p);
  }
  return out;
}

const rows = [];
for (const t of TARGETS) {
  for (const f of walk(t.root, t.ext, t.skipDir)) {
    const lines = fs.readFileSync(f, 'utf8').split('\n');
    let inBlock = false;
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const opens = /\/\*/.test(raw), closes = /\*\//.test(raw);
      const wasBlock = inBlock || opens;
      if (opens) inBlock = true;
      if (closes) inBlock = false;
      if (!HANGUL.test(raw)) continue;
      const isComment = wasBlock || /^\s*(\/\/|\*|#|<!--)/.test(raw);
      rows.push({
        area: t.name,
        file: path.relative('/Users/ourmine/dev', f),
        line: i + 1,
        kind: isComment ? '주석' : '코드',
        text: raw.trim().slice(0, 160),
      });
    }
  }
}

const byArea = {};
for (const r of rows) {
  byArea[r.area] ??= { 코드: 0, 주석: 0 };
  byArea[r.area][r.kind] += 1;
}

console.log('# 한글 전수 추출 (거르기 전 원본)\n');
console.log(`추출 시각 기준 총 **${rows.length}줄**\n`);
console.log('| 영역 | 코드 | 주석 | 합계 |');
console.log('|---|---:|---:|---:|');
let tc = 0, tm = 0;
for (const [a, v] of Object.entries(byArea)) {
  console.log(`| ${a} | ${v.코드} | ${v.주석} | ${v.코드 + v.주석} |`);
  tc += v.코드; tm += v.주석;
}
console.log(`| **합계** | **${tc}** | **${tm}** | **${tc + tm}** |`);

console.log('\n---\n\n## 전체 목록 (코드)\n');
console.log('| 영역 | 파일:줄 | 내용 |');
console.log('|---|---|---|');
for (const r of rows.filter(r => r.kind === '코드'))
  console.log(`| ${r.area} | ${r.file}:${r.line} | \`${r.text.replace(/\|/g, '\\|')}\` |`);

console.log('\n## 전체 목록 (주석)\n');
console.log('| 영역 | 파일:줄 | 내용 |');
console.log('|---|---|---|');
for (const r of rows.filter(r => r.kind === '주석'))
  console.log(`| ${r.area} | ${r.file}:${r.line} | \`${r.text.replace(/\|/g, '\\|')}\` |`);
