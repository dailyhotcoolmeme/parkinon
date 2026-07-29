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
 * 한계(정직하게):
 *   이 순회는 "화면 진입"까지만 커버한다. 버튼을 눌러야 뜨는 팝업·오류·완료 문구는
 *   안 뜬다. 그건 리포트의 '미노출 키' 목록으로 남고, 시나리오로 따로 처리한다.
 *   즉 이 파일이 커버리지 100% 를 주장하지 않는다 — 남은 몫을 명단으로 넘긴다.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import { navigationRef } from '../navigation/navigationRef';
import { qaMark } from './qaProbe';

type Step = { route: string; params?: object; note?: string };

/**
 * 순회 대상. 오너 결정으로 제외한 것:
 *   Measurement 계열·ReactionGame·TapGame — 측정 기능(재오픈 시점에 처리)
 *   ExerciseVideo 계열                    — 운동 영상은 국내 전용
 *   Feed·Post 계열                        — 해외 빌드에서 탭 자체가 마운트되지 않음
 */
const STEPS: Step[] = [
  // 탭 자체
  { route: 'Main', params: { screen: 'Medication' }, note: '약 복용 탭' },
  { route: 'Main', params: { screen: 'BodyStateTab', params: { screen: 'BodyState' } }, note: '몸 상태 탭' },
  { route: 'Main', params: { screen: 'Exercise', params: { screen: 'ExerciseMain' } }, note: '운동 탭' },
  { route: 'Main', params: { screen: 'OverseasMedTab' }, note: '해외 약/알림 탭' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MenuHome' } }, note: '메뉴' },

  // 몸 상태 스택
  { route: 'Main', params: { screen: 'BodyStateTab', params: { screen: 'VideoRecord' } } },
  { route: 'Main', params: { screen: 'BodyStateTab', params: { screen: 'VideoList' } } },

  // 운동 스택
  { route: 'Main', params: { screen: 'Exercise', params: { screen: 'ExerciseRecord' } } },
  { route: 'Main', params: { screen: 'Exercise', params: { screen: 'ExerciseDuration', params: { exerciseType: 'walk' } } } },

  // 메뉴 스택
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'Records' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'medication' } } }, note: '약 복용' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'bodyState' } } }, note: '몸 상태' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'mood' } } }, note: '기분' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'sleep' } } }, note: '수면' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'constipation' } } }, note: '변비' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordDetail', params: { type: 'exercise' } } }, note: '운동' },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'Settings' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'AlarmSoundSettings' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'RecordSound' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'NotificationHistory' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MedicationManage', params: { mode: 'meds' } } } }, // 약 목록
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MedicationManage', params: { mode: 'slots' } } } }, // 복용 시간대
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MedTimeOnboarding' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'FamilyLink' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'ProfileEdit' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'BlockedUsers' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MedicalRecordList' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'MedicalRecordWrite' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'AppointmentWrite' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'Terms' } } },
  { route: 'Main', params: { screen: 'MyInfo', params: { screen: 'Privacy' } } },

  // 루트 스택
  { route: 'Diary' },
  { route: 'NotificationHistory' },
];

const DWELL_MS = 1800; // 데이터 로딩·애니메이션이 끝나고 실제 문구가 그려질 시간

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function navReady(): Promise<void> {
  for (let i = 0; i < 120; i += 1) {
    if (navigationRef.isReady() && navigationRef.getCurrentRoute()?.name === 'Main') return;
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
  for (const step of STEPS) {
    try {
      (navigationRef.navigate as (n: string, p?: object) => void)(step.route, step.params);
    } catch {
      qaMark(`SKIP ${step.route}`);
      continue;
    }
    await wait(DWELL_MS);
    // 도착 라우트를 함께 남긴다. 중첩 네비게이터로 이동이 실패하면 이전 화면에
    // 머무는데, 표식만 보면 성공한 것처럼 보이기 때문이다.
    const landed = navigationRef.isReady() ? navigationRef.getCurrentRoute()?.name : '?';
    qaMark(`ROUTE ${landed}${step.note ? ' / ' + step.note : ''}`);
  }
  qaMark('WALK_END');
  // 한 번 돌면 플래그를 내린다 — 다음 실행에서 의도치 않게 또 돌지 않도록.
  try { await AsyncStorage.removeItem('__QA_WALK__'); } catch { /* 무시 */ }
}
