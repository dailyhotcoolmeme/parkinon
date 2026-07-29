#!/usr/bin/env node
/**
 * 검수 케이스 생성기 — 케이스 목록을 사람이 타이핑하지 않는다.
 *
 *   node scripts/qa-cases-gen.mjs        → qa/cases.json 갱신
 *
 * 왜 생성기인가:
 *   내가 손으로 "화면 32개" 목록을 만들었더니 그게 전부인 줄 알았다. 실제로는
 *   라우트 50개, 확인·경고 팝업 262곳, 알림 진입 7종, 역할 3종이 있었다.
 *   손으로 적는 목록은 적은 사람이 아는 만큼만 커진다 — 그래서 코드에서 뽑는다.
 *
 * 뽑는 방법:
 *   화면   : navigation/*.tsx 의 Screen name= 전부
 *   팝업   : dialog.alert / dialog.confirm 호출 지점 전부 (그 안의 t() 키까지)
 *   알림   : 서버·앱이 쓰는 알림 type 전부
 *   역할축 : 환자 / 보호자(함께 거주) / 보호자(따로 거주)
 *
 * 새 화면·새 팝업을 추가하면 다음 실행에서 케이스가 저절로 늘어난다.
 * 늘어난 케이스는 아직 안 돌린 상태이므로 리포트에 "미실행"으로 남는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT = path.join(ROOT, 'qa/cases.json');

/**
 * 화면이 어느 탭 아래 있는지 — navigate() 로 열려면 중첩 경로가 필요하다.
 * 네비게이터 구조가 바뀌면 여기만 고친다(5줄).
 */
const NESTING = {
  Medication: [],
  BodyStateTab: ['BodyState', 'VideoRecord', 'VideoList'],
  Exercise: ['ExerciseMain', 'ExerciseRecord', 'ExerciseDuration', 'ExerciseVideo', 'ExerciseVideoPlayer'],
  MyInfo: ['MenuHome', 'Records', 'RecordDetail', 'Settings', 'MedTimeOnboarding', 'MedicationManage',
    'FamilyLink', 'ProfileEdit', 'Terms', 'Privacy', 'VideoList', 'MedicalRecordList', 'MedicalRecordWrite',
    'MedicalRecordDetail', 'AppointmentWrite', 'NotificationHistory', 'RecordSound', 'AlarmSoundSettings',
    'BlockedUsers', 'SubscriptionManage'],
  Feed: ['FeedMain', 'PostDetail', 'PostWrite'],
};

/**
 * 역할 축 — 같은 화면도 역할에 따라 다른 문구가 나온다.
 * 예) 보호자(따로 거주)에게만 "같이 계신 경우에만 대신 입력할 수 있어요" 가 뜬다.
 */
const ROLES = [
  { id: 'patient', label: '환자' },
  { id: 'caregiver-together', label: '보호자(함께 거주)' },
  { id: 'caregiver-apart', label: '보호자(따로 거주)' },
];

/**
 * 오너 결정으로 검수 대상에서 제외한 것. 빼려면 여기에 줄을 추가해야 하고 diff 에 보인다.
 */
const EXCLUDED_ROUTES = {
  ExerciseVideo: { reason: '운동 영상은 국내 전용', approved: '2026-07-29' },
  ExerciseVideoPlayer: { reason: '운동 영상은 국내 전용', approved: '2026-07-29' },
  MeasurementConsent: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  MeasurementMenu: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  MeasurementRecords: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  MeasurementResult: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  CaregiverMeasurement: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  TapGame: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  ReactionGame: { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' },
  FeedMain: { reason: '커뮤니티는 국내 전용(해외 빌드에 탭 없음)', approved: '2026-07-29' },
  PostDetail: { reason: '커뮤니티는 국내 전용', approved: '2026-07-29' },
  PostWrite: { reason: '커뮤니티는 국내 전용', approved: '2026-07-29' },
  Splash: { reason: '문구 없음(로고만)', approved: '2026-07-30' },
  Main: { reason: '탭 컨테이너 — 개별 탭으로 커버', approved: '2026-07-30' },
  OnboardingGuest: { reason: '스택 컨테이너 — 개별 화면으로 커버', approved: '2026-07-30' },
  OnboardingAuth: { reason: '스택 컨테이너 — 개별 화면으로 커버', approved: '2026-07-30' },
  // 탭 컨테이너 — 진입하면 안쪽 첫 화면이 뜨므로 그 화면 케이스로 이미 커버된다.
  BodyStateTab: { reason: '탭 컨테이너 — BodyState 로 커버', approved: '2026-07-30' },
  Exercise: { reason: '탭 컨테이너 — ExerciseMain 으로 커버', approved: '2026-07-30' },
  MyInfo: { reason: '탭 컨테이너 — MenuHome 으로 커버', approved: '2026-07-30' },
  Feed: { reason: '커뮤니티는 국내 전용', approved: '2026-07-29' },
};

/**
 * 들어가면 다른 화면으로 못 빠져나오는 화면 — 자동 순회에 섞으면 뒤 케이스가 전부 죽는다.
 * (2026-07-30: Alarm 을 순회 중간에 넣었더니 이후 30개 화면이 통째로 실행되지 않았다.)
 * 따로 실행한다.
 */
const BLOCKING = new Set(['Alarm']);

/**
 * 필수 params 가 있는 화면의 값. 파라미터 필요 여부는 ParamList 타입에서 자동으로 읽고,
 * 여기에 값이 없으면 케이스는 'fixture-missing' 으로 남는다 — 조용히 빠지지 않는다.
 * (2026-07-30: ExerciseDuration 을 params 없이 열었더니 앱이 죽어 이후 30개가 통째로 실행되지 않았다.)
 */
const PARAM_FIXTURES = {
  ExerciseDuration: { exerciseType: 'walk' },
  RecordDetail: { type: 'medication' },
};

/** 로그인 전/온보딩 화면 — 검수 계정으로는 못 들어간다. 진입 방법을 명시한다. */
const PRELOGIN = new Set(['Login', 'OnboardingSlide', 'RoleSelect', 'PatientInfo', 'CaregiverInfo',
  'FamilyCheck', 'FamilyInvite', 'SensitiveInfoConsent', 'MedTimeOnboarding']);

const walk = (dir, exts, out = []) => {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (/node_modules|\.git/.test(p)) continue;
    if (e.isDirectory()) walk(p, exts, out);
    else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
  }
  return out;
};

// ── 1. 화면 케이스 ────────────────────────────────────────────────
const routes = [...new Set(
  fs.readdirSync(path.join(ROOT, 'src/navigation'))
    .filter((f) => f.endsWith('.tsx'))
    .flatMap((f) => [...fs.readFileSync(path.join(ROOT, 'src/navigation', f), 'utf8')
      .matchAll(/Screen\s+name="([^"]+)"/g)].map((m) => m[1])),
)].sort();

/** ParamList 타입에서 각 화면의 params 필요 여부를 읽는다(손으로 적지 않는다). */
function requiredParamRoutes() {
  const need = new Set();
  for (const f of fs.readdirSync(path.join(ROOT, 'src/navigation')).filter((x) => x.endsWith('.tsx'))) {
    const src = fs.readFileSync(path.join(ROOT, 'src/navigation', f), 'utf8');
    for (const block of src.matchAll(/ParamList\s*=\s*\{([\s\S]*?)\n\};/g)) {
      // 한 줄 = 한 화면. 중첩 객체는 깊이를 세어 한 항목으로 묶는다.
      let depth = 0, cur = '';
      for (const line of block[1].split('\n')) {
        cur += line + '\n';
        depth += (line.match(/\{/g) ?? []).length - (line.match(/\}/g) ?? []).length;
        if (depth === 0 && cur.includes(':')) {
          const name = cur.trim().split(':')[0].trim();
          const type = cur.slice(cur.indexOf(':') + 1);
          if (/^[A-Z]\w*$/.test(name) && !/undefined/.test(type) && /\{/.test(type)) need.add(name);
          cur = '';
        }
      }
    }
  }
  return need;
}
const NEEDS_PARAMS = requiredParamRoutes();

function navTarget(route, fixture) {
  for (const [tab, list] of Object.entries(NESTING)) {
    if (list.includes(route)) {
      return { route: 'Main', params: { screen: tab, params: { screen: route, ...(fixture ? { params: fixture } : {}) } } };
    }
    if (tab === route) return { route: 'Main', params: { screen: tab } };
  }
  return { route, ...(fixture ? { params: fixture } : {}) };
}

const screenCases = routes.map((r) => {
  const ex = EXCLUDED_ROUTES[r];
  return {
    id: `screen:${r}`,
    kind: 'screen',
    title: `${r} 화면 진입`,
    roles: ROLES.map((x) => x.id),
    entry: PRELOGIN.has(r)
      ? { how: 'manual', note: '로그인/온보딩 흐름 — 신규 계정으로 처음부터 진행해야 나온다' }
      : BLOCKING.has(r)
        ? { how: 'isolated', ...navTarget(r), note: '전체화면 — 이 화면만 따로 띄운다' }
        : NEEDS_PARAMS.has(r) && !PARAM_FIXTURES[r]
          ? { how: 'fixture-missing', note: `필수 params 가 있는데 값이 없다 — PARAM_FIXTURES.${r} 를 채워야 실행된다` }
          : { how: 'navigate', ...navTarget(r, PARAM_FIXTURES[r]) },
    excluded: ex ?? null,
  };
});

// ── 2. 팝업 케이스 (확인·경고 다이얼로그) ─────────────────────────
const dialogCases = [];
for (const file of walk(path.join(ROOT, 'src'), ['.ts', '.tsx'])) {
  const rel = path.relative(ROOT, file);
  const src = fs.readFileSync(file, 'utf8');
  const re = /dialog\.(alert|confirm)\s*\(\s*\{([\s\S]{0,600}?)\}\s*\)/g;
  let m;
  while ((m = re.exec(src)) !== null) {
    const line = src.slice(0, m.index).split('\n').length;
    const keys = [...m[2].matchAll(/\bt\(\s*['"`]([^'"`]+)['"`]/g)].map((k) => k[1]);
    if (!keys.length) continue; // t() 없이 만든 팝업은 i18n-audit 이 따로 잡는다
    dialogCases.push({
      id: `dialog:${rel}:${line}`,
      kind: 'dialog',
      title: `${path.basename(rel)} ${m[1]} 팝업`,
      roles: ROLES.map((x) => x.id),
      entry: { how: 'action', file: rel, line, note: '해당 조건을 만들어 팝업을 띄운다' },
      keys,
      excluded: /screens\/feed\//.test(rel)
        ? { reason: '커뮤니티는 국내 전용', approved: '2026-07-29' }
        : /measurement/i.test(rel)
          ? { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' }
          : null,
    });
  }
}

// ── 3. 알림 진입 케이스 ───────────────────────────────────────────
const notifTypes = [...new Set(
  walk(path.join(ROOT, 'supabase/functions'), ['.ts'])
    .concat(walk(path.join(ROOT, 'src'), ['.ts', '.tsx']))
    .flatMap((f) => [...fs.readFileSync(f, 'utf8')
      .matchAll(/['"](medication_reminder|missed_medication|effect_tracking|exercise_reminder|family_joined|diary_entry|appointment_reminder|measurement_completed)['"]/g)]
      .map((m) => m[1])),
)].sort();

const notifCases = notifTypes.flatMap((t) => [
  {
    id: `notif:${t}:receive`,
    kind: 'notification',
    title: `${t} 알림 수신 문구`,
    roles: ROLES.map((x) => x.id),
    entry: { how: 'device', note: '실기기 필요 — 시뮬레이터는 원격 푸시를 못 받는다' },
    excluded: t === 'measurement_completed'
      ? { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' } : null,
  },
  {
    id: `notif:${t}:open`,
    kind: 'notification',
    title: `${t} 알림 탭 → 진입 화면`,
    roles: ROLES.map((x) => x.id),
    entry: { how: 'payload', note: '알림 payload 를 넣어 앱을 띄우면 시뮬레이터에서도 재현된다' },
    excluded: t === 'measurement_completed'
      ? { reason: '측정 기능 — 재오픈 시점에 처리', approved: '2026-07-29' } : null,
  },
]);

// ── 4. 데이터 상태 축 ─────────────────────────────────────────────
const stateCases = [
  { id: 'state:empty', kind: 'data-state', title: '기록이 하나도 없는 계정', roles: ROLES.map((x) => x.id),
    entry: { how: 'account', note: '빈 계정으로 전체 순회 — "아직 기록이 없어요" 류 문구가 여기서만 나온다' }, excluded: null },
  { id: 'state:filled', kind: 'data-state', title: '3주치 기록이 쌓인 계정', roles: ROLES.map((x) => x.id),
    entry: { how: 'account', note: '시드 계정으로 전체 순회 — 통계·그래프·비교 문구' }, excluded: null },
  { id: 'state:unlinked', kind: 'data-state', title: '가족 연동이 안 된 계정', roles: ROLES.map((x) => x.id),
    entry: { how: 'account', note: '그룹 없는 계정 — 연동 유도 문구' }, excluded: null },
];

const cases = [...screenCases, ...dialogCases, ...notifCases, ...stateCases];
const active = cases.filter((c) => !c.excluded);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify({
  generatedFrom: 'scripts/qa-cases-gen.mjs',
  roles: ROLES,
  counts: {
    total: cases.length,
    active: active.length,
    excluded: cases.length - active.length,
    byKind: Object.fromEntries(['screen', 'dialog', 'notification', 'data-state']
      .map((k) => [k, cases.filter((c) => c.kind === k).length])),
  },
  cases,
}, null, 2) + '\n');

console.log(`케이스 ${cases.length}개 (검수 대상 ${active.length}, 제외 ${cases.length - active.length})`);
for (const k of ['screen', 'dialog', 'notification', 'data-state']) {
  const all = cases.filter((c) => c.kind === k);
  console.log(`  ${k.padEnd(13)} ${String(all.length).padStart(4)}개  (제외 ${all.filter((c) => c.excluded).length})`);
}
console.log(`→ ${path.relative(ROOT, OUT)}`);
console.log(`\n역할 축 ${ROLES.length}종을 곱하면 실행 단위 ${active.length * ROLES.length}회분입니다.`);
