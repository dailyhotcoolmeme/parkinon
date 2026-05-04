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

      try {
        if (type === 'medication_reminder' || type === 'missed_medication') {
          // AsyncStorage write 완료 보장 후 navigateTo (콜드스타트 fallback)
          try {
            await AsyncStorage.setItem(
              'pendingMedNotif',
              JSON.stringify({ mealTime }),
            );
          } catch {}
          navigateTo('Main', {
            screen: 'Medication',
            params: { mealTime },
          });
          // 약복용 trigger 채널 단일화: AsyncStorage pendingMedNotif → useFocusEffect 한 곳만.
          // route.params.autoOpen, notificationIntentManager.emit, InteractionManager,
          // setShow(false→rAF→true) 패턴 모두 제거 (race 원천 차단).
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
            params: {
              screen: 'BodyState',
              params: {
                triggerMinutes,
                triggerMealTime: mealTime,
                triggerTs: Date.now(),
              },
            },
          });
        } else if (type === 'exercise_reminder') {
          // 이중 경로:
          // 1) AsyncStorage 플래그(fallback) — 콜드스타트/예외 케이스 대비
          // 2) nested navigate로 ExerciseRecord 직접 진입 — 약효추적과 동일한 패턴
          // mutex 큐(handlerQueueRef)로 직렬화되므로 워밍 케이스에서도 안전.
          try {
            await AsyncStorage.setItem('pendingExerciseNotif', 'true');
          } catch {}
          // triggerTs는 ExerciseMain(=ExerciseScreen)의 route.params로 들어가야
          // useFocusEffect의 빠른 경로가 발화하여 navigation.push('ExerciseRecord')를 호출한다.
          // 이전엔 inner=ExerciseRecord로 들어가서 ExerciseMain.params는 항상 비어있는 데드코드였음.
          navigateTo('Main', {
            screen: 'Exercise',
            params: {
              screen: 'ExerciseMain',
              params: { triggerTs: Date.now() },
            },
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
          await new Promise<void>((resolve) => setTimeout(resolve, 350));
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
      // background → active 전환 시 stale pendingExerciseNotif 안전망
      // 다른 알림(약효추적/약복용)이 운동 알림보다 늦게 처리되어 Exercise 탭이 활성화되지
      // 않은 채 영구 잔존하는 케이스 방지. 15초 후에도 ExerciseScreen이 처리하지 못했으면
      // 자동 정리. 콜드스타트 user/auth 로드 + 화면 transition + useFocusEffect 발화에
      // 5초로는 부족해 race가 발생했음 → 15초로 충분한 여유 확보.
      if (prev !== 'active' && nextAppState === 'active') {
        setTimeout(() => {
          AsyncStorage.getItem('pendingExerciseNotif')
            .then((val) => {
              if (val === 'true') {
                console.log('[App] stale pendingExerciseNotif 감지 → 자동 정리');
                AsyncStorage.removeItem('pendingExerciseNotif').catch(() => {});
              }
            })
            .catch(() => {});
        }, 15000);
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
