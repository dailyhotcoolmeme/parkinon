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
  // notifId → 등록 timestamp. 60초 TTL — 화면이 모달을 못 띄웠을 때
  // 사용자가 같은 알림 재탭하면 복구 가능하도록 안전망 도입.
  const handledNotifIds = useRef<Map<string, number>>(new Map());
  const DEDUPE_TTL_MS = 60_000;
  // 멀티 알림 race 방지용 mutex 큐 — handleNotificationResponse를 직렬화한다.
  // 두 알림이 거의 동시에 탭되어 두 navigateTo가 연속 호출되면 마지막만 살아남는 문제 회피.
  const handlerQueueRef = useRef<Promise<void>>(Promise.resolve());

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
      // dedupe 검사만 먼저 수행. 등록은 navigate 성공 직후로 이동하여
      // waitForNavReady 실패/예외 시 동일 알림 재시도가 가능하도록 함.
      const prevTs = handledNotifIds.current.get(notifId);
      if (prevTs && Date.now() - prevTs < DEDUPE_TTL_MS) return;

      const content = response.notification.request.content;
      const data = (content.data ?? {}) as Record<string, any>;
      const type = data?.type as string | undefined;

      // 페이로드 키 호환 처리
      // - medication_reminder / missed_medication: 'mealTime' (camelCase) 사용
      // - effect_tracking: 'meal_time' (snake_case) 사용
      // 양쪽 다 받도록 fallback
      const mealTime: string | null = data?.mealTime ?? data?.meal_time ?? null;
      const triggerMinutes: number | null =
        typeof data?.minutes === 'number' ? data.minutes : null;

      // 탭한 알림 읽음 처리 → 배지 갱신 (await로 race 방지)
      try {
        await saveNotification(
          type ?? '',
          content.title ?? '',
          content.body ?? '',
          data,
          new Date().toISOString(),
        );
        refreshBadge();
      } catch (e) {
        console.error('[App] saveNotification 실패:', e);
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
        const ready = await waitForNavReady();
        if (!ready) return;
      }

      // ─── 알림 trigger 채널 통일 (2026-05 재설계) ───
      // 모든 알림 타입은 "AsyncStorage 단일 채널"만 사용한다.
      // App.tsx는 setItem(await) → navigateTo(탭만) → 끝.
      // 화면 useFocusEffect가 AsyncStorage만 읽고 모달/스택 push.
      // route.params(triggerMinutes/triggerMealTime/triggerTs)는 더 이상 사용하지 않는다.
      // 이로써 두 채널 동시 publish로 인한 race가 원천 차단된다.
      try {
        if (type === 'medication_reminder' || type === 'missed_medication') {
          try {
            await AsyncStorage.setItem(
              'pendingMedNotif',
              JSON.stringify({ mealTime }),
            );
          } catch {}
          navigateTo('Main', { screen: 'Medication' });
        } else if (type === 'effect_tracking') {
          try {
            await AsyncStorage.setItem(
              'pendingBodyStateNotif',
              JSON.stringify({
                triggerMinutes,
                triggerMealTime: mealTime,
              }),
            );
          } catch {}
          navigateTo('Main', {
            screen: 'BodyStateTab',
            params: { screen: 'BodyState' },
          });
        } else if (type === 'exercise_reminder') {
          try {
            await AsyncStorage.setItem('pendingExerciseNotif', 'true');
          } catch {}
          navigateTo('Main', {
            screen: 'Exercise',
            params: { screen: 'ExerciseMain' },
          });
        } else if (type) {
          navigateTo('Main');
        }

        // navigate 호출 성공 직후 dedupe 등록 (timestamp).
        // 60초 TTL 후 자동 만료 → 화면이 모달을 못 띄웠을 때 재탭으로 복구 가능.
        // 실패(throw) 시에는 등록되지 않으므로 다음 listener에서 재시도 가능.
        handledNotifIds.current.set(notifId, Date.now());
        // map이 무한히 커지지 않도록 TTL 만료된 entry 정리
        const cutoff = Date.now() - DEDUPE_TTL_MS;
        for (const [k, ts] of handledNotifIds.current) {
          if (ts < cutoff) handledNotifIds.current.delete(k);
        }
      } catch (e) {
        console.error('[App] navigate 실패, dedupe 미등록(재시도 허용):', e);
      }
    },
    [saveNotification, refreshBadge],
  );

  // 알림 응답을 mutex 큐에 enqueue하여 직렬화한다.
  // 두 알림이 거의 동시에 탭될 때 navigateTo가 연속 호출되면서
  // 마지막 navigate만 살아남고 첫 번째 화면이 mount조차 안 되는 문제를 막는다.
  // 각 핸들러 종료 후 350ms settle delay를 둬서 navigation/focus가 안정될 시간을 확보.
  const enqueueHandler = useCallback(
    (response: Notifications.NotificationResponse, isCold: boolean) => {
      handlerQueueRef.current = handlerQueueRef.current
        .then(async () => {
          await handleNotificationResponse(response, isCold);
          // settle delay — useFocusEffect/탭 전환이 완료될 시간 확보
          // 200ms로 단축: 단일 채널 단순화로 처리가 빨라져 350ms는 과함
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        })
        .catch((e) => {
          console.warn('[App] handler queue 처리 실패:', e);
        });
    },
    [handleNotificationResponse],
  );

  // 앱이 종료된 상태에서 알림 탭 → 앱 실행 시 lastNotificationResponse 처리
  const lastResponse = Notifications.useLastNotificationResponse();
  useEffect(() => {
    if (!lastResponse) return;
    enqueueHandler(lastResponse, true);
  }, [lastResponse, enqueueHandler]);

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
    // mutex 큐로 직렬화: 멀티 알림 동시 탭 race 방지
    const notifSubscription = Notifications.addNotificationResponseReceivedListener((response) => {
      enqueueHandler(response, false);
    });

    const appStateSubscription = AppState.addEventListener('change', (nextAppState: AppStateStatus) => {
      const prev = appState.current;
      appState.current = nextAppState;
      // background → active 전환 시 stale pending 알림 플래그 안전망
      // 60초 후에도 화면이 처리하지 못했다면 자동 정리.
      // 약/몸상태/운동 모두 동일하게 적용. user/auth 로드 + transition 시간 충분히 확보.
      if (prev !== 'active' && nextAppState === 'active') {
        setTimeout(() => {
          ['pendingExerciseNotif', 'pendingMedNotif', 'pendingBodyStateNotif'].forEach((key) => {
            AsyncStorage.getItem(key)
              .then((val) => {
                if (val) {
                  console.log(`[App] stale ${key} 감지 → 자동 정리`);
                  AsyncStorage.removeItem(key).catch(() => {});
                }
              })
              .catch(() => {});
          });
        }, 60000);
      }
    });

    return () => {
      foregroundSubscription.remove();
      notifSubscription.remove();
      appStateSubscription.remove();
    };
  }, [saveNotification, enqueueHandler]);

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
