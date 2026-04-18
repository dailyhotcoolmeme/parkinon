import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import * as Notifications from 'expo-notifications';
import { navigateTo } from './src/navigation/navigationRef';
import { checkAndPromptNotificationPermission } from './src/utils/notifications';

export default function App() {
  const appState = useRef<AppStateStatus>(AppState.currentState);

  useEffect(() => {
    // 알림 탭 핸들러 (앱이 열려있거나 백그라운드에서 탭할 때)
    const notifSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const data = response.notification.request.content.data as Record<string, any>;
      const type = data?.type;

      if (type === 'medication_reminder' || type === 'missed_medication') {
        navigateTo('Main', { screen: 'Medication' });
      } else if (type === 'effect_tracking') {
        navigateTo('Main', { screen: 'BodyStateTab' });
      } else if (type === 'exercise_reminder') {
        navigateTo('Main', { screen: 'Exercise' });
      } else {
        navigateTo('Main');
      }
    });

    // 앱이 백그라운드 → 포어그라운드로 돌아올 때 알림 권한 상태 확인
    // 시스템 설정에서 차단한 경우 안내 Alert 표시
    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      if (
        appState.current.match(/inactive|background/) &&
        nextAppState === 'active'
      ) {
        checkAndPromptNotificationPermission().catch(console.warn);
      }
      appState.current = nextAppState;
    });

    return () => {
      notifSubscription.remove();
      appStateSubscription.remove();
    };
  }, []);

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <AuthProvider>
          <SettingsProvider>
            <RootNavigator />
          </SettingsProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
