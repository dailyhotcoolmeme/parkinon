#!/usr/bin/env node
/**
 * 번역 검수 실행기 — 시뮬레이터를 해당 언어로 세팅하고, 로그인 상태로 띄우고, 화면을 순회시킨다.
 *
 *   node scripts/qa-run.mjs fr          # 프랑스어로 준비 + 자동 순회
 *   node scripts/qa-run.mjs ja --no-walk
 *
 * 새 언어를 검수할 때 사람이 손으로 할 일이 없도록 여기에 다 모아뒀다.
 * 전제: 시뮬레이터에 개발 빌드가 설치돼 있고(npx expo run:ios), metro 가 떠 있을 것.
 *
 * 여기서 하는 일:
 *   1. 시뮬레이터 시스템 언어를 바꾼다
 *   2. 빌드 산출물의 EXUpdatesEnabled 를 끈다
 *      — 안 끄면 개발 빌드가 배포된 OTA 번들을 받아 실행해서 로컬 코드가 반영되지 않는다.
 *        (2026-07-30 에 여기서 한 시간을 날렸다.)
 *   3. 검수 계정 세션을 AsyncStorage 에 직접 넣는다(카카오/구글 로그인 화면을 건너뛴다)
 *   4. 알림 권한 게이트를 통과 상태로 만든다(시스템 권한 팝업이 순회를 막지 않도록)
 *   5. 자동 순회 플래그를 켜고 앱을 실행한다
 */
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const LANG = process.argv[2] || 'fr';
const NO_WALK = process.argv.includes('--no-walk');
const BUNDLE_ID = 'com.ourmine.parkinon';
const PROJECT_REF = 'avqaflxufyadgzjiojkk';

/** 언어별 검수 계정. 새 언어를 추가하면 여기 한 줄 늘린다. */
const ACCOUNTS = {
  fr: { email: 'i18n-qa+fr@ourmine.co.kr', locale: 'fr_FR', langs: ['fr-FR', 'en-US'] },
  // 보호자 전용 문구(알림 설정·대신 입력 안내 등)는 환자 계정으로는 절대 렌더되지 않는다.
  // 언어마다 환자 1회 + 보호자 1회를 돌려야 커버리지가 채워진다.
  'fr-cg': { email: 'i18n-qa+frc@ourmine.co.kr', locale: 'fr_FR', langs: ['fr-FR', 'en-US'] },
  'ja-cg': { email: 'i18n-qa+jac@ourmine.co.kr', locale: 'ja_JP', langs: ['ja-JP', 'en-US'] },
  ja: { email: 'i18n-qa+ja@ourmine.co.kr', locale: 'ja_JP', langs: ['ja-JP', 'en-US'] },
  en: { email: 'i18n-qa+en@ourmine.co.kr', locale: 'en_US', langs: ['en-US'] },
};

const sh = (cmd) => execSync(cmd, { encoding: 'utf8' }).trim();
const acct = ACCOUNTS[LANG];
if (!acct) {
  console.error(`검수 계정이 없는 언어입니다: ${LANG}\nscripts/qa-run.mjs 의 ACCOUNTS 에 추가하세요.`);
  process.exit(2);
}

const password = process.env.QA_PASSWORD;
const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY
  || fs.readFileSync(path.join(process.cwd(), '.env'), 'utf8')
    .split('\n').find((l) => l.startsWith('EXPO_PUBLIC_SUPABASE_ANON_KEY='))?.split('=').slice(1).join('=').trim();
if (!password) {
  console.error('검수 계정 비밀번호가 필요합니다: QA_PASSWORD=... node scripts/qa-run.mjs fr');
  process.exit(2);
}

console.log(`[1/5] 시뮬레이터 언어 → ${LANG}`);
sh(`xcrun simctl spawn booted defaults write .GlobalPreferences AppleLanguages -array ${acct.langs.map((l) => `"${l}"`).join(' ')}`);
sh(`xcrun simctl spawn booted defaults write .GlobalPreferences AppleLocale -string "${acct.locale}"`);

console.log('[2/5] 개발 빌드의 OTA 수신 끄기(로컬 코드가 반영되도록)');
try { sh(`xcrun simctl terminate booted ${BUNDLE_ID}`); } catch { /* 안 떠 있으면 무시 */ }
const appDir = sh(`xcrun simctl get_app_container booted ${BUNDLE_ID} app`);
sh(`plutil -replace EXUpdatesEnabled -bool NO "${appDir}/Expo.plist"`);

console.log('[3/5] 검수 계정 세션 발급');
const res = await fetch(`https://${PROJECT_REF}.supabase.co/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { apikey: anon, 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: acct.email, password }),
});
const session = await res.json();
if (!session.access_token) {
  console.error('세션 발급 실패:', session);
  process.exit(1);
}
session.expires_at = Math.floor(Date.now() / 1000) + (session.expires_in ?? 3600);

console.log('[4/5] AsyncStorage 주입(로그인·알림게이트·순회플래그)');
const dataDir = sh(`xcrun simctl get_app_container booted ${BUNDLE_ID} data`);
// AsyncStorage 는 Documents 가 아니라 Application Support/<bundleId> 를 쓴다.
const storeDir = path.join(dataDir, 'Library', 'Application Support', BUNDLE_ID, 'RCTAsyncLocalStorage_V1');
fs.mkdirSync(storeDir, { recursive: true });
const manifestPath = path.join(storeDir, 'manifest.json');
const manifest = fs.existsSync(manifestPath) ? JSON.parse(fs.readFileSync(manifestPath, 'utf8')) : {};
const entries = [
  [`sb-${PROJECT_REF}-auth-token`, JSON.stringify(session)],
  // iOS 알림 권한 게이트를 통과 상태로. 안 하면 시스템 권한 팝업이 순회를 막는다.
  ['notif_gate_skipped_ios', '1'],
];
if (!NO_WALK) entries.push(['__QA_WALK__', '1']);
for (const [key, value] of entries) {
  if (value.length > 1024) {
    manifest[key] = null;
    // 파일명은 키의 MD5 **소문자** 16진수다(RCTMD5Hash). 대문자로 쓰면 앱이 못 읽는다.
    fs.writeFileSync(path.join(storeDir, crypto.createHash('md5').update(key).digest('hex')), value);
  } else {
    manifest[key] = value;
  }
}
fs.writeFileSync(manifestPath, JSON.stringify(manifest));

console.log('[5/5] 앱 실행');
sh(`xcrun simctl launch booted ${BUNDLE_ID}`);
console.log(`
준비 완료. 수집기가 떠 있어야 기록이 남습니다:
  node scripts/qa-collector.mjs ${LANG}
순회가 끝나면:
  node scripts/qa-report.mjs ${LANG}`);
