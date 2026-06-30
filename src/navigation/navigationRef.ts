import { createNavigationContainerRef } from '@react-navigation/native';
import type { RootStackParamList } from './RootNavigator';

export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function navigateTo(name: string, params?: Record<string, any>): void {
  if (navigationRef.isReady()) {
    // navigateTo는 루트 스택뿐 아니라 탭/중첩 스택 라우트('Medication', 'Exercise',
    // { screen, params } 등)까지 아우르는 전역 헬퍼라 단일 ParamList로 표현할 수 없다.
    // 런타임은 React Navigation이 네비게이터 트리를 거슬러 올라가 해석하므로,
    // navigate 메서드만 느슨한 함수 타입으로 좁혀 호출한다(인자 타입은 그대로 유지).
    (navigationRef.navigate as (target: string, params?: object) => void)(name, params);
  }
}
