/**
 * 번역 검수 자동 순회 — 화면을 하나씩 열어 프로브가 문구를 수집하게 한다.
 *
 * 왜 앱 안에서 도는가:
 *   화면 좌표를 눌러 돌아다니는 자동화는 레이아웃이 바뀔 때마다 깨진다.
 *   여기서는 navigationRef 로 라우트를 직접 연다 — 좌표에 의존하지 않으므로
 *   다음 언어에서도 그대로 재사용된다.
 *
 * 켜는 법(맥에서 AsyncStorage 에 심고 앱 실행):
 *   AsyncStorage['__QA_WALK__'] = '1'
 *   → scripts/qa-run.mjs 가 대신 해준다.
 *
 * 케이스 목록은 여기에 없다:
 *   qa/cases.json (scripts/qa-cases-gen.mjs 가 코드에서 생성)을 그대로 따른다.
 *   내가 손으로 적은 목록은 내가 아는 만큼만 커진다 — 그래서 소스를 분리했다.
 *
 * 한계(정직하게):
 *   여기서 도는 것은 entry.how === 'navigate' 인 화면 케이스뿐이다.
 *   팝업·알림·데이터 상태 케이스는 돌지 않으며, 리포트에 '미실행'으로 남는다.
 *   이 파일이 커버리지를 주장하지 않는다 — 안 한 것이 명단에 남게 하는 게 목적이다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { navigationRef } from '../navigation/navigationRef';
import { qaMark } from './qaProbe';
import casesFile from '../../qa/cases.json';

type NavEntry = { how: string; route?: string; params?: object; note?: string };
type QaCase = {
  id: string;
  kind: string;
  title: string;
  entry: NavEntry;
  excluded: { reason: string; approved: string } | null;
};

// 생성된 케이스 목록(qa/cases.json). 새 화면이 생기면 여기 자동으로 늘어난다.
const CASES: QaCase[] = (casesFile as { cases: QaCase[] }).cases;

const DWELL_MS = 1800; // 데이터 로딩·애니메이션이 끝나고 실제 문구가 그려질 시간

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function navReady(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name) return;
    await wait(500);
  }
}

export async function maybeRunQaWalk(): Promise<void> {
  if (!__DEV__) return;
  let flag: string | null = null;
  try {
    flag = await AsyncStorage.getItem('__QA_WALK__');
  } catch {
    return;
  }
  if (flag !== '1') return;

  await navReady();
  qaMark('WALK_START');
  const steps = CASES.filter((c) => !c.excluded && c.kind === 'screen' && c.entry.how === 'navigate');
  for (const step of steps) {
    try {
      (navigationRef.navigate as (n: string, p?: object) => void)(step.entry.route!, step.entry.params);
    } catch {
      qaMark(`SKIP ${step.id}`);
      continue;
    }
    await wait(DWELL_MS);
    qaMark(step.id);
  }
  qaMark('WALK_END');
  try { await AsyncStorage.removeItem('__QA_WALK__'); } catch { /* 무시 */ }
}
