import React, { useCallback, useEffect, useRef } from 'react';
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
import { logNotificationEvent } from './src/utils/notificationDebugLog';
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

  // 부팅 시 OTA 번들 정보 로깅 (mount 시 1회 — 적용 검증용)
  useEffect(() => {
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const userId = session?.user?.id ?? null;
        if (!userId) return;
        await logNotificationEvent({
          userId,
          event: 'app_boot',
          payload: {
            updateId: Updates.updateId,
            runtimeVersion: Updates.runtimeVersion,
            channel: Updates.channel,
            isEmbeddedLaunch: Updates.isEmbeddedLaunch,
            createdAt: Updates.createdAt?.toISOString() ?? null,
          },
        });
      } catch {
        // silent
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

  // 알림 응답 공통 핸들러 — useLastNotificationResponse(콜드스타트)와
  // addNotificationResponseReceivedListener(워밍/포그라운드)에서 동일하게 호출.
  // - dedupe (handledNotifIds Set)
  // - 알림 읽음 저장 + 배지 갱신
  // - AsyncStorage write를 await로 보장 후 navigateTo (race 방지)
  // - 페이로드 키 호환: mealTime(camel) || meal_time(snake)
  const handleNotificationResponse = useCallback(
    async (
      response: Notifications.NotificationResponse,
      isColdStart: boolean,
    ) => {
      const notifId = response.notification.request.identifier;
      const content = response.notification.request.content;
      const data = (content.data ?? {}) as Record<string, any>;
      const type = data?.type as string | undefined;

      // 디버그 로깅용 user_id (한 번만 fetch)
      let _debugUserId: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        _debugUserId = session?.user?.id ?? null;
      } catch {}
      const log = (event: string, payload?: any) => {
        logNotificationEvent({
          userId: _debugUserId,
          notifId,
          notifType: type,
          event,
          payload,
          isColdStart,
        }).catch(() => {});
      };

      log('handler_enter', {
        title: content.title,
        body: content.body,
        data,
      });

      // dedupe 검사만 먼저 수행. 등록은 navigate 성공 직후로 이동하여
      // waitForNavReady 실패/예외 시 동일 알림 재시도가 가능하도록 함.
      if (handledNotifIds.current.has(notifId)) {
        log('dedupe_check', { blocked: true });
        return;
      }
      log('dedupe_check', { blocked: false });

      // 페이로드 키 호환 처리
      // - medication_reminder / missed_medication: 'mealTime' (camelCase) 사용
      // - effect_tracking: 'meal_time' (snake_case) 사용
      // 양쪽 다 받도록 fallback
      const mealTime: string | null = data?.mealTime ?? data?.meal_time ?? null;
      const triggerMinutes: number | null =
        typeof data?.minutes === 'number' ? data.minutes : null;

      // 탭한 알림 읽음 처리 → 배지 갱신 (await로 race 방지)
      log('save_notification_start', { mealTime, triggerMinutes });
      try {
        await saveNotification(
          type ?? '',
          content.title ?? '',
          content.body ?? '',
          data,
          new Date().toISOString(),
        );
        refreshBadge();
        log('save_notification_done', { success: true });
      } catch (e: any) {
        console.error('[App] saveNotification 실패:', e);
        log('save_notification_done', { success: false, error: String(e?.message ?? e) });
      }

      // navigation이 준비될 때까지 폴링 (콜드스타트 nav 초기화 지연 대응)
      const waitForNavReady = (): Promise<boolean> =>
        new Promise((resolve) => {
          const tryReady = (retryCount = 0) => {
            const { navigationRef: navRef } = require('./src/navigation/navigationRef');
            if (navRef.isReady()) {
              resolve(true);
              return;
            }
            if (retryCount >= 20) {
              resolve(false);
              return;
            }
            setTimeout(() => tryReady(retryCount + 1), 100);
          };
          tryReady();
        });

      if (isColdStart) {
        log('wait_nav_ready_start');
        const ready = await waitForNavReady();
        log('wait_nav_ready_done', { ready });
        if (!ready) {
          log('handler_exit', { reason: 'nav_not_ready' });
          return;
        }
      }

      try {
        if (type === 'medication_reminder' || type === 'missed_medication') {
          log('branch_match', { branch: 'medication' });
          // AsyncStorage write 완료 보장 후 navigateTo (콜드스타트 fallback)
          try {
            // cross-type stale cleanup: 다른 타입의 잔존 pending 키 제거
            await AsyncStorage.multiRemove(['pendingBodyStateNotif', 'pendingExerciseNotif']);
            log('multi_remove', { keys: ['pendingBodyStateNotif', 'pendingExerciseNotif'], success: true });
            const value = JSON.stringify({ mealTime, ts: Date.now() });
            await AsyncStorage.setItem('pendingMedNotif', value);
            log('set_item', { key: 'pendingMedNotif', value, success: true });
          } catch (e: any) {
            log('set_item', { success: false, error: String(e?.message ?? e) });
          }
          const navArgs = { screen: 'Medication', params: { autoOpen: Date.now(), mealTime } };
          log('navigate_start', { target: 'Main', args: navArgs });
          navigateTo('Main', navArgs);
          notificationIntentManager.emit({ mealTime });
        } else if (type === 'effect_tracking') {
          log('branch_match', { branch: 'effect_tracking' });
          try {
            // cross-type stale cleanup
            await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingExerciseNotif']);
            log('multi_remove', { keys: ['pendingMedNotif', 'pendingExerciseNotif'], success: true });
            const value = JSON.stringify({
              triggerMinutes,
              triggerMealTime: mealTime,
              ts: Date.now(),
            });
            await AsyncStorage.setItem('pendingBodyStateNotif', value);
            log('set_item', { key: 'pendingBodyStateNotif', value, success: true });
          } catch (e: any) {
            log('set_item', { success: false, error: String(e?.message ?? e) });
          }
          const navArgs = {
            screen: 'BodyStateTab',
            params: {
              screen: 'BodyState',
              params: {
                triggerMinutes,
                triggerMealTime: mealTime,
                triggerTs: Date.now(),
              },
            },
          };
          log('navigate_start', { target: 'Main', args: navArgs });
          navigateTo('Main', navArgs);
        } else if (type === 'exercise_reminder') {
          log('branch_match', { branch: 'exercise' });
          // pendingExerciseNotif 플래그를 먼저 저장 후 Exercise 탭으로만 전환.
          // ExerciseRecord 진입은 ExerciseScreen.useFocusEffect가 단일 경로로 처리한다.
          // (nested initial-route navigate가 워밍 케이스에서 무시되는 race 회피)
          try {
            // cross-type stale cleanup
            await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingBodyStateNotif']);
            log('multi_remove', { keys: ['pendingMedNotif', 'pendingBodyStateNotif'], success: true });
            await AsyncStorage.setItem('pendingExerciseNotif', 'true');
            log('set_item', { key: 'pendingExerciseNotif', value: 'true', success: true });
          } catch (e: any) {
            log('set_item', { success: false, error: String(e?.message ?? e) });
          }
          const navArgs = { screen: 'Exercise' };
          log('navigate_start', { target: 'Main', args: navArgs });
          navigateTo('Main', navArgs);
        } else if (type) {
          log('branch_match', { branch: 'other', type });
          log('navigate_start', { target: 'Main' });
          navigateTo('Main');
        } else {
          log('branch_match', { branch: 'no_type' });
        }

        // navigate 호출 성공 직후 dedupe 등록.
        // 실패(throw) 시에는 등록되지 않으므로 다음 listener에서 재시도 가능.
        handledNotifIds.current.add(notifId);
        log('handler_exit', { success: true });
      } catch (e: any) {
        console.error('[App] navigate 실패, dedupe 미등록(재시도 허용):', e);
        log('handler_exit', { success: false, error: String(e?.message ?? e) });
      }
    },
    [saveNotification, refreshBadge],
  );

  // 앱이 종료된 상태에서 알림 탭 → 앱 실행 시 lastNotificationResponse 처리
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    handleNotificationResponse(lastResponse, true).catch((e) =>
      console.error('[App] cold-start handler 실패:', e),
    );
  }, [lastResponse, handleNotificationResponse]);

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
      handleNotificationResponse(response, false).catch((e) =>
        console.error('[App] warm handler 실패:', e),
      );
    });

    // Fallback 1: 콜드스타트 시 useLastNotificationResponse 누락 대비 명시 호출
    // (영웅문#·삼성인터넷 등 무거운 앱과 함께 사용 시 listener race로 hook이 발화 안 하는 케이스)
    // dedupe(handledNotifIds)가 중복 처리 차단
    (async () => {
      // 디버그: fallback 진입 로깅
      let _fbUserId: string | null = null;
      try {
        const { data: { session } } = await supabase.auth.getSession();
        _fbUserId = session?.user?.id ?? null;
      } catch {}
      logNotificationEvent({
        userId: _fbUserId,
        event: 'fallback_cold_start_check',
        payload: { stage: 'enter' },
      }).catch(() => {});
      try {
        const response = await Notifications.getLastNotificationResponseAsync();
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_cold_start_result',
          payload: {
            hasResponse: response !== null,
            notifId: response?.notification?.request?.identifier ?? null,
            type: response?.notification?.request?.content?.data?.type ?? null,
          },
        }).catch(() => {});
        if (response) {
          await handleNotificationResponse(response, true);
        }
      } catch (e) {
        console.error('[App] getLastNotificationResponseAsync fallback 실패:', e);
      }
    })();

    const appStateSubscription = AppState.addEventListener('change', async (nextAppState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextAppState;
      // Fallback 2: background → active 전환 시 마지막 알림 응답 재확인
      // (백그라운드 listener가 race로 누락한 응답 회수, dedupe로 중복 차단)
      if (prev !== 'active' && nextAppState === 'active') {
        // 디버그: fallback 진입 로깅
        let _fbUserId: string | null = null;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          _fbUserId = session?.user?.id ?? null;
        } catch {}
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_appstate_active_check',
          payload: {
            fromState: prev,
            toState: nextAppState,
          },
        }).catch(() => {});
        try {
          const response = await Notifications.getLastNotificationResponseAsync();
          logNotificationEvent({
            userId: _fbUserId,
            event: 'fallback_appstate_active_result',
            payload: {
              hasResponse: response !== null,
              notifId: response?.notification?.request?.identifier ?? null,
              type: response?.notification?.request?.content?.data?.type ?? null,
            },
          }).catch(() => {});
          if (response) {
            await handleNotificationResponse(response, false);
          }
        } catch (e) {
          console.error('[App] AppState active fallback 실패:', e);
        }
      }
    });

    return () => {
      foregroundSubscription.remove();
      notifSubscription.remove();
      appStateSubscription.remove();
    };
  }, [saveNotification, handleNotificationResponse]);

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
