import React, { useCallback, useEffect, useRef } from 'react';
import { AppState, AppStateStatus, StatusBar } from 'react-native';
// i18n 뼈대 초기화(side-effect import). 최상위에서 한 번 실행되어 i18next를 준비.
// 순수 JS라 OTA 가능. 국내(기기 한국어)는 lng=ko라 동작 변화 없음.
import './src/i18n';
import i18n from './src/i18n';
// 해외 로케일 폰트 축소 패치(side-effect import). i18n 초기화 직후, 모든 화면 모듈이
// import되어 StyleSheet.create가 호출되기 전에 실행되어야 함.
// ⚠️ 현재 이 패치는 비활성 상태다(파일 내 주석 참고). 60대 타겟이라 글씨를 줄이지 않고
//    버튼이 늘어나도록 minHeight 로 해결하는 방향으로 정리했다(2026-07-29).
import './src/i18n/localeFontScale';
// 해외 언어인데 화면에 한글이 그려지면 개발 빌드에서 콘솔로 잡아낸다.
// i18n 미경유 하드코딩 한글을 소스 훑기(오탐 많음) 대신 실제 렌더로 검출한다.
import { installHangulGuard } from './src/i18n/hangulGuard';
import { installLayoutGuard } from './src/i18n/layoutGuard';
// 화면에 실제로 그려진 문구를 맥의 수집기로 보낸다(개발 빌드 전용).
// "어느 키가 아직 한 번도 안 떴는지"를 사람 기억이 아니라 숫자로 판정하기 위함.
import { installQaProbe } from './src/i18n/qaProbe';
// 순회는 로그인 이후에 시작한다(라우트가 준비돼야 하므로 내부에서 대기).
import { maybeRunQaWalk } from './src/i18n/qaWalk';

installQaProbe();
void maybeRunQaWalk();
installHangulGuard();
installLayoutGuard();
import { initAds } from './src/lib/ads';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AuthProvider } from './src/context/AuthContext';
import { NotificationBadgeProvider, useNotificationBadge } from './src/context/NotificationBadgeContext';
import { SubscriptionProvider } from './src/context/SubscriptionContext';
import { SettingsProvider } from './src/context/SettingsContext';
import { DialogProvider } from './src/context/DialogContext';
import { RootNavigator } from './src/navigation/RootNavigator';
import { OverlayHostProvider } from './src/components/common/OverlayHost';
import { ErrorBoundary, LAST_JS_ERROR_KEY } from './src/components/common/ErrorBoundary';
import * as Notifications from 'expo-notifications';
import { navigateTo, navigationRef } from './src/navigation/navigationRef';
import { initActivityLog } from './src/utils/activityLog';
import * as Updates from 'expo-updates';
import { useFonts } from 'expo-font';
import { supabase } from './src/lib/supabase';
import { requestPermissionsAndSaveToken } from './src/utils/notifications';
import { notificationIntentManager } from './src/utils/NotificationIntentManager';
import { logNotificationEvent } from './src/utils/notificationDebugLog';
import { isProcessed, markProcessed } from './src/utils/processedNotifIds';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Android 알림 채널 — MAX 중요도 (Doze 모드에서도 즉시 표시)
Notifications.setNotificationChannelAsync('default', {
  // ⚠️ 채널 이름은 안드로이드 시스템 설정(앱 → 알림)에 그대로 노출된다. 앱 언어를 따라야 한다.
  name: i18n.t('notifications.defaultChannelName'),
  importance: Notifications.AndroidImportance.MAX,
  vibrationPattern: [0, 250, 250, 250],
  lightColor: '#4CAF50',
  lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
  bypassDnd: false,
  enableLights: true,
  enableVibrate: true,
});

// 디지털 바이오마커 MVP-A Phase 4 — 약효추적 알림 액션 버튼 카테고리
// 'effect_tracking' 카테고리에 [바로 측정하기] 액션 1개 등록.
// iOS / Android 동일 적용. JS-only (OTA 가능 — Phase 0 검증 완료).
// Edge Function process-notification-queue가 푸시 payload에 categoryId='effect_tracking'을 포함하면
// 시스템 알림 UI에 액션 버튼이 노출되고, 사용자가 탭 시 handleNotificationResponse의
// response.actionIdentifier === 'measure_now' 분기로 측정 화면 직진입.
Notifications.setNotificationCategoryAsync('effect_tracking', [
  {
    identifier: 'measure_now',
    buttonTitle: i18n.t('notifications.measureNowAction'),
    options: {
      opensAppToForeground: true,
    },
  },
]).catch((e) => {
  console.warn('[App] effect_tracking 카테고리 등록 실패:', e);
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

  // 사용자 행동 로거 초기화(백그라운드 flush·포그라운드 기록 등록).
  useEffect(() => {
    initActivityLog();
  }, []);

  // 앱 시작 시 직전 세션에서 ErrorBoundary 가 잡은 마지막 JS 오류가 있으면 console.warn 으로 노출.
  //   → 렌더 단계 throw 로 앱이 닫혔던 경우, 다음 실행에서 폰 로그로 원인을 확인할 수 있게 한다.
  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(LAST_JS_ERROR_KEY);
        if (raw) {
          console.warn('[App] 직전 세션 JS 오류(ErrorBoundary 캡처):', raw);
        }
      } catch (e) {
        console.warn('[App] 마지막 JS 오류 조회 실패:', e);
      }
    })();
  }, []);

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

  // AdMob 초기화 (광고 로드 전 1회, 재빌드 전엔 no-op)
  useEffect(() => {
    initAds();
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

        // (성능) 알림 탭으로 막 복귀한 경우, OTA 체크의 네트워크가 알림 진입 임계 구간
        //   (navigate + 약효추적/복용 팝업 데이터 조회)과 경쟁해 진입을 지연시킬 수 있다.
        //   OTA 체크 자체는 그대로 유지하되(절대 제거 금지 — CLAUDE.md), 진입 직후가 아닌
        //   짧은 idle 후로만 미룬다. 발견 시 reload 동작은 동일.
        try {
          await new Promise((r) => setTimeout(r, 4000));
          // idle 대기 중 다시 백그라운드로 갔으면(현재 비활성) skip — 다음 복귀에서 재시도.
          if (AppState.currentState !== 'active') return;
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

      // 디버그 로깅용 user_id — (성능) navigate 를 막지 않도록 await 하지 않고 백그라운드 fetch.
      //   운영 빌드에선 logNotificationEvent 가 no-op 이라 이 값이 잠시 null 이어도 무방하다.
      let _debugUserId: string | null = null;
      void (async () => {
        try {
          const { data: { session } } = await supabase.auth.getSession();
          _debugUserId = session?.user?.id ?? null;
        } catch {}
      })();
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

      // ── 보호자 알림: 종류에 맞는 화면으로 이동만 (팝업/자동기록 없음). (오너 결정 2026-07-16) ──
      //   약 드심/미복용 → 약복용, 몸상태(변비·수면 등)·동작측정 → 약효추적(몸상태 탭), 운동 → 운동.
      //   보호자 알림은 자동기록이 없어 stale/자동선택 로직이 불필요하므로 여기서 바로 처리하고 종료한다.
      const CAREGIVER_NAV: Record<string, () => void> = {
        caregiver_medication: () => navigateTo('Main', { screen: 'Medication' }),
        caregiver_missed_med: () => navigateTo('Main', { screen: 'Medication' }),
        caregiver_body_state: () => navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } }),
        caregiver_exercise: () => navigateTo('Main', { screen: 'Exercise' }),
        measurement_completed: () => navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } }),
        // 환자가 "복약 시간 설정 요청" → 보호자를 환자 복용시간 설정 화면으로.
        caregiver_med_setup_request: () => navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedicationManage', params: { mode: 'slots' } } }),
        // 가족 일기 알림 → 그 날짜 일기 화면으로(환자·보호자 공통). data.date 로 진입.
        family_diary: () => navigateTo('Diary', data?.date ? { date: data.date } : undefined),
      };
      if (type && CAREGIVER_NAV[type]) {
        log('caregiver_nav_enter', { type });
        // dedupe: 같은 세션 재진입 + 콜드스타트 영구 dedupe
        if (handledNotifIds.current.has(notifId)) { log('caregiver_nav_dedupe', { by: 'notifId' }); return; }
        handledNotifIds.current.add(notifId);
        if (await isProcessed(notifId)) { log('caregiver_nav_dedupe', { by: 'processed' }); return; }
        // 읽음 처리(종 배지) — navigate 를 막지 않도록 fire-and-forget
        void (async () => {
          try {
            await saveNotification(type, content.title ?? '', content.body ?? '', data, new Date().toISOString());
            refreshBadge();
          } catch {}
        })();
        // 콜드스타트면 네비게이터 준비될 때까지 대기(최대 ~5초)
        if (isColdStart) {
          for (let i = 0; i < 50 && !navigationRef.isReady(); i++) await new Promise((r) => setTimeout(r, 100));
        }
        try { CAREGIVER_NAV[type](); } catch (e: any) { log('caregiver_nav_error', { error: String(e?.message ?? e) }); }
        markProcessed(notifId).catch(() => {});
        log('caregiver_nav_done', { type });
        return;
      }

      // Freshness 체크: stale 알림 응답 차단 (어제 알림이 오늘 cold start에 잘못 트리거되는 케이스)
      // expo-notifications가 getLastNotificationResponseAsync에서 과거 응답을 캐시 반환하는 결함 방어.
      const _notifDateRaw: any = (response as any)?.notification?.date;
      const _notifDateMs: number | null =
        typeof _notifDateRaw === 'number'
          ? _notifDateRaw
          : _notifDateRaw
          ? new Date(_notifDateRaw).getTime()
          : null;
      // 약 복용 계열 알림 식별 (medication 분기에 해당하는 타입 집합 — 아래 normal-path 분기와 동일)
      const _isMedicationType =
        type === 'medication_reminder' ||
        type === 'missed_medication' ||
        type === 'missed_medication_first' ||
        type === 'missed_medication_second';

      // 타입별 stale(soft-nav) 임계값.
      //   - 약 복용 계열(_isMedicationType): 면제(Infinity) — [버그수정 A]. 시트의 "○○약 드셨나요?"
      //       확인 다이얼로그(confirmAndRecordSlot)를 거치므로 자동기록 사고가 없어 안전.
      //   - 약효추적(effect_tracking): warm 탭은 사용자가 "방금" 누른 것이므로 알림 나이와 무관하게
      //       정상 처리해야 한다(Infinity). cold-start만 6시간 가드로 전날 캐시 재전달(어제 알림이
      //       오늘 cold start에 surfacing)을 막는다.
      //       · 안전성: 약효추적 normal 경로는 입력 팝업(BodyStatePopupFlow, 수동 점수 입력)을 열 뿐
      //         자동기록을 하지 않으므로 "자동기록 사고" 위험이 없다(과거 주석의 우려는 약효추적엔 무효).
      //       · 중복: 이미 탭/처리된 알림의 cold-start 재전달은 영구 isProcessed(아래 게이트)가 별도 차단.
      //       · [버그] 기존 5분 컷오프는 60대 환자가 알림을 5~12분 뒤 누르면(정상 행동) stale로 떨어져
      //         pendingBodyStateNotif·triggerMinutes 를 안 실어 BodyState 탭만 뜨고 팝업이 안 열렸다.
      //         (서버데이터: 6/28 저녁약 30분후 알림을 ~6~12분 뒤 탭 → soft-nav → on_off_logs 미기록 확인.)
      //   - 그 외 타입: 기존 5분 유지.
      const staleSoftNavMs = _isMedicationType
        ? Infinity
        : type === 'effect_tracking'
        ? (isColdStart ? 6 * 60 * 60 * 1000 : Infinity)
        : 5 * 60 * 1000;

      if (_notifDateMs && !Number.isNaN(_notifDateMs)) {
        const ageMs = Date.now() - _notifDateMs;
        if (ageMs > staleSoftNavMs) {
          // ── 오래된(stale) 알림 = "약한 처리(soft-nav)" ──
          // 묵은(예: 어제) 알림을 누른 경우, 자동선택/자동기록은 절대 하지 않는다
          //  (pendingMedNotif/emit/autoOpen, pendingBodyStateNotif, pendingExerciseNotif 세팅 안 함 →
          //   "지금 드셨나요?" 자동 팝업으로 잘못 기록되는 사고 방지 — 기존 안전 목적 유지).
          // 대신: ① 탭한 type에 맞는 탭/화면으로 일반 진입만 하고
          //       ② 그 알림을 읽음 처리해 종 배지에서 빠지게 하며
          //       ③ dedupe + markProcessed로 콜드스타트 무한 재시도를 막는다.
          // 전체를 try/catch로 감싸 절대 크래시 안 나게 한다.
          log('notification_too_old_soft_nav', {
            ageMs,
            notifDate: _notifDateMs,
            notifId,
            type,
          });
          try {
            // (a) 동기 dedupe — 같은 알림 동시/재진입 차단. isProcessed면 이미 처리됨 → 종료.
            if (handledNotifIds.current.has(notifId)) {
              log('soft_nav_dedupe_blocked', { by: 'notifId', notifId });
              return;
            }
            handledNotifIds.current.add(notifId);
            if (await isProcessed(notifId)) {
              log('soft_nav_persistent_dedupe_blocked', { notifId });
              return;
            }

            // (b) 읽음 처리 → 배지 정리 (자동기록과 무관, 안전)
            //   (성능) navigate 를 막지 않도록 fire-and-forget. 읽음·배지는 진입 뒤 반영돼도 무방.
            void (async () => {
              try {
                await saveNotification(
                  type ?? '',
                  content.title ?? '',
                  content.body ?? '',
                  data,
                  new Date().toISOString(),
                );
                refreshBadge();
                log('soft_nav_mark_read_done');
              } catch (readErr: any) {
                log('soft_nav_mark_read_failed', { error: String(readErr?.message ?? readErr) });
              }
            })();

            // (c) 콜드스타트면 nav 준비 대기 (warm은 이미 준비됨)
            if (isColdStart) {
              const ready = await (async (): Promise<boolean> =>
                new Promise((resolve) => {
                  const tryReady = (retryCount = 0) => {
                    const { navigationRef: navRef } = require('./src/navigation/navigationRef');
                    if (navRef.isReady()) return resolve(true);
                    if (retryCount >= 20) return resolve(false);
                    setTimeout(() => tryReady(retryCount + 1), 100);
                  };
                  tryReady();
                }))();
              if (!ready) {
                // nav 미준비 → dedupe 풀고 다음 경로(warm listener) 재시도 허용
                handledNotifIds.current.delete(notifId);
                log('soft_nav_exit', { reason: 'nav_not_ready' });
                return;
              }
            }

            // (d) 자동선택/자동기록 트리거 없이 탭/화면으로만 일반 진입
            //     (autoOpen·pending·emit 일절 세팅 안 함)
            if (
              type === 'medication_reminder' ||
              type === 'missed_medication' ||
              type === 'missed_medication_first' ||
              type === 'missed_medication_second'
            ) {
              log('soft_nav_navigate', { target: 'Medication' });
              navigateTo('Main', { screen: 'Medication' });
            } else if (type === 'effect_tracking') {
              log('soft_nav_navigate', { target: 'BodyState' });
              navigateTo('Main', { screen: 'BodyStateTab', params: { screen: 'BodyState' } });
            } else if (type === 'exercise_reminder') {
              log('soft_nav_navigate', { target: 'Exercise' });
              navigateTo('Main', { screen: 'Exercise' });
            } else if (type === 'appointment_reminder') {
              log('soft_nav_navigate', { target: 'MedicalRecordList' });
              navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedicalRecordList' } });
            } else {
              log('soft_nav_navigate', { target: 'Main' });
              navigateTo('Main');
            }

            // (e) 영구 dedupe 마킹 — 재진입(콜드스타트 재평가 등) 무한 처리 방지
            markProcessed(notifId).catch(() => {});
            log('soft_nav_exit', { success: true });
          } catch (e: any) {
            log('soft_nav_exit', { success: false, error: String(e?.message ?? e) });
          }
          return;
        }
      }

      // ─────────────────────────────────────────────────────────────────────
      // 원자적 가드 (race fix): notifId/contentKey 가드 등록을 *첫 await 전*
      // 동기 구간에서 단일 지점으로 처리한다.
      //
      // [기존 버그] 영구 dedupe(`await isProcessed`)가 가드 등록보다 *앞에* 있어,
      //   동시 진입한 3개 호출(포그라운드 리스너 + cold-start retry + server_query)이
      //   모두 `await isProcessed`에서 yield → 전부 가드 미등록 상태로 통과 →
      //   먼저 깨어난 호출만 등록 후 느린 `await saveNotification`에서 다시 yield하는 사이
      //   나머지가 `by:'notifId'`로 막히고, 정작 등록한 호출은 분기(branch_match)에
      //   도달하기 전 다른 게이트/타이밍에 의해 사라져 effect_tracking 라우팅이 죽었다.
      //   (medication은 동일 구조지만 타이밍상 우연히 통과해 정상 동작.)
      //
      // [수정] 동기 가드를 *제일 먼저* 잡는다. 가드를 획득한 단 하나의 호출만이
      //   이후 await(isProcessed/saveNotification/waitForNavReady)를 거쳐 반드시
      //   branch_match → navigate까지 진행한다. 나머지 동시 호출은 여기서 early-return.
      // ─────────────────────────────────────────────────────────────────────

      // 컨텐츠 기반 보조 dedupe 키 (cold-start retry vs server_query 식별자 불일치 race)
      // cold-start는 FCM messageId, server_query는 DB UUID를 notifId로 쓸 수 있어
      // notifId만으로는 cross-path 중복을 못 잡는다 → 같은 (type, mealTime, 30s bucket)이면 1회만.
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

      // (1) 동기 notifId 가드 — 같은 notifId 동시/재진입 차단
      if (handledNotifIds.current.has(notifId)) {
        log('dedupe_check', { blocked: true, by: 'notifId' });
        return;
      }
      // (2) 동기 contentKey 가드 — 식별자 다른 cross-path 중복 차단.
      //     contentKey를 잡은 호출은 분기/네비 도달에 실패하면 releaseGuard로 키를
      //     반드시 되돌려준다(아래). 따라서 키가 살아있다 = "처리 진행 중인 호출이 있다"
      //     이므로 후속 호출은 안전하게 차단해도 라우터를 죽이지 않는다.
      if (handledContentKeys.current.has(contentKey)) {
        log('dedupe_check', { blocked: true, by: 'contentKey', contentKey });
        log('dedupe_content_key_blocked', { contentKey, notifId });
        return;
      }

      // ── 가드 획득 (동기, 첫 await 전 — 단일 지점) ──
      log('dedupe_check', { blocked: false, contentKey });
      handledNotifIds.current.add(notifId);
      handledContentKeys.current.set(contentKey, _now);
      let dedupeRegistered = true;
      // 가드 해제 헬퍼 — 분기/네비 도달 실패 시에만 호출(재시도 허용)
      const releaseGuard = () => {
        if (dedupeRegistered) {
          handledNotifIds.current.delete(notifId);
          handledContentKeys.current.delete(contentKey);
          dedupeRegistered = false;
        }
      };

      // 영구 dedupe (AsyncStorage TTL 7일): 다른 세션 cold start에서 같은 notifId 재진입 차단.
      // 가드 *이후*로 이동 — 이 await가 동시 진입 호출들의 가드 등록을 가로채지 않게 한다.
      // 이미 처리완료된 알림이면 방금 잡은 가드를 풀고 종료(이 세션에선 어차피 끝났으므로 재시도 불필요).
      //
      // [버그수정 A] 약 복용 계열(medication_reminder/missed_medication/_first/_second)은
      //   *영구 isProcessed* 게이트를 면제한다. 정시 알림이 도착 순간 콜드스타트 자동처리
      //   (getLastNotificationResponseAsync 회수)로 markProcessed(notifId)가 박히면,
      //   이후 사용자가 직접 알림을 탭해도(5분 초과 stale 면제와 별개로) 여기서 early-return 되어
      //   무반응이 되던 문제. 약 복용은 시트의 "○○약 드셨나요?"(confirmAndRecordSlot) 확인
      //   다이얼로그를 거쳐 자동기록 사고가 없고, 시트 재오픈은 멱등(중복 기록 안 됨)이므로 안전.
      //   ── 중요: 면제하는 건 "7일짜리 영구 isProcessed"뿐이다. 같은 세션 내 콜드스타트
      //   retry 폭주(같은 알림 4회 재시도 + 서버폴백)는 위 동기 메모리 가드
      //   (handledNotifIds/handledContentKeys, 60초 TTL)가 계속 막으므로 중복 navigate가 안 난다.
      //   markProcessed 자체는 그대로 두어(다른 타입엔 영구 dedupe 필요) 종 경로/배지엔 영향 없음.
      if (!_isMedicationType && (await isProcessed(notifId))) {
        releaseGuard();
        log('persistent_dedupe_blocked', { notifId });
        return;
      }

      // 페이로드 키 호환 처리
      // - medication_reminder / missed_medication: 'mealTime' (camelCase) 사용
      // - effect_tracking: 'meal_time' (snake_case) 사용
      // 양쪽 다 받도록 fallback
      const mealTime: string | null = data?.mealTime ?? data?.meal_time ?? null;
      // 알림 페이로드에 실린 dose_slot 식별자 — 진입 시 "어떤 약인지" 자동 선택에 사용.
      const doseSlotId: string | null = (data?.doseSlotId as string) ?? (data?.dose_slot_id as string) ?? null;
      const triggerMinutes: number | null =
        typeof data?.minutes === 'number' ? data.minutes : null;

      // 탭한 알림 읽음 처리 → 배지 갱신.
      //   (성능) navigate(바텀시트 오픈)를 막지 않도록 fire-and-forget 으로 뒤로 미룬다.
      //   읽음·배지는 화면이 뜬 뒤 반영돼도 무방. 동기 dedupe 가드는 이미 위에서 획득됐고
      //   navigate 분기는 saveNotification 결과에 의존하지 않으므로 안전하다.
      log('save_notification_start', { mealTime, triggerMinutes });
      void (async () => {
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
      })();

      // [콜드스타트 약 시트 누락 수정] 약 복용 계열 알림이면 *nav-ready 게이트보다 먼저*
      //   pendingMedNotif 를 AsyncStorage 에 동기적으로 써둔다.
      //   원인: 콜드스타트는 useAuth user 로딩(네트워크) 동안 RootNavigator 가 LoadingScreen 만 띄워
      //     NavigationContainer 가 미마운트 → isReady()=false. 아래 waitForNavReady 게이트(최대 2초)가
      //     user 로딩(3초+)보다 먼저 만료되면 medication 분기(pendingMedNotif 쓰기 + navigate + emit)
      //     전체가 스킵되어 약 시트가 안 떴다.
      //   해결: pendingMedNotif 를 게이트 *앞*에서 먼저 써두면, 콜드스타트로 MedicationScreen 이
      //     뒤늦게 마운트돼도 그 마운트/포커스 이펙트가 이 값을 읽어 시트를 연다.
      //   navigate/emit 은 기존처럼 게이트 뒤에 둔다(warm 경로 보조). ts 는 핸들러 실행시각으로
      //     MedicationScreen 의 5분 TTL 안에서 소비된다. cross-type stale 키 정리도 여기서 함께 한다.
      if (_isMedicationType) {
        try {
          await AsyncStorage.multiRemove(['pendingBodyStateNotif', 'pendingExerciseNotif']);
          const earlyValue = JSON.stringify({ mealTime, doseSlotId, ts: Date.now() });
          await AsyncStorage.setItem('pendingMedNotif', earlyValue);
          log('set_item_pre_gate', { key: 'pendingMedNotif', value: earlyValue, success: true });
        } catch (e: any) {
          log('set_item_pre_gate', { success: false, error: String(e?.message ?? e) });
        }
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
          // 분기 도달 실패 → dedupe 해제, 다음 시도(예: warm listener) 허용
          releaseGuard();
          log('handler_exit', { reason: 'nav_not_ready' });
          return;
        }
      }

      try {
        if (
          type === 'medication_reminder' ||
          type === 'missed_medication' ||
          type === 'missed_medication_first' ||
          type === 'missed_medication_second'
        ) {
          log('branch_match', { branch: 'medication', type });
          // AsyncStorage write 완료 보장 후 navigateTo (콜드스타트 fallback)
          try {
            // cross-type stale cleanup: 다른 타입의 잔존 pending 키 제거
            await AsyncStorage.multiRemove(['pendingBodyStateNotif', 'pendingExerciseNotif']);
            log('multi_remove', { keys: ['pendingBodyStateNotif', 'pendingExerciseNotif'], success: true });
            const value = JSON.stringify({ mealTime, doseSlotId, ts: Date.now() });
            await AsyncStorage.setItem('pendingMedNotif', value);
            log('set_item', { key: 'pendingMedNotif', value, success: true });
          } catch (e: any) {
            log('set_item', { success: false, error: String(e?.message ?? e) });
          }
          const navArgs = { screen: 'Medication', params: { autoOpen: Date.now(), mealTime, doseSlotId } };
          log('navigate_start', { target: 'Main', args: navArgs });
          navigateTo('Main', navArgs);
          // emit 은 listener(MedicationScreen)를 동기 호출 → 그 안에서 throw 나면
          // 콜드스타트 부팅 중 앱이 죽는다. 안전망으로 감싼다(자동선택 실패해도 화면 진입은 유지).
          try {
            notificationIntentManager.emit({ mealTime, doseSlotId });
          } catch (emitErr: any) {
            log('intent_emit_failed', { error: String(emitErr?.message ?? emitErr) });
          }
        } else if (type === 'effect_tracking') {
          log('branch_match', { branch: 'effect_tracking' });

          // Phase 4 — '바로 측정하기' 액션 버튼 분기 (스펙 §7.2)
          // categoryId='effect_tracking'의 액션 'measure_now' 탭 → 측정 화면 직진입
          // (약효 입력 화면 거치지 않음). 본문 탭(actionIdentifier='default')은 기존 흐름 유지.
          if (response.actionIdentifier === 'measure_now') {
            log('branch_match', { branch: 'effect_tracking_measure_now' });

            // payload data에서 측정에 필요한 파라미터 추출.
            // - med_phase: process-notification-queue가 minutes(interval_minutes)로 보낸다.
            //   서버 enum은 30 → '30m', 120 → '2h'. 그 외는 fallback 'self_initiated'.
            // - med_intake_id: 큐 스키마에 없음(§7.3) → 진입 후 클라가 매칭하거나 null.
            // 디폴트 게임: 탭핑(스펙 §4·§9 — 보편적·짧음, 알림 → 1탭 → 측정 시작 흐름 보장).
            const medIntakeId: string | null =
              (data?.med_intake_id as string) ??
              (data?.medIntakeId as string) ??
              null;
            const minutes: number | null =
              typeof data?.minutes === 'number' ? data.minutes : triggerMinutes;
            // MeasurementMedPhase enum 매핑 — 클라이언트 타입(database.ts:10)에 맞춤
            const medPhase: '30m' | '2h' | 'self_initiated' =
              minutes === 30 ? '30m' : minutes === 120 ? '2h' : 'self_initiated';

            // cross-type stale cleanup (다른 알림 타입 잔존 pending 키 제거)
            try {
              await AsyncStorage.multiRemove([
                'pendingMedNotif',
                'pendingExerciseNotif',
                'pendingBodyStateNotif',
              ]);
              log('multi_remove', {
                keys: ['pendingMedNotif', 'pendingExerciseNotif', 'pendingBodyStateNotif'],
                success: true,
              });
            } catch (e: any) {
              log('multi_remove', { success: false, error: String(e?.message ?? e) });
            }

            // 동의 확인 — 미동의 시 ConsentScreen으로 보내되, 동의 후 자동으로 측정 화면 진입하도록
            // 'next' 파라미터로 후속 목적지 전달(ConsentScreen.handleAgree에서 처리).
            // 동의됨: TapGame 직진입.
            const tapGameArgs = { medPhase, medIntakeId };
            let consentOk = false;
            try {
              const v = await AsyncStorage.getItem('measurement_consent_v1');
              consentOk = v === 'true';
            } catch (e: any) {
              log('consent_check_failed', { error: String(e?.message ?? e) });
              consentOk = false;
            }
            log('consent_check', { consentOk });

            if (consentOk) {
              log('navigate_start', { target: 'TapGame', args: tapGameArgs });
              navigateTo('TapGame', tapGameArgs);
            } else {
              const consentArgs = {
                next: { screen: 'TapGame', params: tapGameArgs },
              };
              log('navigate_start', { target: 'MeasurementConsent', args: consentArgs });
              navigateTo('MeasurementConsent', consentArgs);
            }

            // 정상 처리 완료 마킹 (try-catch 바깥 코드와 동일 패턴)
            markProcessed(notifId).catch(() => {});
            log('handler_exit', { success: true, viaAction: 'measure_now' });
            return;
          }

          // 본문 탭(기본) — 기존 약효 입력 화면 진입 흐름 유지
          // 약 복용 모델 7단계 선결: 슬롯별 통계용 dose_slot_id + 복용 1:1 매칭용 med_log_id를
          // 푸시 data에서 추출해 BodyState까지 전달(on_off_logs.dose_slot_id / med_log_id 기록).
          // 둘 다 없을 수 있음(미이관/구 데이터) → null 허용. navArgs에서도 쓰므로 try 밖에 선언.
          const triggerDoseSlotId: string | null =
            (data?.doseSlotId as string) ??
            (data?.dose_slot_id as string) ??
            null;
          const triggerMedLogId: string | null =
            (data?.med_log_id as string) ??
            (data?.medLogId as string) ??
            null;
          // H-1 dedup: pending(AsyncStorage) 경로와 route params 경로가 같은 포커스에서
          // 둘 다 발화하더라도 BodyStateScreen이 동일 triggerTs로 1회만 처리하도록,
          // 두 경로에 '동일한' ts를 실어 보낸다. (이전엔 Date.now()를 각각 호출해 ts가 달라
          //  공유 dedup 자체가 불가능 → openFlowOrPend 2회 호출되어 시트 2겹 발생.)
          const triggerTs = Date.now();
          try {
            // cross-type stale cleanup
            await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingExerciseNotif']);
            log('multi_remove', { keys: ['pendingMedNotif', 'pendingExerciseNotif'], success: true });
            const value = JSON.stringify({
              triggerMinutes,
              triggerMealTime: mealTime,
              triggerDoseSlotId,
              triggerMedLogId,
              ts: triggerTs,
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
                triggerDoseSlotId,
                triggerMedLogId,
                triggerTs,
              },
            },
          };
          log('navigate_start', { target: 'Main', args: navArgs });
          navigateTo('Main', navArgs);
        } else if (type === 'measurement_completed') {
          // 디지털 바이오마커 MVP-A Phase 5A — 보호자에게 환자 측정 완료 알림 진입.
          // payload data: { type, measurement_type, patient_id, measurement_id }
          // 진입: 보호자 측정 결과 조회 화면 (RootStack, read-only).
          log('branch_match', { branch: 'measurement_completed' });
          try {
            await AsyncStorage.multiRemove([
              'pendingMedNotif',
              'pendingExerciseNotif',
              'pendingBodyStateNotif',
            ]);
          } catch {}
          const patientId: string | undefined =
            (data?.patient_id as string) ?? undefined;
          const navArgs = patientId ? { patientId } : undefined;
          log('navigate_start', { target: 'CaregiverMeasurement', args: navArgs });
          navigateTo('CaregiverMeasurement', navArgs);
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
        } else if (type === 'appointment_reminder') {
          log('branch_match', { branch: 'appointment' });
          // 진료 일정 알림 탭 → 진료 기록 화면(MyInfo 탭 > MedicalRecordList)
          try {
            await AsyncStorage.multiRemove(['pendingMedNotif', 'pendingExerciseNotif', 'pendingBodyStateNotif']);
          } catch {}
          const navArgs = { screen: 'MyInfo', params: { screen: 'MedicalRecordList' } };
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
        // navigate 실패 시 dedupe 해제 → 다음 listener에서 재시도 가능
        releaseGuard();
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

  // ── 로컬 알람(알람처럼/30초) → AlarmScreen 라우팅 ───────────────────────────────
  //   notifee full-screen intent(잠금화면 위)나 알림 탭으로 앱이 열리면, 그 알림 data(_pkAlarm)를
  //   읽어 전체화면 알람 화면을 띄운다. (서버 Expo Push 흐름과 별개 — notifee 이벤트 채널.)
  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const notifeeMod = require('@notifee/react-native');
    const notifee = notifeeMod.default;
    const EventType = notifeeMod.EventType;

    // 서버 무음 백업 채널을 앱 시작 시 항상 생성 — '알람처럼' 슬롯의 서버 백업 푸시가
    //   소리 없이(로컬 소리와 겹치지 않게) 조용히 뜨도록. (localAlarm 소리는 별도 채널.)
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    require('./src/lib/alarmSound').ensureSilentBackupChannel?.().catch(() => {});

    // 같은 알람이 콜드스타트(getInitialNotification)와 DELIVERED 로 이중 라우팅되는 것 방지.
    let lastRoutedId: string | null = null;
    let lastRoutedAt = 0;

    const routeToAlarm = async (n: any, auto: boolean) => {
      if (!n || n?.data?._pkAlarm !== '1') return;
      // 30초 모드는 자동(DELIVERED) 전체화면 X — 탭했을 때만 화면 진입.
      if (auto && n.data.alarmMode !== 'alarm') return;
      const now = Date.now();
      if (n.id && n.id === lastRoutedId && now - lastRoutedAt < 3000) return;
      lastRoutedId = n.id ?? null;
      lastRoutedAt = now;
      for (let i = 0; i < 50 && !navigationRef.isReady(); i++) {
        await new Promise((r) => setTimeout(r, 100));
      }
      const d = n.data || {};

      // '30초 동안'은 전체화면(AlarmScreen)이 아니다 — 탭하면 30초 소리를 멈추고,
      //   일반 알림처럼 약복용(정시)/몸상태(약효추적) 화면으로 보낸다.
      if (d.alarmMode === 'sound30') {
        try { await notifee.stopForegroundService(); } catch {}
        try { if (n.id) await notifee.cancelNotification(n.id); } catch {}
        if (d.kind === 'track') {
          navigateTo('Main', {
            screen: 'BodyStateTab',
            params: {
              screen: 'BodyState',
              params: {
                triggerMinutes: d.minutes ? Number(d.minutes) : undefined,
                triggerMealTime: d.mealTime || undefined,
                triggerDoseSlotId: d.doseSlotId || undefined,
                triggerMedLogId: d.medLogId || undefined,
                triggerTs: now,
              },
            },
          });
        } else {
          // 정시: 약복용 탭에서 그 슬롯 '이 약 맞나요?' 확인 → 기록(autoOpen 흐름).
          navigateTo('Main', {
            screen: 'Medication',
            params: { autoOpen: now, doseSlotId: d.doseSlotId || undefined, mealTime: d.mealTime || undefined },
          });
        }
        return;
      }

      navigateTo('Alarm', {
        fileId: d.fileId || undefined,
        kind: d.kind === 'track' ? 'track' : 'remind',
        doseSlotId: d.doseSlotId || undefined,
        minutes: d.minutes ? Number(d.minutes) : undefined,
        medLogId: d.medLogId || undefined,
        mealTime: d.mealTime || undefined,
        notifId: n.id,
        alarmMode: 'alarm',
        preview: false,
      });
    };

    // 콜드스타트: 알람(full-screen intent/탭)으로 앱이 열렸는지.
    notifee
      .getInitialNotification()
      .then((initial: any) => {
        if (initial?.notification) routeToAlarm(initial.notification, true);
      })
      .catch(() => {});

    // 백그라운드에서 알람 발동/탭 → index.ts onBackgroundEvent 가 저장한 pendingAlarmNotif 를 읽어 라우팅.
    //   ⚠️ 경쟁 방지: onBackgroundEvent(헤드리스)의 저장과 fullScreenAction 의 액티비티 실행이 거의
    //      동시라, 앱이 먼저 읽으면 아직 저장 전일 수 있다 → 짧게 재시도(최대 ~3초)해서 놓치지 않게 한다.
    const readPendingAlarm = async () => {
      for (let i = 0; i < 15; i++) {
        try {
          const raw = await AsyncStorage.getItem('pendingAlarmNotif');
          if (raw) {
            await AsyncStorage.removeItem('pendingAlarmNotif');
            const d = JSON.parse(raw);
            routeToAlarm({ id: d.notifId, data: d }, false);
            return;
          }
        } catch {}
        await new Promise((r) => setTimeout(r, 200));
      }
    };
    // ⚠️ 앱이 이미 백그라운드에서 살아있던 상태(완전 종료 아님)로 알람이 울리면, mount-1회성
    //   getInitialNotification() 은 재실행 안 되고 onForegroundEvent(DELIVERED)도 JS 브릿지가
    //   막 resume되는 타이밍과 경쟁해 놓칠 수 있다(실측: 잠금화면 위로 액티비티는 뜨는데 AlarmScreen
    //   라우팅이 안 됨). AppState 'active'마다 getInitialNotification() 을 다시 확인해 이 빈틈을 메운다.
    const recheckInitialNotification = async () => {
      try {
        const initial = await notifee.getInitialNotification();
        if (initial?.notification) routeToAlarm(initial.notification, true);
      } catch {}
    };
    const onAppActive = () => {
      readPendingAlarm();
      recheckInitialNotification();
    };
    onAppActive();
    const appStateSub = AppState.addEventListener('change', (s) => {
      if (s === 'active') onAppActive();
    });

    // 포그라운드: 알람이 앱 사용 중 울림 → 전체화면(DELIVERED, alarm만) / 탭(PRESS, 공통).
    const unsub = notifee.onForegroundEvent(({ type, detail }: any) => {
      if (type === EventType.DELIVERED) routeToAlarm(detail?.notification, true);
      else if (type === EventType.PRESS) routeToAlarm(detail?.notification, false);
    });
    return () => {
      unsub();
      appStateSub.remove();
    };
  }, []);

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
            // stale(오래된) 응답이라도 더 이상 여기서 차단하지 않는다.
            // handleNotificationResponse가 stale을 직접 감지해 "soft-nav"(자동기록 없이
            // 화면 이동 + 읽음 처리 + dedupe)로 처리하므로, 묵은 알림 탭이 먹통 + 배지
            // 안 지워지는 문제를 막기 위해 핸들러로 그대로 흘려보낸다.
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
      <ErrorBoundary>
        <OverlayHostProvider>
          <RootNavigator />
        </OverlayHostProvider>
      </ErrorBoundary>
    </SettingsProvider>
  );
}

export default function App() {
  // 나눔명조 폰트 런타임 로드(OTA). 앱 시작을 블로킹하지 않는다 —
  // 로드 여부와 무관하게 즉시 렌더하고, 로드되면 편지 모달 텍스트에 fontFamily가 적용,
  // 미로드/실패 시 시스템 폰트로 자연 폴백된다.
  useFonts({
    NanumMyeongjo: require('./assets/fonts/NanumMyeongjo-Regular.ttf'),
  });

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar
        barStyle="dark-content"
        backgroundColor="#FFFFFF"
      />
      <SafeAreaProvider>
        <DialogProvider>
          <AuthProvider>
            <SubscriptionProvider>
              <NotificationBadgeProvider>
                <AppInner />
              </NotificationBadgeProvider>
            </SubscriptionProvider>
          </AuthProvider>
        </DialogProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
