#!/usr/bin/env node
/**
 * 좁은 UI 자리에 문구가 실제로 들어가는지 검사 — 폰트를 줄이지 않기 위한 게이트.
 *
 * 왜 별도 스크립트인가:
 *   i18n-length-audit 은 키 이름으로 "좁아 보이는 것"을 추정해 200건씩 뱉는다(휴리스틱).
 *   그중 진짜 깨지는 건 numberOfLines={1} + 고정폭인 자리뿐이다. 여기서는 그 자리들을
 *   코드에서 실측한 가용 폭(pt)과 폰트로 못박아 두고, 근사 글자폭으로 넘치는지만 본다.
 *   새 언어를 넣을 때 "어디가 위험한지" 다시 재지 않아도 된다.
 *
 * 실행:
 *   node scripts/i18n-fit-check.mjs            (모든 언어)
 *   node scripts/i18n-fit-check.mjs fr ja
 *
 * 넘치면 종료코드 1.
 *
 * ⚠️ 폰트를 줄여 맞추지 말 것(60대 타겟 가독성). 문구를 짧게 잡는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DIR = path.join(ROOT, 'src/i18n/locales');

/**
 * 실측한 좁은 자리들. width 는 "글자가 쓸 수 있는" 폭(pt) — 컨테이너 폭에서
 * padding·아이콘·gap 을 뺀 값이다. 기준 화면폭 390pt(iPhone 15/17 Pro).
 */
const SLOTS = [
  {
    name: '기록 기간 탭(3등분)',
    where: 'RecordsScreen / RecordDetailScreen — tabBtn, numberOfLines={1}',
    width: 78, size: 16, weight: 600,
    keys: ['records.periodWeek', 'records.periodMonth', 'records.period3Month'],
  },
  {
    name: 'TopBar 타이틀',
    where: 'components/common/TopBar.tsx — title flex:1, 좌우 고정 76pt 사이',
    width: 206, size: 20, weight: 700,
    keys: [
      'records.headerTitle', 'videoList.headerTitle', 'videoRecord.headerTitle',
      'familyLink.headerTitle', 'profileEdit.headerTitle', 'blockedUsers.headerTitle',
      'medRecordList.headerTitle', 'medRecordDetail.headerTitle',
      'medRecordWrite.headerNew', 'medRecordWrite.headerEdit',
      'appointmentWrite.headerNew', 'appointmentWrite.headerEdit',
      'alarmSound.headerTitle', 'alarmSound.headerTitleCaregiver',
      'recordSound.headerNew', 'recordSound.headerEdit',
      'notifHistory.headerTitle', 'medTimeOnboarding.headerTitle',
      'legalDocs.termsTitle', 'legalDocs.privacyTitle',
      'subscription.headerTitle', 'exercise.recordTitle', 'exercise.durationTitle',
      'settings.patientNotifManageTitle', 'settings.caregiverTitle', 'settings.patientOtherTitle',
      'menu.medsTabLabel', 'menu.doseSlotsTabLabel',
    ],
  },
  {
    name: 'TopBar 우측 액션',
    where: 'NotificationHistoryScreen — rightWide(96pt)',
    width: 96, size: 16, weight: 600,
    keys: ['notifHistory.markAllRead'],
  },
  {
    name: '하단 탭바',
    where: 'MainNavigator — adjustsFontSizeToFit minimumFontScale=0.8 로 자동 축소됨',
    width: 74, size: 12, weight: 600, autoShrink: true,
    keys: [
      'medication.brandTabLabel', 'bodystate.tabLabel', 'exercise.tabLabel',
      'menu.overseasMedTabLabel', 'menu.feedTabLabel', 'menu.myInfoTabLabel',
    ],
  },
  {
    name: '해외 약/알림 탭(2등분)',
    where: 'OverseasMedTabScreen — tab flex:1, numberOfLines={1}',
    width: 179, size: 17, weight: 700,
    keys: ['menu.doseSlotsTabLabel', 'menu.medsTabLabel'],
  },
];

/** 근사 글자폭(폰트크기 대비 배율). SF Pro 기준 대략치 — 정밀 측정이 아니라 조기경보용. */
function charRatio(ch) {
  const c = ch.codePointAt(0);
  // 한중일·한글 전각
  if ((c >= 0x2e80 && c <= 0xa4cf) || (c >= 0xac00 && c <= 0xd7a3) ||
      (c >= 0xff00 && c <= 0xff60) || (c >= 0x3000 && c <= 0x303f)) return 1.0;
  if (' '.includes(ch)) return 0.26;
  if ("iljItf.,;:'!|·".includes(ch)) return 0.30;
  if ('mwMW'.includes(ch)) return 0.85;
  if ('—–…'.includes(ch)) return 0.9;
  if (/[0-9]/.test(ch)) return 0.56;
  if (/[A-ZÀ-Þ]/.test(ch)) return 0.64;
  return 0.53;
}

function textWidth(s, size, weight) {
  const bold = weight >= 600 ? 1.03 : 1;
  let w = 0;
  for (const ch of String(s)) w += charRatio(ch) * size;
  return w * bold;
}

const langs = process.argv.slice(2).length
  ? process.argv.slice(2)
  : fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.replace('.json', ''));

const flatten = (obj, prefix = '', out = {}) => {
  for (const [k, v] of Object.entries(obj)) {
    const key = prefix ? `${prefix}.${k}` : k;
    if (v && typeof v === 'object' && !Array.isArray(v)) flatten(v, key, out);
    else out[key] = v;
  }
  return out;
};

/**
 * 기존부터 넘쳐 있던 자리 — 고치지 않는다.
 *   한국어: 국내 문구는 손대지 않는다(오너 확정).
 *   영어  : "영어는 그냥 냅두자"(오너 확정). 새 언어의 기준선일 뿐이다.
 * 새 언어가 여기 오르는 일은 없어야 한다 — 그게 이 게이트의 존재 이유다.
 */
const KNOWN_PREEXISTING = new Set([
  'ko|records.period3Month',
  'ko|alarmSound.headerTitleCaregiver',
  'ko|settings.patientNotifManageTitle',
  'en|records.periodMonth',
  'en|alarmSound.headerTitleCaregiver',
  'en|medTimeOnboarding.headerTitle',
  'en|settings.patientNotifManageTitle',
  'en|settings.caregiverTitle',
  'en|notifHistory.markAllRead',
]);

let failed = false;
for (const lang of langs) {
  const file = path.join(DIR, `${lang}.json`);
  if (!fs.existsSync(file)) continue;
  const map = flatten(JSON.parse(fs.readFileSync(file, 'utf8')));
  const over = [];
  let checked = 0;
  for (const slot of SLOTS) {
    for (const key of slot.keys) {
      const v = map[key];
      if (typeof v !== 'string') continue;
      checked += 1;
      const w = textWidth(v, slot.size, slot.weight);
      if (w <= slot.width) continue;
      // 자동 축소되는 자리와 기존부터 넘쳐 있던 문구는 경고만 하고 실패시키지 않는다.
      const waived = slot.autoShrink ? '자동 축소' :
        (KNOWN_PREEXISTING.has(`${lang}|${key}`) ? '기존 상태(유지)' : null);
      over.push({ slot, key, v, w, waived });
    }
  }
  const real = over.filter((o) => !o.waived);
  console.log(`\n═══ ${lang} ═══  검사 ${checked}개  ${real.length ? '❌ 넘침 ' + real.length + '건' : '✅ 통과'}` +
    (over.length - real.length ? `  (경고 ${over.length - real.length}건)` : ''));
  for (const o of over) {
    if (!o.waived) failed = true;
    console.log(`  ${o.waived ? '⚠️ ' + o.waived : '❌'} [${o.slot.name}] ${o.key}`);
    console.log(`     ${JSON.stringify(o.v)}  ≈${o.w.toFixed(0)}pt / 가용 ${o.slot.width}pt`);
    console.log(`     ${o.slot.where}`);
  }
}
console.log('');
process.exit(failed ? 1 : 0);
