import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

/**
 * 구독 화면으로 이동.
 *
 * 왜 전용 함수인가:
 *   navigate('Main', { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } }) 만
 *   쓰면 **두 번째부터 아무 일도 일어나지 않는다**(실측). 한 번 다녀오면 메뉴 탭 스택 맨 위에
 *   SubscriptionManage 가 그대로 남는데, 그 상태에서 같은 곳으로 navigate 하면
 *   React Navigation 이 "이미 그 화면"이라고 보고 탭 전환까지 통째로 건너뛴다.
 *   → 사용자에게는 버튼이 죽은 것처럼 보인다(가족일기 구독 배너에서 발견).
 *
 *   그래서 두 단계로 나눈다.
 *     1) 메뉴 탭으로 전환 — 스택 맨 위가 이미 구독 화면이면 이것만으로 바로 보인다.
 *     2) 구독 화면 지정 — 처음 들어가는 경우를 위해.
 */
export function goToSubscription(): void {
  if (!navigationRef.isReady()) return;
  const nav = navigationRef.navigate as (target: string, params?: object) => void;

  // ⚠️ 가족일기(Diary) 같은 화면은 탭(Main)이 아니라 **루트 스택**에 있어서 탭 전체를 덮는다.
  //   그 상태에서 탭 안쪽으로 navigate 하면 이동은 되지만 화면은 그대로다 — 위에 덮인
  //   루트 화면이 계속 보이기 때문(실측: 가족일기 구독 배너가 눌려도 아무 반응 없어 보임).
  //   그래서 덮고 있는 화면이 있으면 먼저 닫는다.
  // ⚠️ 가족일기 작성기는 RN <Modal> 로 떠 있다. RN Modal 은 네비게이션 계층 **바깥**,
  //   화면 최상단에 뜨기 때문에 그 아래에서 어디로 이동하든 화면이 바뀌지 않는다.
  //   (루트 스택에 구독 화면을 올려봐도 마찬가지 — 모달이 계속 덮는다. 실측 확인.)
  //   → 덮고 있는 화면을 먼저 닫는 수밖에 없다.
  const current = navigationRef.getCurrentRoute()?.name;
  const covered = !!current && current !== 'Main' && navigationRef.canGoBack();
  if (covered) navigationRef.goBack();

  // 덮인 화면을 닫았다면 그것만으로 상태가 바뀌므로 한 번만 이동하면 된다.
  //   덮인 게 없을 때만 두 단계로 나눈다 — 같은 화면이 스택 맨 위에 남아 있으면
  //   navigate 가 통째로 무시되기 때문(두 번째 진입부터 죽는 문제).
  if (!covered) nav('Main', { screen: 'MyInfo' });
  nav('Main', { screen: 'MyInfo', params: { screen: 'SubscriptionManage' } });
}

export function navigateTo(name: string, params?: Record<string, any>): void {
  if (navigationRef.isReady()) {
    // navigateTo는 루트 스택뿐 아니라 탭/중첩 스택 라우트('Medication', 'Exercise',
    // { screen, params } 등)까지 아우르는 전역 헬퍼라 단일 ParamList로 표현할 수 없다.
    // 런타임은 React Navigation이 네비게이터 트리를 거슬러 올라가 해석하므로,
    // navigate 메서드만 느슨한 함수 타입으로 좁혀 호출한다(인자 타입은 그대로 유지).
    (navigationRef.navigate as (target: string, params?: object) => void)(name, params);
  }
}
