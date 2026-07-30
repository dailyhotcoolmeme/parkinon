#!/usr/bin/env node
/**
 * 문구 대장 — 번역 키 하나하나가 "어느 화면 어느 자리에 나오는지" 정리한다.
 *
 *   node scripts/qa-strings-gen.mjs        → qa/strings.json + 요약
 *   node scripts/qa-strings-gen.mjs --key doseSlots.nextDoseLegacy
 *
 * 왜 문구 단위인가(2026-07-30 오너 지시):
 *   화면·행위 단위 대장(qa/cases.json)은 "어디를 들어가 봤나"만 센다.
 *   지시받은 건 "이 문구가 화면에서 어떻게 나오나" — 그러려면 문구가 기준이어야 한다.
 *   ①에서 한글을 다 찾아 번역했으니(대장 qa/ledger.json 전부 0), 이제 그 번역 키
 *   2,067개 각각의 호출 지점과 화면 안 자리(버튼/제목/팝업/본문)를 매긴다.
 *   이 결과가 ④(실기기 레이아웃 검수)에서 "무엇을 봐야 하는지"의 목록이 된다.
 *
 * 한계(정직하게):
 *   - 정적으로 못 찾는 동적 키(`t(\`slot.${key}\`)`)는 "동적" 표시만 하고
 *     실제 화면 위치는 실기기 순회 로그로 채운다(qa/cases.json 과 연동).
 *   - 호출 지점이 없는 키(orphan)는 화면에 나올 수 없다는 뜻 — 별도 조사 대상.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const WEB_ROOT = path.resolve(ROOT, '../parkinon-web');
const OUT = path.join(ROOT, 'qa/strings.json');

const args = process.argv.slice(2);
const ONLY_KEY = args.includes('--key') ? args[args.indexOf('--key') + 1] : null;

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

const APP_LANGS = ['ko', 'en', 'fr', 'ja'];
const appDicts = Object.fromEntries(APP_LANGS.map((l) => [l,
  flatten(JSON.parse(fs.readFileSync(path.join(ROOT, `src/i18n/locales/${l}.json`), 'utf8')))]));
const keys = Object.keys(appDicts.ko);

const walk = (dir, exts, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (/node_modules|\.git|\.expo|\.qa/.test(p)) continue;
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};

const zones = [
  { where: 'app', root: path.join(ROOT, 'src'), exts: ['.ts', '.tsx'] },
  { where: 'server', root: path.join(ROOT, 'supabase/functions'), exts: ['.ts'] },
  { where: 'web', root: path.join(WEB_ROOT, 'src'), exts: ['.ts', '.tsx'] },
];

/**
 * 문구가 어떤 UI 요소로 나오는지 판정한다. 폭이 제한되는 자리(버튼·타이틀·한 줄 라벨)와
 * 자유롭게 줄바꿈되는 자리(본문·팝업 메시지)를 가르는 게 목적이다 — 실기기에서
 * 무엇을 봐야 하는지가 여기서 갈린다.
 */
function classifySurface(line, prevLine, nextLine, propName) {
  const ctx = `${prevLine}\n${line}\n${nextLine}`;
  if (propName === 'title') return /dialog\.(alert|confirm)/.test(ctx) ? 'popup.title' : 'header.title';
  if (propName === 'message') return 'popup.message';
  if (propName === 'confirmText' || propName === 'cancelText') return 'popup.button';
  if (propName === 'placeholder') return 'input.placeholder';
  if (propName === 'label') return 'label';
  if (propName === 'body' || propName === 'subtitle') return 'body';

  const style = ctx.match(/style=\{(?:\[)?[^}]*?styles\.(\w+)/)?.[1] ?? '';
  const oneLine = /numberOfLines=\{1\}/.test(ctx);
  if (/btn|button|cta|action/i.test(style)) return `button(${style})`;
  if (/title|header|headline|heading/i.test(style)) return `title(${style})`;
  if (/tab|chip|badge|pill/i.test(style)) return `chip(${style})`;
  if (style) return oneLine ? `text1line(${style})` : `text(${style})`;
  if (/console\.(log|warn|error)/.test(ctx)) return 'log(non-user)';
  return 'unknown';
}

const CONSTRAINED_SURFACES = /^(popup\.title|popup\.button|header\.title|label|button\(|title\(|chip\(|text1line\(|input\.placeholder)/;

/** 파일에서 t()/i18n.t() 호출 지점을 찾는다. 문자열 키만(동적 템플릿은 별도 집계). */
function scanFile(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const staticHits = [];
  const dynamicHits = [];
  // t( 또는 i18n.t( 앞에 글자/점이 오면 다른 함수(예: .select(`...`))이므로 제외한다.
  const CALL = /(?<![\w.])(?:i18n\.)?t\(\s*/g;
  lines.forEach((line, i) => {
    for (const m of line.matchAll(CALL)) {
      const rest = line.slice(m.index + m[0].length);
      const strMatch = rest.match(/^(['"])((?:\\.|(?!\1).)*)\1/);
      if (strMatch) {
        const propMatch = line.slice(0, m.index).match(/(\w+)\s*[:=]\s*\{?\s*$/);
        staticHits.push({ line: i + 1, key: strMatch[2], prop: propMatch?.[1] });
        continue;
      }
      const tplMatch = rest.match(/^`([^`]*)`/);
      if (tplMatch && tplMatch[1].includes('${')) {
        dynamicHits.push({ line: i + 1, template: tplMatch[1] });
      }
    }
  });
  return { staticHits, dynamicHits, lines };
}

const screenOf = (rel) => path.basename(rel).replace(/\.(tsx?|ts)$/, '');

const byKey = new Map(keys.map((k) => [k, []]));
const dynamicTemplates = [];
for (const z of zones) {
  for (const file of walk(z.root, z.exts)) {
    const rel = path.relative(z.where === 'web' ? WEB_ROOT : ROOT, file);
    const { staticHits, dynamicHits, lines } = scanFile(file);
    for (const h of staticHits) {
      if (!byKey.has(h.key)) continue; // 앱 키 목록에 없으면 웹/서버 자체 키(별도 관리)
      const surface = classifySurface(lines[h.line - 1] ?? '', lines[h.line - 2] ?? '', lines[h.line] ?? '', h.prop);
      byKey.get(h.key).push({ zone: z.where, file: rel, line: h.line, screen: screenOf(rel), surface });
    }
    for (const h of dynamicHits) {
      dynamicTemplates.push({ zone: z.where, file: rel, line: h.line, screen: screenOf(rel), template: h.template });
    }
    // 넓은 그물 — t() 호출에 바로 안 붙어도(예: `const key = \`serverError.${code}\`;` 후
    // 몇 줄 뒤 i18n.t(key)) 번역 키처럼 생긴 템플릿(단어.단어...${...})은 전부 후보로 잡는다.
    // URL 템플릿(`${SUPABASE_URL}/...`)은 시작이 ${ 라 이 패턴에 안 걸려 자연히 제외된다.
    const WIDE = /`([a-zA-Z][a-zA-Z0-9_]*(?:\.[a-zA-Z][a-zA-Z0-9_]*)*\.\$\{[^}]+\}[^`]*)`/g;
    lines.forEach((line, i) => {
      for (const m of line.matchAll(WIDE)) {
        dynamicTemplates.push({ zone: z.where, file: rel, line: i + 1, screen: screenOf(rel), template: m[1] });
      }
    });
  }
}
// 중복 제거(같은 템플릿이 CALL 스캔과 WIDE 스캔 양쪽에 잡힐 수 있다)
{
  const seen = new Set();
  for (let i = dynamicTemplates.length - 1; i >= 0; i--) {
    const k = `${dynamicTemplates[i].file}:${dynamicTemplates[i].line}:${dynamicTemplates[i].template}`;
    if (seen.has(k)) dynamicTemplates.splice(i, 1); else seen.add(k);
  }
}

/**
 * 2차 통과 — 아직 호출 지점이 없는 키(orphan)를 구제한다.
 * `t(item.labelKey)` 처럼 변수를 거쳐 쓰이는 키는 1차 스캔(t('literal') 형태)에
 * 안 걸린다. 대신 그 키 문자열이 `labelKey: 'caregiverInfo.relationSpouse'` 같은
 * 데이터 선언부에 그대로 적혀 있으므로, 그 선언 지점을 "간접 참조"로 기록한다.
 * 이렇게도 못 찾으면 진짜 고아 — 화면에 나올 수 없는 키다.
 */
const allFiles = zones.flatMap((z) => walk(z.root, z.exts).map((f) => ({ f, where: z.where })));
const fileTextCache = new Map();
function readCached(f) {
  if (!fileTextCache.has(f)) fileTextCache.set(f, fs.readFileSync(f, 'utf8'));
  return fileTextCache.get(f);
}
for (const key of keys) {
  if (byKey.get(key).length) continue;
  for (const { f, where } of allFiles) {
    const text = readCached(f);
    const idx = text.indexOf(`'${key}'`) !== -1 ? text.indexOf(`'${key}'`) : text.indexOf(`"${key}"`);
    if (idx === -1) continue;
    const line = text.slice(0, idx).split('\n').length;
    const rel = path.relative(where === 'web' ? WEB_ROOT : ROOT, f);
    byKey.get(key).push({ zone: where, file: rel, line, screen: screenOf(rel), surface: 'indirect-ref' });
    break; // 첫 선언 지점만 — 이 키가 죽은 코드가 아님을 확인하면 충분하다.
  }
}

/**
 * 3차 통과 — 동적 템플릿(`t(\`slot.${key}\`)`)이 만들 수 있는 실제 키를 매칭한다.
 * `${...}` 자리는 보통 한 단어짜리 값(morning, slide1 등)이라 `[^.]+` 로 근사하고,
 * 남은 orphan 키 중 그 패턴에 맞는 것을 이 호출 지점의 "동적 매칭"으로 잡아준다.
 * 여러 템플릿이 겹치면 전부 후보로 남긴다(과잉 판정 방지 — 실기기 로그가 최종 확정).
 */
for (const t of dynamicTemplates) {
  // 리터럴 조각만 이스케이프하고 ${...} 자리만 와일드카드로 — 먼저 분해 후 처리해야
  // 이스케이프가 ${ }  자체를 망가뜨리지 않는다(처음 구현에서 이 순서가 뒤바뀌어 매칭이 전부 실패했다).
  // 변수 자리는 '.'을 포함할 수 있다(예: key='meal.breakfast') — [^.]+ 로 제한하면
  // 'healthExport.meal.breakfast' 를 못 잡는다. '.+' 로 넉넉히 잡는다.
  const pattern = '^' + t.template
    .split(/\$\{[^}]+\}/)
    .map((part) => part.replace(/[.*+?^$()|[\]\\]/g, '\\$&'))
    .join('.+') + '$';
  let re;
  try { re = new RegExp(pattern); } catch { continue; }
  for (const key of keys) {
    if (byKey.get(key).length) continue;
    if (!re.test(key)) continue;
    byKey.get(key).push({
      zone: t.zone, file: t.file, line: t.line, screen: t.screen,
      surface: 'dynamic-match', template: t.template,
    });
  }
}

/**
 * 4차 통과 — i18next 복수형 키. `t('medManage.recordsCount', { count: n })` 호출은
 * 소스에 'medManage.recordsCount' 로만 적혀 있고, i18next 가 런타임에 count 값을 보고
 * _one/_other 접미사를 자동으로 붙인다. 접미사 뺀 기본 키의 호출 지점을 그대로 물려준다.
 */
for (const key of keys) {
  if (byKey.get(key).length) continue;
  const m = key.match(/^(.*)_(one|other|zero|two|few|many)$/);
  if (!m) continue;
  const base = byKey.get(m[1]);
  if (base && base.length) {
    byKey.set(key, base.map((s) => ({ ...s, surface: s.surface, note: 'plural-suffix' })));
  }
}

const entries = keys.map((key) => {
  const sites = byKey.get(key);
  const constrained = sites.filter((s) => CONSTRAINED_SURFACES.test(s.surface));
  return {
    key,
    ko: appDicts.ko[key],
    en: appDicts.en[key] ?? null,
    fr: appDicts.fr[key] ?? null,
    ja: appDicts.ja[key] ?? null,
    sites,
    siteCount: sites.length,
    layoutRisk: constrained.length > 0,
    orphan: sites.length === 0,
  };
});

/**
 * 화면에 아직 안 붙었지만 죽은 키가 아닌 것 — 나중에 쓰기로 하고 미리 준비해 둔 키.
 * (예: pkNote.* — 약 주의사항 화면을 아직 안 만들어서 노출 경로가 없다.
 *  462c5b0 커밋에 "노출 경로는 없지만 데이터에 한글만 있으면 언젠가 샌다"고 명시.)
 * 고아 목록에서는 빼되, 지우지는 않는다(오너 확정 2026-07-30).
 */
const DEFERRED_PREFIXES = ['pkNote.'];
for (const e of entries) {
  if (e.orphan && DEFERRED_PREFIXES.some((p) => e.key.startsWith(p))) e.deferred = true;
}
const orphans = entries.filter((e) => e.orphan && !e.deferred);
const layoutRisk = entries.filter((e) => e.layoutRisk);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedFrom: 'scripts/qa-strings-gen.mjs',
  counts: {
    keys: entries.length,
    withSites: entries.length - orphans.length,
    orphan: orphans.length,
    layoutRisk: layoutRisk.length,
    dynamicTemplates: dynamicTemplates.length,
  },
  entries,
  dynamicTemplates,
}, null, 2) + '\n');

console.log(`═══ 문구 대장 ═══`);
console.log(`번역 키 ${entries.length}개 → ${path.relative(ROOT, OUT)}`);
console.log(`  호출 지점 있음      ${entries.length - orphans.length}`);
console.log(`  호출 지점 없음(고아) ${orphans.length}`);
console.log(`  폭 제한 자리(실기기 대상) ${layoutRisk.length}`);
console.log(`  동적 키 템플릿      ${dynamicTemplates.length}건 (별도 목록)`);

if (ONLY_KEY) {
  const e = entries.find((x) => x.key === ONLY_KEY);
  if (!e) console.log(`\n키를 찾지 못함: ${ONLY_KEY}`);
  else {
    console.log(`\n── ${ONLY_KEY}`);
    console.log(`  ko: ${JSON.stringify(e.ko)}`);
    console.log(`  en: ${JSON.stringify(e.en)}`);
    console.log(`  fr: ${JSON.stringify(e.fr)}`);
    console.log(`  ja: ${JSON.stringify(e.ja)}`);
    for (const s of e.sites) console.log(`  [${s.zone}] ${s.file}:${s.line}  화면=${s.screen}  자리=${s.surface}`);
    if (!e.sites.length) console.log('  (호출 지점 없음 — 고아 키)');
  }
} else if (orphans.length) {
  console.log(`\n── 고아 키 (앞 20개)`);
  for (const e of orphans.slice(0, 20)) console.log(`  ${e.key}  ${JSON.stringify(e.ko).slice(0, 40)}`);
}
