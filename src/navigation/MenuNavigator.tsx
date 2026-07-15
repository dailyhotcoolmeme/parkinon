import React from 'react';
import { createStackNavigator } from '@react-navigation/stack';
import { MenuScreen } from '../screens/menu/MenuScreen';
import { SettingsScreen } from '../screens/menu/SettingsScreen';
import { MedicationManageScreen } from '../screens/menu/MedicationManageScreen';
import { FamilyLinkScreen } from '../screens/menu/FamilyLinkScreen';
import { ProfileEditScreen } from '../screens/menu/ProfileEditScreen';
import { RecordsScreen } from '../screens/records/RecordsScreen';
import { RecordDetailScreen } from '../screens/records/RecordDetailScreen';
import { TermsScreen } from '../screens/menu/TermsScreen';
import { PrivacyScreen } from '../screens/menu/PrivacyScreen';
import { VideoListScreen } from '../screens/bodystate/VideoListScreen';
import { MedicalRecordListScreen } from '../screens/menu/MedicalRecordListScreen';
import { MedicalRecordWriteScreen } from '../screens/menu/MedicalRecordWriteScreen';
import { MedicalRecordDetailScreen } from '../screens/menu/MedicalRecordDetailScreen';
import { AppointmentWriteScreen } from '../screens/menu/AppointmentWriteScreen';
import { NotificationHistoryScreen } from '../screens/notification/NotificationHistoryScreen';
import { RecordSoundScreen } from '../screens/sound/RecordSoundScreen';
import { AlarmSoundSettingsScreen } from '../screens/sound/AlarmSoundSettingsScreen';
import { BlockedUsersScreen } from '../screens/menu/BlockedUsersScreen';
import { SubscriptionManageScreen } from '../screens/menu/SubscriptionManageScreen';
import { MedTimeOnboardingScreen } from '../screens/onboarding/MedTimeOnboardingScreen';

export type MenuStackParamList = {
  MenuHome: undefined;
  Records: undefined;
  RecordDetail: {
    type: 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';
    period?: string;
  };
  Settings: { guideCaregiverNotif?: boolean } | undefined;
  MedTimeOnboarding: undefined;
  MedicationManage: { mode?: 'meds' | 'slots'; openSlot?: 'morning' | 'lunch' | 'dinner' | 'bedtime'; guideSetup?: boolean } | undefined;
  FamilyLink: undefined;
  ProfileEdit: undefined;
  Terms: undefined;
  Privacy: undefined;
  VideoList: undefined;
  MedicalRecordList: undefined;
  MedicalRecordWrite: { recordId?: string } | undefined;
  MedicalRecordDetail: { recordId: string };
  AppointmentWrite: { appointmentId?: string } | undefined;
  NotificationHistory: { mode?: 'inbox' | 'all' } | undefined;
  // 알림음 녹음 화면 — 5초 이내 음성 녹음 → R2 업로드 + custom_sounds 기록
  RecordSound: { editSoundId?: string; editLabel?: string } | undefined;
  // 알림음 설정 화면 — 저장된 녹음 미리듣기/설정/삭제 + 새 녹음 진입
  AlarmSoundSettings:
    | {
        updatedSound?: { id: string; label?: string; public_url?: string | null; duration_ms?: number | null };
        // 신규 녹음 등록 직후 목록 즉시 반영용(복제 지연 대비).
        newSound?: { id: string; label: string; public_url: string | null; duration_ms: number | null; created_at?: string };
      }
    | undefined;
  // 차단한 사용자 관리 화면 — 커뮤니티 차단 해제 UI
  BlockedUsers: undefined;
  // 구독 관리 화면 (해외판 프리미엄) — Phase 5 뼈대, 결제는 Phase 6
  SubscriptionManage: undefined;
};

const Stack = createStackNavigator<MenuStackParamList>();

export function MenuNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MenuHome" component={MenuScreen} />
      <Stack.Screen name="Records" component={RecordsScreen} />
      <Stack.Screen name="RecordDetail" component={RecordDetailScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="MedTimeOnboarding" component={MedTimeOnboardingScreen} />
      <Stack.Screen name="MedicationManage" component={MedicationManageScreen} />
      <Stack.Screen name="FamilyLink" component={FamilyLinkScreen} />
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="VideoList" component={VideoListScreen} />
      <Stack.Screen name="MedicalRecordList" component={MedicalRecordListScreen} />
      <Stack.Screen name="MedicalRecordWrite" component={MedicalRecordWriteScreen} />
      <Stack.Screen name="MedicalRecordDetail" component={MedicalRecordDetailScreen} />
      <Stack.Screen name="AppointmentWrite" component={AppointmentWriteScreen} />
      <Stack.Screen name="NotificationHistory" component={NotificationHistoryScreen} />
      <Stack.Screen name="RecordSound" component={RecordSoundScreen} />
      <Stack.Screen name="AlarmSoundSettings" component={AlarmSoundSettingsScreen} />
      <Stack.Screen name="BlockedUsers" component={BlockedUsersScreen} />
      <Stack.Screen name="SubscriptionManage" component={SubscriptionManageScreen} />
    </Stack.Navigator>
  );
}
