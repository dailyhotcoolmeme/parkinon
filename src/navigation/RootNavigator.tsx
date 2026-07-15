import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../context/AuthContext';
import { OnboardingNavigator } from './OnboardingNavigator';
import { MainNavigator } from './MainNavigator';
import { LoadingScreen } from '../screens/LoadingScreen';
import { navigationRef } from './navigationRef';
import { setActivityScreen, logActivity } from '../utils/activityLog';
import { NotificationHistoryScreen } from '../screens/notification/NotificationHistoryScreen';
import { ConsentScreen as MeasurementConsentScreen } from '../screens/measurement/ConsentScreen';
import { MeasurementMenuScreen } from '../screens/measurement/MeasurementMenuScreen';
import { TapGameScreen } from '../screens/measurement/TapGameScreen';
import { ReactionGameScreen } from '../screens/measurement/ReactionGameScreen';
import { MeasurementResultScreen } from '../screens/measurement/MeasurementResultScreen';
import { CaregiverMeasurementScreen } from '../screens/measurement/CaregiverMeasurementScreen';
import { MeasurementRecordsScreen } from '../screens/measurement/MeasurementRecordsScreen';
import { DiaryScreen } from '../screens/diary/DiaryScreen';
import { useNotificationGate } from '../hooks/useNotificationGate';
import { NotificationGateScreen } from '../components/common/NotificationGateScreen';
import type { MeasurementMedPhase } from '../types/database';

export type RootStackParamList = {
  OnboardingGuest: undefined;
  OnboardingAuth: undefined;
  Main: undefined;
  NotificationHistory: { mode?: 'inbox' | 'all' } | undefined;
  // 디지털 바이오마커 동의 화면 (첫 측정 1회) — Phase 1에서 등록, Phase 4에서 next 옵션 추가.
  // next: 동의 완료 직후 자동 진입할 후속 라우트 (알림 액션 '바로 측정하기' 진입 시 사용).
  MeasurementConsent:
    | undefined
    | {
        next?:
          | { screen: 'TapGame'; params: { medPhase: MeasurementMedPhase; medIntakeId?: string | null } }
          | { screen: 'ReactionGame'; params: { medPhase: MeasurementMedPhase; medIntakeId?: string | null } }
          | { screen: 'MeasurementMenu' };
      };
  // Phase 2 — 측정 메뉴 / 게임 화면
  MeasurementMenu: undefined;
  TapGame: { medPhase: MeasurementMedPhase; medIntakeId?: string | null };
  ReactionGame: { medPhase: MeasurementMedPhase; medIntakeId?: string | null };
  // Phase 3 — 결과 화면 (게임 완료 후 replace 진입)
  MeasurementResult: { measurementId: string };
  // Phase 5A — 보호자 측정 결과 조회 화면 (read-only). 메뉴 또는 측정완료 푸시에서 진입.
  // patientId 미지정 시: 보호자의 patient_group_id로 환자 lookup.
  CaregiverMeasurement: { patientId?: string } | undefined;
  // 측정 기록 보기 화면. 일별 그래프 + 개별 기록 리스트(30건).
  // 환자 본인: param 없음(본인 데이터). 보호자: { patientId, patientName }로 환자 데이터 관람(읽기 전용).
  MeasurementRecords: { patientId?: string; patientName?: string } | undefined;
  // 종합 데일리 저널(일기) — date 미지정 시 오늘(KST). 영상 기록에서 '일기 보기'로 진입 시 해당 날짜 전달.
  Diary: { date?: string } | undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();
  // 화면 이동 로그 중복 방지용(같은 화면 재기록 방지)
  const lastScreenRef = React.useRef<string | null>(null);

  // 알림 권한 강제 게이트 — 온보딩까지 마친 로그인 사용자에게만 동작.
  // 훅은 (조건부 호출 금지를 위해) 항상 호출하되, enabled 로 동작을 제어한다.
  const gateEnabled = !!user && !!user.onboarding_done && !loading;
  const { state: gateState, canAskAgain, canSkip, skipped, skip, recheck } =
    useNotificationGate(gateEnabled);

  if (loading) return <LoadingScreen />;

  // 게이트 검사 중에는 절대 게이트를 보여주지 않고 로딩만 노출(잘못된 차단 방지).
  if (gateEnabled && gateState === 'checking') return <LoadingScreen />;

  // 권한 미허용 → 게이트 노출.
  // - 안드(canSkip=false): 하드 블록. 허용 전까지 MainNavigator 자체가 마운트되지 않음.
  // - iOS(canSkip=true): 소프트. "나중에"(skip) 선택 시 skipped=true → 게이트 통과해 진입.
  //   이때 gateState 는 여전히 'blocked'(실제 권한 없음) — 게이트 통과는 권한 허용과 별개.
  if (gateEnabled && gateState === 'blocked' && !skipped) {
    return (
      <NotificationGateScreen
        userId={user!.id}
        canAskAgain={canAskAgain}
        canSkip={canSkip}
        onSkip={skip}
        onRecheck={recheck}
      />
    );
  }

  return (
    <NavigationContainer
      ref={navigationRef}
      onReady={() => {
        const r = navigationRef.getCurrentRoute()?.name ?? null;
        setActivityScreen(r);
        if (r) {
          lastScreenRef.current = r;
          logActivity('screen_view', { screen: r });
        }
      }}
      onStateChange={() => {
        const r = navigationRef.getCurrentRoute()?.name ?? null;
        if (r && r !== lastScreenRef.current) {
          lastScreenRef.current = r;
          setActivityScreen(r);
          logActivity('screen_view', { screen: r });
        }
      }}
    >
      <Stack.Navigator screenOptions={{ headerShown: false }}>
        {!user ? (
          // 미로그인: Splash → OnboardingSlide → Login
          <Stack.Screen name="OnboardingGuest" component={OnboardingNavigator} />
        ) : !user.onboarding_done ? (
          // 로그인됐지만 온보딩 미완료: RoleSelect부터 시작
          <Stack.Screen name="OnboardingAuth" component={OnboardingNavigator} />
        ) : (
          <>
            <Stack.Screen name="Main" component={MainNavigator} />
            <Stack.Screen name="NotificationHistory" component={NotificationHistoryScreen} />
            <Stack.Screen name="MeasurementConsent" component={MeasurementConsentScreen} />
            <Stack.Screen name="MeasurementMenu" component={MeasurementMenuScreen} />
            <Stack.Screen name="TapGame" component={TapGameScreen} />
            <Stack.Screen name="ReactionGame" component={ReactionGameScreen} />
            <Stack.Screen name="MeasurementResult" component={MeasurementResultScreen} />
            <Stack.Screen name="CaregiverMeasurement" component={CaregiverMeasurementScreen} />
            <Stack.Screen name="MeasurementRecords" component={MeasurementRecordsScreen} />
            <Stack.Screen name="Diary" component={DiaryScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
