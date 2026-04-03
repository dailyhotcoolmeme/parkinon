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

export type MenuStackParamList = {
  MenuHome: undefined;
  Records: undefined;
  RecordDetail: {
    type: 'medication' | 'bodyState' | 'mood' | 'sleep' | 'constipation' | 'exercise';
    period?: string;
  };
  Settings: undefined;
  MedicationManage: undefined;
  FamilyLink: undefined;
  ProfileEdit: undefined;
  Terms: undefined;
  Privacy: undefined;
  VideoList: undefined;
};

const Stack = createStackNavigator<MenuStackParamList>();

export function MenuNavigator() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="MenuHome" component={MenuScreen} />
      <Stack.Screen name="Records" component={RecordsScreen} />
      <Stack.Screen name="RecordDetail" component={RecordDetailScreen} />
      <Stack.Screen name="Settings" component={SettingsScreen} />
      <Stack.Screen name="MedicationManage" component={MedicationManageScreen} />
      <Stack.Screen name="FamilyLink" component={FamilyLinkScreen} />
      <Stack.Screen name="ProfileEdit" component={ProfileEditScreen} />
      <Stack.Screen name="Terms" component={TermsScreen} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} />
      <Stack.Screen name="VideoList" component={VideoListScreen} />
    </Stack.Navigator>
  );
}
