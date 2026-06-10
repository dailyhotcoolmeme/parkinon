import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { useAuth } from '../context/AuthContext';
import { OnboardingNavigator } from './OnboardingNavigator';
import { MainNavigator } from './MainNavigator';
import { LoadingScreen } from '../screens/LoadingScreen';
import { navigationRef } from './navigationRef';
import { NotificationHistoryScreen } from '../screens/notification/NotificationHistoryScreen';
import { ConsentScreen as MeasurementConsentScreen } from '../screens/measurement/ConsentScreen';
import { MeasurementMenuScreen } from '../screens/measurement/MeasurementMenuScreen';
import { TapGameScreen } from '../screens/measurement/TapGameScreen';
import { ReactionGameScreen } from '../screens/measurement/ReactionGameScreen';
import { MeasurementResultScreen } from '../screens/measurement/MeasurementResultScreen';
import { CaregiverMeasurementScreen } from '../screens/measurement/CaregiverMeasurementScreen';
import { MeasurementRecordsScreen } from '../screens/measurement/MeasurementRecordsScreen';
import { RecordSoundScreen } from '../screens/sound/RecordSoundScreen';
import { AlarmSoundSettingsScreen } from '../screens/sound/AlarmSoundSettingsScreen';
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
  // 알림음 녹음 화면 — 5초 이내 음성 녹음 → R2 업로드 + custom_sounds 기록
  // editSoundId/editLabel 이 오면 수정 모드(기존 행 UPDATE). 없으면 신규 등록.
  RecordSound: { editSoundId?: string; editLabel?: string } | undefined;
  // 알림음 설정 화면 — 저장된 녹음 미리듣기/설정/삭제 + 새 녹음 진입
  AlarmSoundSettings: undefined;
};

const Stack = createStackNavigator<RootStackParamList>();

export function RootNavigator() {
  const { user, loading } = useAuth();

  if (loading) return <LoadingScreen />;

  return (
    <NavigationContainer ref={navigationRef}>
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
            <Stack.Screen name="RecordSound" component={RecordSoundScreen} />
            <Stack.Screen name="AlarmSoundSettings" component={AlarmSoundSettingsScreen} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
