import React, { useEffect, useRef } from 'react';
import { AppState, AppStateStatus, StatusBar } from 'react-native';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { NotificationBadgeProvider, useNotificationBadge } from './src/context/NotificationBadgeContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import * as Notifications from 'expo-notifications';
import { navigateTo } from './src/navigation/navigationRef';
import * as Updates from 'expo-updates';
import { supabase } from './src/lib/supabase';
import { requestPermissionsAndSaveToken } from './src/utils/notifications';
import { notificationIntentManager } from './src/utils/NotificationIntentManager';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Android 알림 채널 — MAX 중요도 (Doze 모드에서도 즉시 표시)
Notifications.setNotificationChannelAsync('default', {
  name: '파킨온 알림',
  importance: Notifications.AndroidImportance.MAX,
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#4CAF50',
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  bypassDnd: false,
  enableLights: true,
  enableVibrate: true,
});

// 알림 리스너는 NotificationBadgeProvider 내부에서 접근해야 context를 쓸 수 있음
function AppInner() {
  const appState = useRef<AppStateStatus>(AppState.currentState);
  const { saveNotification, refreshBadge } = useNotificationBadge();
  const handledNotifIds = useRef<Set<string>>(new Set());

  // 앱 시작 시마다 push_token DB 갱신 (세션이 있는 경우 무조건 시도)
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          await requestPermissionsAndSaveToken(session.user.id, session.access_token);
        }
      } catch (e) {
        console.error('[App] push token 초기화 실패:', e);
      }
    })();
  }, []);

  // 앱 시작 시 OTA 업데이트 체크
  useEffect(() => {
    async function checkForUpdates() {
      if (!__DEV__) {
        try {
          console.log('[OTA] 업데이트 체크 중...');
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            console.log('[OTA] 업데이트 발견! 다운로드 중...');
            await Updates.fetchUpdateAsync();
            console.log('[OTA] 다운로드 완료, 앱 재시작 중...');
            await Updates.reloadAsync();
          } else {
            console.log('[OTA] 최신 버전입니다.');
          }
        } catch (e) {
          console.error('[OTA] 업데이트 체크 실패:', e);
        }
      }
    }
    checkForUpdates();
  }, []);

  // 앱이 종료된 상태에서 알림 탭 → 앱 실행 시 lastNotificationResponse 처리
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    const notifId = lastResponse.notification.request.identifier;
    if (handledNotifIds.current.has(notifId)) return;
    handledNotifIds.current.add(notifId);

    const content = lastResponse.notification.request.content;
    const data = (content.data ?? {}) as Record<string, any>;
    const type = data?.type as string | undefined;

    // 탭한 알림 읽음 처리 → 완료 후 배지 갱신
    saveNotification(
      type ?? '',
      content.title ?? '',
      content.body ?? '',
      data,
      new Date().toISOString(),
    ).then(() => refreshBadge());

    // navigation이 준비될 때까지 폴링 후 이동 (앱 콜드 스타트 시 nav 초기화 지연 대응)
    const tryNavigate = (retryCount = 0) => {
      const { navigationRef: navRef } = require('./src/navigation/navigationRef');
      if (!navRef.isReady()) {
        if (retryCount < 20) {
          setTimeout(() => tryNavigate(retryCount + 1), 100);
        }
        return;
      }
      if (type === 'medication_reminder' || type === 'missed_medication') {
        AsyncStorage.setItem('pendingMedNotif', JSON.stringify({ mealTime: data?.mealTime ?? null }));
        navigateTo('Main', {
          screen: 'Medication',
          params: { autoOpen: Date.now(), mealTime: data?.mealTime ?? null },
        });
        notificationIntentManager.emit({ mealTime: data?.mealTime ?? null });
      } else if (type === 'effect_tracking') {
        navigateTo('Main', {
          screen: 'BodyStateTab',
          params: {
            screen: 'BodyState',
            params: { triggerMinutes: data?.minutes ?? null, triggerMealTime: data?.meal_time ?? null, triggerTs: Date.now() },
          },
        });
      } else if (type === 'exercise_reminder') {
        navigateTo('Main', { screen: 'Exercise', params: { screen: 'ExerciseRecord' } });
      } else if (type) {
        navigateTo('Main');
      }
    };
    tryNavigate();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastResponse]);

  useEffect(() => {
    // 포그라운드 알림 수신 → 저장 (read_at = null: 미읽음)
    const foregroundSubscription = Notifications.addNotificationReceivedListener((notification) => {
      const content = notification.request.content;
      const data = (content.data ?? {}) as Record<string, any>;
      saveNotification(
        data?.type ?? '',
        content.title ?? '',
        content.body ?? '',
        data,
        null,
      );
    });

    // 알림 탭 핸들러 (앱이 열려있거나 백그라운드에서 탭할 때)
    const notifSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      const notifId = response.notification.request.identifier;
      if (handledNotifIds.current.has(notifId)) return;
      handledNotifIds.current.add(notifId);

      const content = response.notification.request.content;
      const data = (content.data ?? {}) as Record<string, any>;
      const type = data?.type;

      // 탭한 알림 저장 (read_at = 현재 시각: 탭하는 순간 읽음 처리) → 완료 후 배지 갱신
      saveNotification(
        type ?? '',
        content.title ?? '',
        content.body ?? '',
        data,
        new Date().toISOString(),
      ).then(() => refreshBadge());

      if (type === 'medication_reminder' || type === 'missed_medication') {
        AsyncStorage.setItem('pendingMedNotif', JSON.stringify({ mealTime: data?.mealTime ?? null }));
        navigateTo('Main', {
          screen: 'Medication',
          params: { autoOpen: Date.now(), mealTime: data?.mealTime ?? null },
        });
        notificationIntentManager.emit({ mealTime: data?.mealTime ?? null });
      } else if (type === 'effect_tracking') {
        navigateTo('Main', {
          screen: 'BodyStateTab',
          params: {
            screen: 'BodyState',
            params: { triggerMinutes: data?.minutes ?? null, triggerMealTime: data?.meal_time ?? null, triggerTs: Date.now() },
          },
        });
      } else if (type === 'exercise_reminder') {
        navigateTo('Main', { screen: 'Exercise', params: { screen: 'ExerciseRecord' } });
      } else {
        navigateTo('Main');
      }
    });

    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      appState.current = nextAppState;
    });

    return () => {
      foregroundSubscription.remove();
      notifSubscription.remove();
      appStateSubscription.remove();
    };
  }, [saveNotification]);

  return (
    <SettingsProvider>
      <RootNavigator />
    </SettingsProvider>
  );
}

export default function App() {
  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#FFFFFF"
      />
      <SafeAreaProvider>
        <AuthProvider>
          <NotificationBadgeProvider>
            <AppInner />
          </NotificationBadgeProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
