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
import { isProcessed, markProcessed } from './src/utils/processedNotifIds';
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
  // 컨텐츠 기반 보조 dedupe: cold-start retry와 server_query가 다른 식별자를 가질 때
  // 같은 알림이 두 번 처리되는 race를 차단. key: `${type}:${mealTime}:${minute_bucket}`
  // value: 등록 시각 (TTL 만료 청소용)
  const handledContentKeys = useRef<Map<string, number>>(new Map());
  const backgroundEnteredAtRef = useRef<number | null>(null);
  const otaInFlightRef = useRef(false);

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

  // 앱 시작 시 OTA 업데이트 체크 → 발견 시 즉시 reload (cold-start 깜빡임 패턴)
  useEffect(() => {
    async function checkForUpdates() {
      if (!__DEV__) {
        try {
          console.log('[OTA] 업데이트 체크 중...');
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            console.log('[OTA] 업데이트 발견! 다운로드 중...');
            await Updates.fetchUpdateAsync();
            console.log('[OTA] 다운로드 완료. 재시작합니다.');
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

  // 백그라운드 30초+ 후 active 복귀 시 OTA 체크 + 적용
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (nextState) => {
      if (nextState === 'background' || nextState === 'inactive') {
        backgroundEnteredAtRef.current = Date.now();
        return;
      }

      if (nextState === 'active') {
        const enteredAt = backgroundEnteredAtRef.current;
        backgroundEnteredAtRef.current = null;

        // 백그라운드 30초 미만이면 skip
        if (!enteredAt || Date.now() - enteredAt < 30 * 1000) return;

        // 동시 호출 방지
        if (otaInFlightRef.current) return;
        otaInFlightRef.current = true;

        try {
          const update = await Updates.checkForUpdateAsync();
          if (update.isAvailable) {
            await Updates.fetchUpdateAsync();
            await Updates.reloadAsync();
          }
        } catch {
          // silent
        } finally {
          otaInFlightRef.current = false;
        }
      }
    });
    return () => sub.remove();
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

      // Freshness 체크: stale 알림 응답 차단 (어제 알림이 오늘 cold start에 잘못 트리거되는 케이스)
      // expo-notifications가 getLastNotificationResponseAsync에서 과거 응답을 캐시 반환하는 결함 방어.
      const _notifDateRaw: any = (response as any)?.notification?.date;
      const _notifDateMs: number | null =
        typeof _notifDateRaw === 'number'
          ? _notifDateRaw
          : _notifDateRaw
          ? new Date(_notifDateRaw).getTime()
          : null;
      if (_notifDateMs && !Number.isNaN(_notifDateMs)) {
        const ageMs = Date.now() - _notifDateMs;
        if (ageMs > 5 * 60 * 1000) {
          log('notification_too_old', {
            ageMs,
            notifDate: _notifDateMs,
            notifId,
          });
          return;
        }
      }

      // 영구 dedupe (AsyncStorage TTL 7일): 다른 세션 cold start에서 같은 notifId 재진입 차단.
      // in-memory handledNotifIds Set은 프로세스 종료 시 사라지므로 보조 안전망.
      if (await isProcessed(notifId)) {
        log('persistent_dedupe_blocked', { notifId });
        return;
      }

      // dedupe race 차단: 등록을 handler 진입 직후(첫 await 전)로 이동.
      // 기존엔 navigate 성공 후에만 등록 → cold + fallback 핸들러가 동시 실행되면
      // 두 번째 핸들러가 dedupe_check 통과 → setItem/navigate 중복 발생.
      // 등록 시점을 앞당기고, 처리 중 실패 시 unregister하여 재시도 가능 유지.
      if (handledNotifIds.current.has(notifId)) {
        log('dedupe_check', { blocked: true, by: 'notifId' });
        return;
      }

      // 컨텐츠 기반 보조 dedupe (cold-start retry vs server_query 식별자 불일치 race)
      // 30초 윈도우 내 같은 (type, mealTime) 알림은 한 번만 처리
      const _mealTimeForKey: string =
        (data?.mealTime ?? data?.meal_time ?? '') as string;
      const _typeForKey: string = (type ?? 'unknown') as string;
      const _minuteBucket = Math.floor(Date.now() / 30000);
      const contentKey = `${_typeForKey}:${_mealTimeForKey}:${_minuteBucket}`;

      // TTL 청소 (60초 초과 entry 제거 — 메모리 누수 방지)
      const _now = Date.now();
      for (const [k, ts] of handledContentKeys.current.entries()) {
        if (_now - ts > 60000) handledContentKeys.current.delete(k);
      }

      if (handledContentKeys.current.has(contentKey)) {
        log('dedupe_check', { blocked: true, by: 'contentKey', contentKey });
        log('dedupe_content_key_blocked', { contentKey, notifId });
        return;
      }

      log('dedupe_check', { blocked: false, contentKey });
      handledNotifIds.current.add(notifId);
      handledContentKeys.current.set(contentKey, _now);
      let dedupeRegistered = true;

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
          // dedupe 해제 — 다음 시도(예: warm listener) 허용
          if (dedupeRegistered) {
            handledNotifIds.current.delete(notifId);
            handledContentKeys.current.delete(contentKey);
            dedupeRegistered = false;
          }
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

        // 정상 처리 완료 — dedupe 등록은 handler_enter 직후에 이미 됨.
        // 영구 dedupe 마킹 (AsyncStorage, TTL 7일) — navigate 성공 후에만 기록하여
        // 실패 시 재시도 가능하도록 유지.
        markProcessed(notifId).catch(() => {});
        log('handler_exit', { success: true });
      } catch (e: any) {
        // 실패 시 dedupe 해제 → 다음 listener에서 재시도 가능
        if (dedupeRegistered) {
          handledNotifIds.current.delete(notifId);
          handledContentKeys.current.delete(contentKey);
          dedupeRegistered = false;
        }
        console.error('[App] navigate 실패, dedupe 해제(재시도 허용):', e);
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

    // Fallback 1: 콜드스타트 시 useLastNotificationResponse 누락 대비 명시 호출 + 재시도/백오프
    // (영웅문#·삼성인터넷 등 무거운 앱과 함께 사용 시 listener race로 hook이 발화 안 하는 케이스)
    // expo-notifications cold start race: 첫 호출 시 null 반환되는 케이스를 위한 재시도
    // 시도 시점: 0ms, 500ms, 1500ms, 3000ms (총 4번)
    // dedupe(handledNotifIds)가 중복 처리 차단
    let _coldStartCancelled = false;
    // userId resolution을 두 경로가 공유 (병렬 실행 위해 promise로)
    const _fbUserIdPromise: Promise<string | null> = (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        return session?.user?.id ?? null;
      } catch {
        return null;
      }
    })();

    // 경로 A: cold-start retry 루프 (0/500/1500/3000ms, 4회)
    (async () => {
      const _fbUserId = await _fbUserIdPromise;
      const intervals = [0, 500, 1500, 3000];
      for (let i = 0; i < intervals.length; i++) {
        if (_coldStartCancelled) return;
        if (i > 0) {
          await new Promise((r) => setTimeout(r, intervals[i] - intervals[i - 1]));
        }
        if (_coldStartCancelled) return;

        const attempt = i + 1;
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_cold_start_check',
          payload: { stage: 'enter', attempt },
        }).catch(() => {});

        try {
          const response = await Notifications.getLastNotificationResponseAsync();
          logNotificationEvent({
            userId: _fbUserId,
            event: 'fallback_cold_start_result',
            payload: {
              attempt,
              hasResponse: response !== null,
              notifId: response?.notification?.request?.identifier ?? null,
              type: response?.notification?.request?.content?.data?.type ?? null,
            },
          }).catch(() => {});
          if (response) {
            // Freshness 1차 차단 (이중 안전망): 5분 이상 오래된 응답이면 handler 진입 자체를 막음.
            const _rDateRaw: any = (response as any)?.notification?.date;
            const _rDateMs: number | null =
              typeof _rDateRaw === 'number'
                ? _rDateRaw
                : _rDateRaw
                ? new Date(_rDateRaw).getTime()
                : null;
            if (_rDateMs && !Number.isNaN(_rDateMs)) {
              const ageMs = Date.now() - _rDateMs;
              if (ageMs > 5 * 60 * 1000) {
                logNotificationEvent({
                  userId: _fbUserId,
                  event: 'notification_too_old',
                  payload: {
                    ageMs,
                    notifDate: _rDateMs,
                    notifId: response?.notification?.request?.identifier ?? null,
                    source: 'cold_start_retry',
                  },
                }).catch(() => {});
                return;
              }
            }
            await handleNotificationResponse(response, true);
            return;
          }
        } catch (e) {
          // silent — 다음 시도로 넘어감
        }
      }
    })();

    // 경로 B (서버 폴백): cold-start retry와 병렬로 즉시 발사.
    // 4.2초 retry 직렬 → 약 0.5초 단축 효과. 두 경로 모두 enqueue 시
    // handledNotifIds(60s TTL) dedupe로 중복 처리 차단됨.
    // notification_logs 최근 3분 이내 미읽음이 정확히 1건일 때만 처리.
    (async () => {
      const _fbUserId = await _fbUserIdPromise;
      if (_coldStartCancelled) return;
      if (!_fbUserId) return;

      logNotificationEvent({
        userId: _fbUserId,
        event: 'fallback_server_query_check',
        payload: { stage: 'enter' },
      }).catch(() => {});

      try {
        const sinceIso = new Date(Date.now() - 3 * 60 * 1000).toISOString();
        const { data: rows, error } = await supabase
          .from('notification_logs')
          .select('id, type, title, body, data, created_at')
          .eq('user_id', _fbUserId)
          .is('read_at', null)
          .gte('created_at', sinceIso)
          .order('created_at', { ascending: false });

        if (error) throw error;
        if (_coldStartCancelled) return;

        const count = rows?.length ?? 0;
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_server_query_result',
          payload: {
            count,
            type: rows?.[0]?.type ?? null,
            notifId: rows?.[0]?.id ?? null,
          },
        }).catch(() => {});

        if (count === 0) {
          logNotificationEvent({
            userId: _fbUserId,
            event: 'fallback_server_query_skipped',
            payload: { reason: 'no_match' },
          }).catch(() => {});
          return;
        }
        if (count > 1) {
          logNotificationEvent({
            userId: _fbUserId,
            event: 'fallback_server_query_skipped',
            payload: { reason: 'ambiguous', count },
          }).catch(() => {});
          return;
        }

        // 정확히 1건 → handleNotificationResponse와 동일 처리 (fake response 합성)
        // cold-start retry가 먼저 같은 notifId를 처리한 경우 handledNotifIds dedupe로 차단
        const row = rows![0];
        // 식별자 통일 시도: data 컬럼에 FCM messageId가 있으면 cold-start retry와 일치시켜
        // 첫 번째(notifId) dedupe로 차단되도록 함. 없으면 DB UUID fallback.
        const _rowData = (row.data ?? {}) as Record<string, any>;
        const _fcmId: string | null =
          (_rowData?.messageId as string) ||
          (_rowData?._messageId as string) ||
          (_rowData?.fcmMessageId as string) ||
          (_rowData?.fcmId as string) ||
          null;
        const _identifier = _fcmId || row.id;
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_server_query_identifier',
          payload: {
            usedFcmId: !!_fcmId,
            identifier: _identifier,
            rowId: row.id,
          },
        }).catch(() => {});
        const fakeResponse = {
          notification: {
            date: Date.now(),
            request: {
              identifier: _identifier,
              content: {
                title: row.title ?? '',
                body: row.body ?? '',
                data: row.data ?? {},
              },
              trigger: null,
            },
          },
          actionIdentifier: 'default',
        } as unknown as Notifications.NotificationResponse;

        await handleNotificationResponse(fakeResponse, true);
      } catch (e) {
        logNotificationEvent({
          userId: _fbUserId,
          event: 'fallback_server_query_skipped',
          payload: { reason: 'error', error: String((e as any)?.message ?? e) },
        }).catch(() => {});
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
      _coldStartCancelled = true;
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
