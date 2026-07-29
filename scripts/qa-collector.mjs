#!/usr/bin/env node
/**
 * 번역 검수 수집기 — 시뮬레이터/기기의 앱이 보내는 렌더 이벤트를 받아 파일로 쌓는다.
 *
 *   node scripts/qa-collector.mjs fr        # 시작 (기록: .qa/fr.jsonl)
 *
 * 앱(src/i18n/qaProbe.ts)이 POST /ev 로 배치를 보낸다. 이 스크립트는 판정하지 않는다 —
 * 판정은 scripts/qa-report.mjs 가 한다. 수집과 판정을 나눠야 매칭 규칙을 고칠 때
 * 앱을 다시 빌드하지 않는다.
 */
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const LANG = process.argv[2] || 'fr';
const OUT_DIR = path.join(ROOT, '.qa');
fs.mkdirSync(OUT_DIR, { recursive: true });
const OUT = path.join(OUT_DIR, `${LANG}.jsonl`);

let count = 0;
const server = http.createServer((req, res) => {
  if (req.method === 'POST' && req.url === '/ev') {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      try {
        const events = JSON.parse(body);
        const lines = events.map((e) => JSON.stringify(e)).join('\n') + '\n';
        fs.appendFileSync(OUT, lines);
        count += events.length;
        const marks = events.filter((e) => e.type === 'mark');
        for (const m of marks) process.stdout.write(`\n── ${m.text}\n`);
        process.stdout.write(`\r수집 ${count}건  (${OUT})   `);
      } catch { /* 깨진 배치는 버린다 */ }
      res.writeHead(204).end();
    });
    return;
  }
  if (req.method === 'POST' && req.url === '/reset') {
    fs.writeFileSync(OUT, '');
    count = 0;
    process.stdout.write(`\n초기화됨\n`);
    res.writeHead(204).end();
    return;
  }
  res.writeHead(404).end();
});

server.listen(8799, () => {
  console.log(`검수 수집기 시작 — 언어 ${LANG}, 기록 ${OUT}`);
  console.log('앱을 해당 언어로 실행하고 화면을 돌아다니면 쌓입니다. 중지: Ctrl-C');
});
