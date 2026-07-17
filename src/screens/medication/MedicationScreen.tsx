import React, { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
  Modal,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';
import { useFocusEffect, useRoute, useNavigation, RouteProp } from '@react-navigation/native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Ionicons } from '@expo/vector-icons';
import { SlotTimeIcon } from '../../components/common/SlotTimeIcon';
import { Colors } from '../../constants/colors';
import { AdSlot } from '../../components/common/AdSlot';
import { TopBar } from '../../components/common/TopBar';
import { MealTimeModal } from './MealTimeModal';
import { BodyStatePopupFlow } from '../bodystate/BodyStatePopupFlow';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import { NOTIF_ONBOARDING_SHOWN_KEY } from '../../components/common/NotificationOnboardingModal';
import { DevLetterModal, shouldShowDevLetter } from '../../components/common/DevLetterModal';
import { logActivity } from '../../utils/activityLog';
import { KAKAO_OPEN_CHAT_URL } from '../../constants/links';
import { useMedication } from '../../hooks/useMedication';
import { useBodyState } from '../../hooks/useBodyState';
import { useScrollTopOnTabPress } from '../../hooks/useScrollTopOnTabPress';
import { useAuth } from '../../context/AuthContext';
import { DatePickerModal } from '../../components/common/DatePickerModal';
import { navigateTo } from '../../navigation/navigationRef';
import { supabase } from '../../lib/supabase';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';
import { HistoryTimeline } from '../../components/common/HistoryTimeline';
import { SkeletonCard } from '../../components/common/SkeletonCard';
import { useRecordRealtime } from '../../hooks/useRecordRealtime';
import { mealTimeToKorean } from '../../utils/medUtils';
import { notificationIntentManager } from '../../utils/NotificationIntentManager';
import { ensureNotGuest } from '../../utils/guestGuard';
import { useSetupGate } from '../../hooks/useSetupGate';
import { SetupGuideBanner } from '../../components/common/SetupGuideBanner';
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { resolveDisplaySlots, fetchPatientDoseSlots, invalidateDoseSlotsCache, getTrackingDayBounds, type DoseSlot } from '../../hooks/useDoseSlots';
import {
  LEGACY_SLOT_META,
  LEGACY_SLOT_ORDER,
  LEGACY_KEY_TO_LABEL,
  formatSlotTime,
  slotTitle,
  slotSortValue,
  translateRawSlotLabel,
  type LegacyMealKey,
} from '../../constants/doseSlots';

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';

interface MedicationStatus {
  id: string; // 카드 key: dose_slot id(이관) 또는 legacy meal_time 키(미이관)
  label: string;
  /** 슬롯 시각(HH:MM) — 시간대 아이콘(SlotTimeIcon)용. */
  slotTime: string | null;
  time: string;
  /** 라벨이 이미 시각을 포함(비표준 추가 슬롯) → 예정 줄에서 시각 중복 표기 생략. */
  labelHasTime?: boolean;
  taken: boolean;
  takenAt?: string;
  medLogId?: string; // 취소(삭제)용 med_logs.id
}

// 시간대(legacy meal key) → i18n 라벨 키. 렌더/다이얼로그에서 t()로 변환.
const MEAL_LABEL_KEYS: Record<MealTime, string> = {
  morning: 'medication.mealMorning',
  lunch: 'medication.mealLunch',
  dinner: 'medication.mealDinner',
  bedtime: 'medication.mealBedtime',
};

// 현재 언어가 영어권인지. 한국어(ko)일 때는 아래 날짜/시간 포맷을 기존과 100% 동일하게 유지한다.
function isEnLocale(): boolean {
  return (i18n.language || '').toLowerCase().startsWith('en');
}

// 시간 비교용 HH:MM 기본값
const DEFAULT_MEAL_TIMES: Record<MealTime, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
};

function formatTakenAt(isoString: string): string {
  const d = new Date(isoString);
  const h = d.getHours();
  const m = d.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  if (isEnLocale()) {
    return `${hour}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}:${mm}`;
}

// "HH:mm" 문자열을 "오전/오후 H:mm"(영어면 "H:mm AM/PM") 형식으로 변환
function formatMealTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  if (isEnLocale()) {
    return `${hour}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}:${mm}`;
}

function getDateLabel(date: Date): string {
  if (isEnLocale()) {
    // "Monday, January 1" 형식(연도 생략, 요일 강조).
    return date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  }
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

// KST(UTC+9) 기준 날짜 문자열 반환 — UTC 사용 시 오후 11시 이후 날짜 오류 방지
function toLocalDateString(date: Date): string {
  const kstOffset = 9 * 60 * 60 * 1000;
  const kst = new Date(date.getTime() + kstOffset);
  return kst.toISOString().slice(0, 10);
}

type MedicationRouteParams = {
  autoOpen?: number | boolean;
  mealTime?: string | null;
  doseSlotId?: string | null;
  // 전체화면 알람 '복용 완료' → 이 슬롯을 복용 완료 처리(기존 기록 로직 그대로).
  autoTakeSlotId?: string | null;
  // 알람 미리보기 '복용 완료' → 실제 기록·알림 없이 '다음 알림 예고'만 표시(테스트용).
  previewNextNotifSlotId?: string | null;
};

// 온보딩에서 초대번호를 건너뛴 첫 진입 회원에게 가족 연동을 1회 안내했는지 여부.
const FAMILY_LINK_GUIDE_SHOWN_KEY = 'family_link_guide_shown';

// [2순위 보강] 알림 진입(autoOpen) 트리거를 컴포넌트 마운트 수명과 무관하게 1회만 소비하기 위한
//   모듈 스코프 dedup. 탭 이동으로 화면이 재마운트되면 컴포넌트 ref(processedAutoOpenRef)가
//   리셋돼 같은 autoOpen 값을 다시 처리할 수 있는데, autoOpen = Date.now() 라 값이 고유하므로
//   마지막으로 처리한 ts 를 모듈 스코프에 남겨 재마운트 후 동일 진입의 재평가를 막는다.
let lastConsumedAutoOpenTs: number | boolean | null = null;

// [2순위 보강] pendingMedNotif(AsyncStorage) 진입 dedup 도 마운트 수명과 무관하게 영속.
//   consumedPendingTsRef 는 컴포넌트 ref 라 재마운트 시 리셋 → removeItem 전 타이밍에
//   재마운트가 끼면 같은 ts 가 두 번 소비될 수 있다. 모듈 스코프로 5분 TTL 내 재트리거 차단.
let lastConsumedPendingTs: number | null = null;

// 개발자 편지 팝업을 이번 앱 실행(프로세스)에서 이미 띄웠는지 — 탭 전환으로 화면이
//   재마운트돼도 매번 다시 뜨지 않도록 모듈 스코프로 1회 표시를 보장한다.
//   ("다시 보지 않기" 전까지 매 앱 실행마다 1회 = 새 프로세스면 리셋).
let devLetterShownThisSession = false;

export function MedicationScreen() {
  const { t } = useTranslation();
  const route = useRoute<RouteProp<{ Medication: MedicationRouteParams }, 'Medication'>>();
  const navigation = useNavigation<any>();
  const routeParams = (route.params ?? {}) as MedicationRouteParams;
  // 동일 autoOpen 값으로 재진입 시 모달 재오픈 차단 (탭 이동 후 재마운트 방어)
  const processedAutoOpenRef = useRef<number | boolean | null>(null);
  // pendingMedNotif 소비 가드: 콜드스타트 시 마운트 useEffect 와 focus effect 가
  //   같은 pending 값을 두 번 소비해 시트가 두 번 뜨는 것을 막는다(같은 ts = 1회만).
  const consumedPendingTsRef = useRef<number | null>(null);
  const { user, signOut } = useAuth();
  const {
    todayStatus,
    slots: doseSlots,
    bySlotId: todayBySlotId,
    hasDoseSlots,
    slotsLoading,
    slotsError,
    takeMedication,
    cancelMedication,
    getMedLogs,
    error: medError,
    loading: todayLoading,
    refresh,
  } = useMedication();
  const { saveBodyState, todayLogs: bodyStateTodayLogs, loadedOnce: bodyLogsLoadedOnce, refresh: refreshBodyState } = useBodyState();
  const insets = useSafeAreaInsets();
  const { unreadCount, refreshBadge } = useNotificationBadge();
  const dialog = useDialog();
  // 복용 시간대(dose_slot) 미등록 시 기록 차단 게이팅 (B차).
  const { requireSetup } = useSetupGate();

  // 탭 버튼 누를 때 항상 맨 위로
  const scrollRef = useRef<ScrollView>(null);
  useScrollTopOnTabPress(scrollRef);

  // users.meal_schedules 기반 시간 표시 (약 없을 때 사용)
  const [userMealSchedules, setUserMealSchedules] = useState<Record<string, string> | null>(null);
  const [notifPrefs, setNotifPrefs] = useState<Record<string, boolean> | null>(null);

  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [showDevLetter, setShowDevLetter] = useState(false);
  const [showMealTimeModal, setShowMealTimeModal] = useState(false);
  const [showBodyStatePopup, setShowBodyStatePopup] = useState(false);
  const [showBodyStateSuggest, setShowBodyStateSuggest] = useState(false);
  const [selectedMealTime, setSelectedMealTime] = useState<MealTime | null>(null);
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showPreMedInfo, setShowPreMedInfo] = useState(false);
  const [preMedMessage, setPreMedMessage] = useState('');
  const [showNextNotifModal, setShowNextNotifModal] = useState(false);
  const [nextNotifInfo, setNextNotifInfo] = useState<NextNotifInfo | null>(null);
  // 복용 저장 진행 표시(스피너). takeMedication await 구간만 덮는다.
  //   저장이 끝나면(다음 팝업 결정 전) 내린다 → 스피너 Modal 이 완전히 사라진 뒤
  //   onHidden 에서 "다음에 띄울 팝업"을 단독 present(iOS 모달 적층 교착 회피).
  const [saving, setSaving] = useState(false);
  // 알림 진입(enterFromNotification) 시 슬롯 조회(fetchPatientDoseSlots) 네트워크 대기 구간을
  //   덮는 "진입 스피너". 저장 스피너(saving)와는 별도 state — 둘은 시간상 겹치지 않는다
  //   (진입 스피너 → (닫힘) → 복용 확인 다이얼로그 → (저장 시) 저장 스피너 순). title 도 구분한다
  //   (진입="불러오는 중이에요", 저장="약 복용을 기록하고 있어요"). JSX 에서 `entering && !saving`
  //   로 한 번 더 동시 표시를 막는다.
  const [entering, setEntering] = useState(false);
  // 진입 스피너가 "실제로 켜진" 경로인지(=네트워크 조회 대기) 표시. 워밍 경로(스피너 없이 즉시 confirm)와
  //   구분해, 후속 동작을 스피너 onHidden 으로 보낼지 직접 실행할지 분기한다.
  const enteringActiveRef = useRef(false);
  // 진입 스피너가 내려간 뒤(onHidden) 단독 present 할 동작 — 복용 확인 다이얼로그 또는 전체 선택 모달.
  //   confirm 다이얼로그를 스피너 위에 적층하지 않기 위해 보관만 해 둔다.
  const pendingEnterRef = useRef<
    | { kind: 'confirm'; slot: DoseSlot }
    | { kind: 'fallbackModal'; mealTime: MealTime | null }
    | null
  >(null);
  // 저장 직후 띄울 후속 팝업을 보관만 해 두고, 스피너 onHidden 에서 단독 present.
  //   confirm→스피너→다음모달 3개가 절대 동시에 뜨지 않도록 타이밍을 일원화한다.
  const pendingNextRef = useRef<
    | { kind: 'preMed' }
    | { kind: 'bodyStateSuggest' }
    | { kind: 'nextNotif'; info: NextNotifInfo }
    | { kind: 'error'; title: string; message: string }
    | null
  >(null);
  // 7단계: 방금 기록한 복용의 슬롯/복용 식별자.
  // 복용 직후 즉시 몸상태 팝업("기록하기")이 on_off_logs.dose_slot_id / med_log_id 에 귀속하도록
  // proceedSave 에서 takeMedication 반환값을 보관 → 팝업 navigate 시 BodyState 로 전달.
  const [lastMedLogId, setLastMedLogId] = useState<string | null>(null);
  const [lastDoseSlotId, setLastDoseSlotId] = useState<string | null>(null);
  // 방금 기록한 슬롯의 "복용 직후"(track_intervals에 0 포함 + 추적 ON) 여부.
  // 이게 꺼져 있으면 복용 직후 자동 몸상태 팝업을 띄우지 않는다. (사전기록 onClose 경로에서도 참조)
  const immediateSuggestRef = useRef(true);
  // ⚠️ 더블탭 방어(화면 단 in-flight 락): 저장 버튼/확인창을 빠르게 두 번 눌러 proceedSave 가
  //    두 번 진입하면 후속 팝업(몸상태·다음알림·보호자 알림)과 takeMedication 이 중복 실행된다.
  //    훅(useMedication.takeMedication)에도 락이 있지만, 두 번째 호출이 success:false 로 돌아오면
  //    여기서 "저장 실패" 알림이 잘못 뜨므로, takeMedication 에 닿기 전에 화면 단에서 조용히 무시한다.
  //    완료(성공/실패)까지 차단하는 락 — finally 에서 해제.
  const proceedSaveInFlightRef = useRef(false);
  // 다음알림 조회 promise 핸들(표시 타이밍 분리용).
  //   proceedSave 가 시작한 fetchNextNotifMessage promise 를 ref 에 보관해 둔다.
  //   선행 팝업(몸상태 권유·사전기록 안내)의 닫기 핸들러가 닫히는 시점에 state(nextNotifInfo) 가
  //   아직 null 이어도 이 ref 의 promise 를 await 해서 "보장된" 값을 얻을 수 있게 한다.
  //   → 권유 팝업을 빠르게 닫아 promise 가 아직 resolve 되지 않은 경우에도 다음알림 팝업 누락 방지.
  const nextNotifPromiseRef = useRef<Promise<NextNotifInfo | null>>(Promise.resolve(null));
  // 알림으로 진입 시 "이 약 맞나요?" 확인 다이얼로그가 여러 경로(라우트 param·IntentManager·AsyncStorage)에서
  // 중복으로 뜨지 않도록 막는 가드(3초 윈도우).
  const notifEntryGuardRef = useRef(0);

  // 가족 연동 안내(1회)가 이번 세션에서 이미 트리거됐는지 — 중복 표시 방지.
  const familyGuideTriggeredRef = useRef(false);

  // 온보딩에서 초대번호를 건너뛴 첫 진입 회원에게 가족 연동을 1회 안내.
  //   - 이미 가족과 연동된 회원/이미 안내한 회원은 표시 안 함.
  //   - 받은 초대번호가 있으면 입력해 연동 / 첫 가입자면 가족 초대 → '가족 연동하러 가기' 시 가족 연동 화면으로.
  const maybeShowFamilyGuide = useCallback(async () => {
    if (!user?.onboarding_done) return;
    if (user?.patient_group_id) return; // 이미 연동됨
    if (familyGuideTriggeredRef.current) return;
    familyGuideTriggeredRef.current = true;
    try {
      const shown = await AsyncStorage.getItem(FAMILY_LINK_GUIDE_SHOWN_KEY);
      if (shown) return;
      await AsyncStorage.setItem(FAMILY_LINK_GUIDE_SHOWN_KEY, '1');
    } catch {
      return;
    }
    // 다른 모달 닫힘/화면 전환 후 표시
    setTimeout(async () => {
      const ok = await dialog.confirm({
        title: t('medication.familyGuideTitle'),
        message: t('medication.familyGuideMsg'),
        confirmText: t('medication.familyGuideConfirm'),
        cancelText: t('medication.later'),
      });
      if (ok) {
        navigateTo('Main', { screen: 'MyInfo', params: { screen: 'FamilyLink' } });
      }
    }, 400);
  }, [user?.onboarding_done, user?.patient_group_id, dialog]);

  // 개발자 편지를 닫은 뒤의 후속 흐름.
  //   - 온보딩 후 "최초 1회": 알림 설정 화면으로 강제 이동(기본이 전부 OFF이므로 사용자가 직접 켜게).
  //       · 환자   → 복용시간 설정·알림(MedicationManage slots) + 진입 안내 팝업
  //       · 보호자 → 보호자 알림 설정(Settings) + 진입 안내 팝업
  //   - 그 이후(이미 1회 보냈으면): 기존 가족 연동 안내로 이어간다.
  const afterDevLetterClose = useCallback(async () => {
    if (user?.onboarding_done && user?.id) {
      try {
        const key = `notif_setup_forced:${user.id}`;
        const forced = await AsyncStorage.getItem(key);
        if (!forced) {
          await AsyncStorage.setItem(key, '1');
          const isCaregiver = user.role === 'caregiver';
          setTimeout(() => {
            if (isCaregiver) {
              navigateTo('Main', { screen: 'MyInfo', params: { screen: 'Settings', params: { guideCaregiverNotif: true } } });
            } else {
              // 환자: 새 간단 복약시간 온보딩(첫째 약→시간→둘째 약… 순차)으로.
              navigateTo('Main', { screen: 'MyInfo', params: { screen: 'MedTimeOnboarding' } });
            }
          }, 400);
          return;
        }
      } catch {}
    }
    // 이미 최초 안내를 마쳤거나 온보딩 전이면 기존 가족 연동 안내.
    maybeShowFamilyGuide();
  }, [user?.onboarding_done, user?.id, user?.role, maybeShowFamilyGuide]);

  // 온보딩 완료 후 홈 최초 진입 시 가족 연동 안내.
  //   알림 권한은 이제 RootNavigator 의 NotificationGateScreen 게이트가 강제하므로
  //   (권한 허용 전에는 MainNavigator 자체가 마운트되지 않음) 여기서 알림 온보딩 시트를
  //   다시 띄우지 않는다(중복 프롬프트 제거). 알림 온보딩 '봤음' 키만 마킹하고
  //   가족 연동 안내 흐름을 이어간다.
  useEffect(() => {
    if (!user?.onboarding_done) return;
    (async () => {
      await AsyncStorage.setItem(NOTIF_ONBOARDING_SHOWN_KEY, 'done').catch(() => {});
      // 개발자 편지 팝업: '다시 보지 않기' 전까지 매 앱 실행마다 1회 먼저 노출.
      //   편지가 닫히면(어느 버튼/스와이프든) 그 콜백에서 가족 연동 안내를 이어간다.
      //   이미 이번 실행에서 띄웠으면(탭 재마운트) 또는 다시 보지 않기 상태면 → 바로 가족 안내.
      if (!devLetterShownThisSession) {
        devLetterShownThisSession = true;
        // '다시 보지 않기' 전까지 매 실행 노출. 단, admin '강제 팝업 띄우기'(popup_version↑) 시엔
        //   이미 닫은 사람도 한 번 더 노출된다(shouldShowDevLetter 내부에서 버전 비교).
        let show = false;
        try {
          show = await shouldShowDevLetter();
        } catch {}
        if (show) {
          setShowDevLetter(true);
          return; // 후속(알림설정 강제/가족 안내)은 편지 닫힘 콜백(onClose)에서 호출
        }
      }
      afterDevLetterClose();
    })();
  }, [user?.onboarding_done, afterDevLetterClose]);

  // 알림 탭 진입 시 MealTimeModal 자동 오픈
  // App.tsx에서 navigation params { autoOpen: true, mealTime: '아침' } 전달
  useEffect(() => {
    if (!routeParams.autoOpen) return;
    // 같은 autoOpen 값으로 재진입(탭 재마운트 등) 시 무시
    if (processedAutoOpenRef.current === routeParams.autoOpen) return;
    // [2순위 보강] 재마운트로 processedAutoOpenRef 가 리셋돼도 모듈 스코프 dedup 으로
    //   같은 autoOpen ts 를 다시 처리하지 않는다(이미 복용한 슬롯 확인창 재출현 방지).
    if (lastConsumedAutoOpenTs === routeParams.autoOpen) return;
    processedAutoOpenRef.current = routeParams.autoOpen;
    lastConsumedAutoOpenTs = routeParams.autoOpen;

    // 알림으로 진입 시 미읽음 약 복용 알림 읽음 처리 (안전망)
    // saveNotification에서 type 불일치 등으로 읽음 처리가 안 된 경우 대비
    // cutoff: 오늘 KST 0시 (1~2시간 늦게 탭해도 안전망 작동하도록 확장)
    (async () => {
      try {
        const { data: { user: authUser } } = await supabase.auth.getUser();
        if (!authUser) return;
        // 오늘 KST 0시(=UTC 전날 15:00) 기준 since 계산
        const now = new Date();
        const koreaToday = new Date(now.getTime() + 9 * 60 * 60 * 1000);
        koreaToday.setUTCHours(0, 0, 0, 0);
        const since = new Date(koreaToday.getTime() - 9 * 60 * 60 * 1000).toISOString();
        await supabase
          .from('notification_logs')
          .update({ read_at: new Date().toISOString() })
          .eq('user_id', authUser.id)
          .in('type', ['medication_reminder', 'missed_medication'])
          .is('read_at', null)
          .gte('created_at', since);
        refreshBadge();
      } catch (e) {
        console.error('[MedicationScreen] 읽음 처리 오류:', e);
      }
    })();

    // 따로 거주 보호자 / 연동 환자 없는 보호자는 바텀시트 차단
    // ⚠️ 주석 처리: patientId 비동기 로드 전 userRole이 잘못 계산돼 modal 오픈이 막힘 (AsyncStorage useFocusEffect 방식으로 대체)
    // if (userRole === 'caregiver_separate' || userRole === 'caregiver_no_patient') return;

    // 화면 전환 애니메이션 완료 후: 알림에 실린 슬롯으로 "이 약 맞나요?" 확인 → 바로 기록.
    const enterMealTime = routeParams.mealTime ?? null;
    const enterDoseSlotId = routeParams.doseSlotId ?? null;
    const timer = setTimeout(() => {
      safeEnterFromNotification({ mealTime: enterMealTime, doseSlotId: enterDoseSlotId });
      // routeParams 즉시 clear → 탭 이동 후 재진입 시 stale 값으로 재오픈되는 것 차단
      try {
        navigation.setParams({ autoOpen: undefined, mealTime: undefined, doseSlotId: undefined });
      } catch (e) {
        console.warn('[MedicationScreen] setParams clear 실패:', e);
      }
    }, 400);
    return () => clearTimeout(timer);
  // routeParams 객체 참조가 바뀌어도 autoOpen 값 기준으로만 실행
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routeParams.autoOpen]);

  // NotificationIntentManager 기반 알림 탭 → 모달 열기 (콜드 스타트 레이스 컨디션 해결)
  const openMedModalRef = useRef(false);
  useEffect(() => {
    const unsubscribe = notificationIntentManager.subscribe(({ mealTime, doseSlotId }) => {
      if (openMedModalRef.current) return;
      openMedModalRef.current = true;
      setTimeout(() => { openMedModalRef.current = false; }, 2000);
      setTimeout(() => { safeEnterFromNotification({ mealTime: mealTime ?? null, doseSlotId: doseSlotId ?? null }); }, 100);
    });
    return unsubscribe;
  }, []);

  // 날짜별 복용 현황 (날짜 선택 시 사용)
  const [dateLogStatus, setDateLogStatus] = useState<Record<string, any> | null>(null);
  const [dateLogsLoading, setDateLogsLoading] = useState(false);

  const isToday = toLocalDateString(selectedDate) === toLocalDateString(new Date());

  // ⚠️ 회귀 수정: 과거 날짜 현황도 fetchTodayStatus(useMedication)와 동일한 정규키 규칙을 써야
  // 이관 환자(dose_slots 보유)의 과거 back-fill 로그(dose_slot_id=UUID)와 카드 키(slot.id=UUID)가
  // 일치해 완료표시가 뜬다. 이전엔 과거 경로가 `dose_slot_id ?? meal_time`만 써서
  // meal_time 만 있는 과거 로그가 UUID 카드 키와 안 맞아 누락됐음.
  // legacyKey(meal_time) → 정규 dose_slot id 매핑 (doseSlots = useMedication().slots, 실제 행).
  const legacyKeyToSlotId = useMemo(() => {
    const m = new Map<string, string>();
    doseSlots.forEach((s) => {
      if (s.legacyKey && s.id) m.set(s.legacyKey, s.id);
    });
    return m;
  }, [doseSlots]);

  // 로그 1건 → 정규 슬롯 키. fetchTodayStatus 와 동일 우선순위.
  //   dose_slot_id ?? legacyKeyToSlotId.get(meal_time) ?? meal_time
  // 미이관 환자는 doseSlots 가 비어 매핑 실패 → meal_time 키 유지(legacy 매칭 정상).
  const slotKeyForLog = useCallback(
    (log: { dose_slot_id?: string | null; meal_time?: string | null }): string | null => {
      return (
        log.dose_slot_id ??
        (log.meal_time ? legacyKeyToSlotId.get(log.meal_time) : undefined) ??
        log.meal_time ??
        null
      );
    },
    [legacyKeyToSlotId]
  );

  // 탭/화면 포커스 시 복용 현황 재조회 (오늘 날짜인 경우)
  useFocusEffect(
    useCallback(() => {
      if (isToday) {
        refresh();
        // 수면 게이팅용 오늘 on_off_logs 신선도 — 다른 화면(약효추적 팝업)에서 남긴 수면 기록을
        //   복용직후 팝업 노출 전에 반영해 하루 1회(중복 방지) 불변식을 화면 간에도 지킨다.
        refreshBodyState();
        setDateLogStatus(null);
      }
    }, [refresh, refreshBodyState, isToday])
  );

  // 알림 탭 → 모달 열기 (AsyncStorage pendingMedNotif 소비 공통 로직).
  //   focus effect(워밍/탭 재포커스)와 마운트 재시도 이펙트(콜드스타트) 양쪽에서 호출한다.
  //   같은 pending(ts)을 두 번 열지 않도록 consumedPendingTsRef 로 1회만 처리한다.
  const consumePendingMedNotif = useCallback(async () => {
    try {
      const value = await AsyncStorage.getItem('pendingMedNotif');
      if (!value) return;
      const data = JSON.parse(value);
      // TTL 5분 초과 → stale 폐기 (모달 표시 안 함). 단 stale 도 키는 비워준다.
      if (data?.ts && Date.now() - data.ts > 5 * 60 * 1000) {
        await AsyncStorage.removeItem('pendingMedNotif').catch(() => {});
        return;
      }
      // 같은 ts 를 이미 소비했으면 중복 오픈 방지(마운트 이펙트 + focus effect 동시 진입 방어).
      //   컴포넌트 ref + 모듈 스코프(lastConsumedPendingTs) 양쪽으로 막아 재마운트도 방어.
      if (data?.ts && (consumedPendingTsRef.current === data.ts || lastConsumedPendingTs === data.ts)) return;
      const consumedTs = data?.ts ?? Date.now();
      consumedPendingTsRef.current = consumedTs;
      lastConsumedPendingTs = consumedTs;
      // removeItem await 보장: stale 재트리거 방지(소비 확정 후 제거).
      await AsyncStorage.removeItem('pendingMedNotif').catch(() => {});
      const mealTime = data?.mealTime ?? null;
      const doseSlotId = data?.doseSlotId ?? null;
      setTimeout(() => { safeEnterFromNotification({ mealTime, doseSlotId }); }, 300);
    } catch {}
  // safeEnterFromNotification 은 ref 안정(빈 deps useCallback)이라 deps 불필요.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 알림 탭 → 모달 열기 (포커스 시: 워밍/탭 재포커스 경로).
  useFocusEffect(
    useCallback(() => {
      consumePendingMedNotif();
    }, [consumePendingMedNotif])
  );

  // [콜드스타트 약 시트 누락 수정] 마운트 시 pendingMedNotif 재읽기 + 짧은 재시도.
  //   콜드스타트는 App.tsx 핸들러가 user 로딩 지연으로 pendingMedNotif 를 *늦게* 쓸 수 있어,
  //   이미 발생한 focus 이벤트로는 못 잡는다(소비할 포커스가 없음). 그래서 마운트 직후 한 번,
  //   그리고 300·800ms 뒤 재확인해 늦게 쓰인 값도 잡는다. consumedPendingTsRef 가 중복을 막는다.
  //   (enterFromNotification 내부 notifEntryGuardRef 3초 윈도우도 다이얼로그 중복을 추가 차단.)
  useEffect(() => {
    consumePendingMedNotif();
    const t1 = setTimeout(() => { consumePendingMedNotif(); }, 300);
    const t2 = setTimeout(() => { consumePendingMedNotif(); }, 800);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [consumePendingMedNotif]);

  // 날짜 변경 시 해당 날짜 로그 조회
  useEffect(() => {
    if (isToday) {
      setDateLogStatus(null);
      return;
    }
    const dateStr = toLocalDateString(selectedDate);
    setDateLogsLoading(true);
    getMedLogs(dateStr).then((logs) => {
      // 슬롯 단위 현황(키 = dose_slot_id ?? meal_time). todayBySlotId 와 동일 규칙.
      const status: Record<string, any> = {
        morning: null,
        lunch: null,
        dinner: null,
        bedtime: null,
      };
      logs.forEach((log) => {
        // legacy 4슬롯 키(기존 호환)
        const slot = log.meal_time as keyof typeof status;
        if (slot && slot in status && !status[slot]) {
          status[slot] = log;
        }
        // 슬롯 단위 키 — fetchTodayStatus 와 동일한 정규키 규칙(이관 환자 키 통일)
        const key = slotKeyForLog(log);
        if (key && !status[key]) {
          status[key] = log;
        }
      });
      setDateLogStatus(status);
      setDateLogsLoading(false);
    });
  }, [selectedDate, isToday, getMedLogs, slotKeyForLog]);

  // 표시할 현황: 오늘이면 슬롯 단위(todayBySlotId), 과거 날짜면 dateLogStatus.
  // 둘 다 키 = dose_slot_id ?? meal_time 규칙으로 통일됨.
  const activeStatus: Record<string, any> = isToday
    ? todayBySlotId
    : (dateLogStatus ?? { morning: null, lunch: null, dinner: null, bedtime: null });

  // [복용 완료 게이트] 알림 진입(confirmAndRecordSlot)이 stale closure 없이 최신 오늘 현황을
  //   읽도록 ref 동기화. confirmAndRecordSlot 은 useCallback([dialog]) 라 todayBySlotId 를
  //   옛 렌더 값으로 캡처 → 이미 복용한 슬롯도 "미복용"으로 오판할 수 있어 ref 로 최신값 참조.
  //   todayStatusReadyRef: 오늘 현황을 한 번이라도 fetch 완료했는지(로딩 중 오판 방지).
  const todayBySlotIdRef = useRef<Record<string, any>>(todayBySlotId);
  todayBySlotIdRef.current = todayBySlotId;
  const todayStatusReadyRef = useRef(false);
  const todayLoadStartedRef = useRef(false);
  useEffect(() => {
    // todayLoading 초기값은 false(아직 첫 fetch 전)라 그대로 ready 처리하면 로딩 중 오판.
    //   → 실제로 로딩이 true 로 한 번 올라간 뒤(=fetch 시작) false 로 떨어질 때만 ready 로 본다.
    if (todayLoading) todayLoadStartedRef.current = true;
    else if (todayLoadStartedRef.current) todayStatusReadyRef.current = true;
  }, [todayLoading]);

  const [patientName, setPatientName] = useState(() => t('medication.caregiverDefaultName'));
  const [patientId, setPatientId] = useState<string | null>(null);
  // 보호자 환자 해석 완료 여부(깜빡임 방지) — 해석 끝나기 전엔 미연동 판정하지 않음.
  const [patientResolved, setPatientResolved] = useState(false);

  // 과거기록(HistoryTimeline) 실시간 갱신 키
  const [recordsRefreshKey, setRecordsRefreshKey] = useState(0);

  // 약복용 기록 실시간 동기화 — 환자↔보호자 기기 즉시 반영
  useRecordRealtime('med_logs', patientId, () => {
    refresh();                          // 오늘 복용현황 갱신
    setRecordsRefreshKey((k) => k + 1); // 과거기록(HistoryTimeline) 갱신
  });

  useEffect(() => {
    if (!user) return;
    setPatientResolved(false);
    if (user.role === 'patient') {
      setPatientName(user.name);
      setPatientId(user.id);
      setPatientResolved(true);
      // 환자 본인의 meal_schedules 로드
      supabase
        .from('users')
        .select('meal_schedules, med_time_notif_prefs')
        .eq('id', user.id)
        .single()
        .then(({ data }) => {
          if (data?.meal_schedules) {
            setUserMealSchedules(data.meal_schedules as Record<string, string>);
          }
          if (data?.med_time_notif_prefs) {
            setNotifPrefs(data.med_time_notif_prefs as Record<string, boolean>);
          }
        });
      return;
    }
    if (!user.patient_group_id) { setPatientResolved(true); return; }
    // 보호자인 경우 환자 정보 로드
    supabase
      .from('patient_group_members')
      .select('user_id, users(name, meal_schedules, med_time_notif_prefs)')
      .eq('group_id', user.patient_group_id)
      .eq('role', 'patient')
      .single()
      .then(({ data }) => {
        const userInfo = data?.users as any;
        if (userInfo?.name) setPatientName(userInfo.name);
        if (userInfo?.meal_schedules) {
          setUserMealSchedules(userInfo.meal_schedules as Record<string, string>);
        }
        if (userInfo?.med_time_notif_prefs) {
          setNotifPrefs(userInfo.med_time_notif_prefs as Record<string, boolean>);
        }
        if ((data as any)?.user_id) setPatientId((data as any).user_id);
        setPatientResolved(true);
      });
  }, [user]);

  // patient_group_id가 있어도 실제 환자 멤버가 없을 수 있으므로 patientId 기준으로 판단
  const userRole: 'patient' | 'caregiver_no_patient' | 'caregiver_same' | 'caregiver_separate' =
    user?.role !== 'caregiver'
      ? 'patient'
      : !patientId
      ? 'caregiver_no_patient'
      : user.residence_type === 'separate'
      ? 'caregiver_separate'
      : 'caregiver_same';

  // 미연동 보호자: 보호자인데 환자 해석이 끝났고 연동 환자 없음(환자 본인 0슬롯엔 영향 없음).
  const caregiverUnlinked = user?.role === 'caregiver' && patientResolved && !patientId;

  // 취소 버튼 노출 조건: 환자 본인 또는 함께 거주 보호자(연동된 환자 있음)
  const canCancelRecord = userRole === 'patient' || userRole === 'caregiver_same';

  // 복용 기록 취소(삭제) — 확인 팝업 후 RPC로 삭제, 성공 시 현황 갱신
  const handleCancelRecord = async (medLogId: string) => {
    const ok = await dialog.confirm({
      title: t('medication.cancelRecordTitle'),
      message: t('medication.cancelRecordMsg'),
      confirmText: t('medication.cancelRecordConfirm'),
      cancelText: t('common.close'),
      destructive: true,
    });
    if (!ok) return;

    const success = await cancelMedication(medLogId);
    if (!success) {
      dialog.alert({ title: t('medication.cancelFailTitle'), message: t('medication.cancelFailMsg') });
      return;
    }
    // 성공 시 현황 갱신 (오늘이면 cancelMedication 내부 fetchTodayStatus, 과거 날짜면 재조회)
    if (!isToday) {
      const dateStr = toLocalDateString(selectedDate);
      const logs = await getMedLogs(dateStr);
      const status: Record<string, any> = { morning: null, lunch: null, dinner: null, bedtime: null };
      logs.forEach((log) => {
        const slot = log.meal_time as keyof typeof status;
        if (slot && slot in status && !status[slot]) status[slot] = log;
        // fetchTodayStatus 와 동일한 정규키 규칙(이관 환자 키 통일)
        const key = slotKeyForLog(log);
        if (key && !status[key]) status[key] = log;
      });
      setDateLogStatus(status);
    }
  };

  // 다음알림 팝업을 "보장된 값"으로 표시한다(표시 타이밍을 비동기 state 도착에서 분리).
  //   닫기 핸들러가 state nextNotifInfo 레이스에 걸리지 않도록:
  //   ① 이미 state 에 값이 있으면 그대로 사용,
  //   ② 없으면 proceedSave 가 보관한 nextNotifPromiseRef 를 await 해 fetch 결과를 직접 얻는다.
  //   fetchNextNotifMessage 는 폴백으로 거의 항상 non-null → 권유 팝업을 빠르게 닫아도 팝업이 뜬다.
  const resolveAndShowNextNotif = async () => {
    let info = nextNotifInfo;
    if (!info) {
      try {
        info = await nextNotifPromiseRef.current;
      } catch {
        info = null;
      }
    }
    // ⚠️ null-게이트 제거: 못 구했어도(throw/미해석) 폴백으로 무조건 표시.
    //    다음 알림은 최소한 내일 복용이라도 늘 존재 → 빈 종료 화면이 정상인 경우는 없다.
    const shown = info ?? FALLBACK_NEXT_NOTIF;
    setNextNotifInfo(shown);
    setShowNextNotifModal(true);
  };

  // 전체화면 알람 '복용 완료' 진입 → 그 슬롯을 복용 완료 처리(proceedSave 재사용:
  //   게이트·takeMedication·약효추적·보호자알림·몸상태팝업·멱등 전부 동일). 1회 소비 후 파라미터 제거.
  const autoTakeConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    const sid = routeParams.autoTakeSlotId;
    if (!sid || autoTakeConsumedRef.current === sid) return;
    // 환자 해석 전(보호자 patientId 미로드)이면 대기 — 이 상태로 기록하면 resolvedPatientId=null 이라
    //   다음알림 계산을 건너뛰어 빈 폴백 팝업이 뜨고, 기록 대상도 어긋난다. patientId 로드 후 재실행.
    const patientReady = !!patientId || user?.role === 'patient';
    if (!patientReady) return;
    autoTakeConsumedRef.current = sid;
    navigation.setParams({ autoTakeSlotId: undefined } as any);
    void proceedSave({ mealTime: null, doseSlotId: sid });
  }, [routeParams.autoTakeSlotId, patientId, user?.role]);

  // 알람 미리보기 '복용 완료' → 실제 기록·보호자알림 없이 '다음 알림 예고'만 계산해 표시.
  const previewNextConsumedRef = useRef<string | null>(null);
  useEffect(() => {
    const sid = routeParams.previewNextNotifSlotId;
    if (!sid || previewNextConsumedRef.current === sid) return;
    const pid = patientId ?? (user?.role === 'patient' ? (user?.id ?? null) : null);
    if (!pid) return; // 환자 해석 후 재실행
    previewNextConsumedRef.current = sid;
    navigation.setParams({ previewNextNotifSlotId: undefined } as any);
    void (async () => {
      // 슬롯의 추적 설정으로 justTaken 구성(추적 켜져 있으면 '복용 30분 후' 등도 후보) — 기록은 안 함.
      const { data: slot } = await supabase
        .from('dose_slots' as any)
        .select('label, track_enabled, track_intervals')
        .eq('id', sid)
        .maybeSingle();
      const s: any = slot;
      const justTaken =
        s?.track_enabled && (s?.track_intervals?.length ?? 0) > 0
          ? { takenAt: new Date(), trackIntervals: s.track_intervals as number[], slotLabel: s.label ?? null }
          : null;
      const info = await fetchNextNotifMessage(pid, justTaken).catch(() => null);
      setNextNotifInfo(info ?? FALLBACK_NEXT_NOTIF);
      setShowNextNotifModal(true);
    })();
  }, [routeParams.previewNextNotifSlotId, patientId, user?.role]);

  const proceedSave = async (sel: { mealTime: MealTime | null; doseSlotId: string | null }) => {
    // ⚠️ 더블탭 방어(화면 단 in-flight 락): 이전 저장이 끝나기 전 두 번째 진입은 조용히 무시.
    //    (takeMedication 까지 가지 않으므로 "저장 실패" 오알림도 안 뜨고, 후속 팝업 중복도 차단.)
    if (proceedSaveInFlightRef.current) {
      console.warn('[MedicationScreen] proceedSave 재진입 차단(저장 진행 중) — 더블탭 무시');
      return;
    }
    proceedSaveInFlightRef.current = true;
    try {
    // 게이팅(B차): 활성 dose_slot 0개면 기록 막고 통합 등록(복용 관리) 유도.
    // 모든 기록 경로(메인 버튼/보호자 확인/알림 진입)가 결국 여기로 모이므로 단일 차단점.
    // 보수적: 로딩 중/조회불가면 통과. 명확히 0일 때만 차단.
    if (!(await requireSetup(dialog))) return;
    const { mealTime, doseSlotId } = sel;
    const nowForCheck = new Date();
    // ⚠️ 스피너는 게이트(requireSetup) 통과 후, 실제 저장(takeMedication) 직전에 켠다.
    //    requireSetup 의 미등록 안내 confirm 이 스피너 위에 적층되는 걸 피하기 위함.
    //    내리는 시점은 finally(성공/실패/throw 무관) — 후속 팝업은 onHidden 에서.
    setSaving(true);
    const result = await takeMedication({ mealTime, doseSlotId });
    if (!result.success) {
      // ⚠️ 에러 안내도 스피너 위에 적층하지 말 것 — pendingNextRef 에 담아 onHidden 에서 단독 표시.
      pendingNextRef.current = {
        kind: 'error',
        title: t('medication.saveFailTitle'),
        message: medError ?? t('medication.saveFailMsg'),
      };
      return;
    }

    // 7단계: 방금 기록한 복용의 식별자 보관 → 즉시 몸상태 팝업이 슬롯 귀속에 사용.
    //   takeMedication 이 doseSlotId 를 legacyKey→slot.id 로 보충했을 수 있으므로 반환값을 신뢰.
    setLastMedLogId(result.medLogId);
    setLastDoseSlotId(result.doseSlotId);
    logActivity('med_taken', {
      meal_time: mealTime ?? null,
      dose_slot_id: result.doseSlotId ?? null,
    });

    // 해당 슬롯(이관/비표준 모두) — 사전기록 안내·라벨 폴백에 사용.
    const selSlot = doseSlotId
      ? displaySlots.find((s) => s.id === doseSlotId)
      : (mealTime ? displaySlots.find((s) => s.legacyKey === mealTime) : undefined);

    // 약 기록 성공 → 종 아이콘 뱃지 즉시 갱신 (safety net)
    // useMedication 훅 내부에서 이미 읽음 처리하지만 Context 카운트 동기화를 위해 한 번 더 호출
    refreshBadge().catch(() => {});

    // 예정 알림 시간보다 일찍 기록한 경우 → 안내 팝업.
    // 시각 폴백 우선순위: 슬롯 time → legacy meal_schedules[key] → 기본값.
    // (mealTime 이 null 인 비표준 슬롯도 슬롯 time 으로 안내 가능)
    const schedStr =
      selSlot?.time ||
      (mealTime ? (userMealSchedules?.[mealTime] ?? DEFAULT_MEAL_TIMES[mealTime]) : undefined);
    let isPreMed = false;
    if (schedStr) {
      const [schedH, schedM] = schedStr.split(':').map(Number);
      const schedMinutes = schedH * 60 + schedM;
      const nowMinutes = nowForCheck.getHours() * 60 + nowForCheck.getMinutes();
      isPreMed = nowMinutes < schedMinutes;
      if (isPreMed) {
        const label =
          (mealTime ? t(MEAL_LABEL_KEYS[mealTime]) : null) ||
          selSlot?.label ||
          '';
        const formattedTime = formatMealTime(schedStr);
        const labelPrefix = label ? t('medication.labelPrefix', { label }) : '';
        setPreMedMessage(t('medication.preMedMsg', { labelPrefix, time: formattedTime }));
      }
    }

    // selectedMealTime 은 BodyState 네비/취침 변비질문에 쓰임 → legacy key 유지(없으면 null).
    setSelectedMealTime(mealTime);

    // 다음 예정 알림 조회 — ⚠️ 절대 공통 경로에서 await 하지 말 것(성능 회귀 지점).
    //   직전 수정이 이 조회를 await 로 막아, 복용직후 추적이 있는 슬롯(immediateTrack=true)에서도
    //   네트워크 조회가 끝날 때까지 몸상태 권유 팝업이 늦게 떴다. → 병렬 promise 로 시작만 하고
    //   결과는 .then() 으로 state(nextNotifInfo)에 담아둔다.
    //   - immediateTrack=true 경로: 권유 팝업을 즉시 띄우고, "나중에"/닫기 시점(나중)에
    //     state nextNotifInfo 를 읽어 다음알림 표시 → 즉시성 복원.
    //   - immediateTrack=false 경로(복용직후 추적 없음): 이 분기에서만 promise 결과가 즉시 필요하므로
    //     아래에서 한정적으로 await 하여 다음알림 팝업 표시.
    // ⚠️ patientId 견고 확보: state patientId 가 아직 null 이어도(콜드스타트/스테일 클로저:
    //    confirmAndRecordSlot 는 useCallback([dialog]) 라 첫 렌더의 stale proceedSave→patientId=null
    //    을 캡처할 수 있다) 다음알림 조회가 Promise.resolve(null) 로 새지 않게 한다.
    //    - 환자 본인: user.id 로 폴백(항상 자기 자신).
    //    - 보호자: state patientId(해석 완료값) 사용.
    const resolvedPatientId =
      patientId ?? (user?.role === 'patient' ? (user?.id ?? null) : null);
    // 방금 기록한 복용의 약효추적 시점을 결정적으로 후보에 포함시킨다.
    //   큐(effect_tracking_queue) insert 는 takeMedication 의 백그라운드 invoke 라
    //   이 시점엔 아직 큐에 없을 수 있다(경합). selSlot 의 track_intervals 로 직접 계산해
    //   넘겨주면 큐 적재 여부와 무관하게 "복용 30분 후" 같은 약효추적이 후보로 들어간다.
    //   - 추적 OFF(trackEnabled=false) 슬롯은 약효추적 자체가 없으므로 전달하지 않음.
    //   - taken_at 은 방금(now) 기록이므로 nowForCheck 로 앵커(서버 큐 send_at 계산과 일치).
    // ⚠️ track 설정 출처: 화면 in-memory 의 selSlot(displaySlots.find)은 콜드스타트/알림진입에서
    //    아직 비었거나 legacy(가상 슬롯 → id=null, trackIntervals=[]) 라 못 찾거나 빈 값일 수 있다.
    //    그 경우 justTaken=null → "복용 30분 후 약효추적" 후보가 누락되고, 큐 적재(서버 백그라운드)
    //    까지 수 초 지연(race)되면 가장 가까운 후보가 더 먼 운동 알림으로 잘못 선택됐다(라이브 확정).
    //    → takeMedication 이 fresh fetch 한 resolvedSlot 기준으로 반환한 track 설정을 1순위로 쓰고,
    //      그게 없을 때만(legacy 환자 등) selSlot 으로 폴백한다.
    const trackEnabledEff = result.trackEnabled ?? selSlot?.trackEnabled ?? false;
    const trackIntervalsEff = result.trackIntervals ?? selSlot?.trackIntervals ?? null;
    const slotLabelEff = selSlot?.label ?? null;
    const justTaken =
      trackEnabledEff && (trackIntervalsEff?.length ?? 0) > 0
        ? { takenAt: nowForCheck, trackIntervals: trackIntervalsEff, slotLabel: slotLabelEff }
        : null;
    const nextNotifPromise: Promise<NextNotifInfo | null> = resolvedPatientId
      ? fetchNextNotifMessage(resolvedPatientId, justTaken).catch(() => null)
      : Promise.resolve(null);
    // ⚠️ 표시 타이밍 분리: promise 핸들을 ref 에 보관해 둔다. 선행 팝업 닫기 핸들러는
    //    state(nextNotifInfo) 가 아직 null 이어도 이 ref 를 await 해서 보장된 값을 쓴다.
    nextNotifPromiseRef.current = nextNotifPromise;
    nextNotifPromise.then((info) => {
      if (info) setNextNotifInfo(info);
    });

    // "복용 직후" 설정이 켜져 있을 때만 복용 직후 자동 몸상태 팝업을 띄운다.
    // ⚠️ 게이팅 소스를 takeMedication 의 effectiveNotifs 와 일원화한다.
    //    takeMedication 이 반환한 immediateTrack 은 방금 기록한 그 슬롯(콜드스타트 시 fresh fetch)
    //    기준으로 산출되므로, 화면 in-memory 의 stale 한 displaySlots 를 다시 보지 않는다.
    //  - dose_slot 환자: immediateTrack === true 일 때만(슬롯 추적 ON + track_intervals 에 0 포함) 표시.
    //    track_intervals=[30] 처럼 0이 없으면 immediateTrack=false → 표시 안 함(이 버그의 수정 지점).
    //  - legacy 환자(doseSlotId 없음): immediateTrack === null → 기존 동작대로 항상 표시.
    const showImmediateSuggest =
      result.immediateTrack === null ? true : result.immediateTrack === true;
    immediateSuggestRef.current = showImmediateSuggest;

    // ⚠️ iOS는 모달을 동시에 두 개 띄우지 못함 → 안내 팝업과 몸상태 권유가 겹치면
    //    하나 닫은 뒤 안 보이는 오버레이가 남아 스크롤이 막힘.
    //    따라서 사전기록 안내가 있으면 그 팝업을 먼저 띄우고, 닫힌 뒤(onClose)에 몸상태 권유를 표시한다.
    if (isPreMed) {
      // 사전기록 안내 → 스피너가 완전히 사라진 뒤(onHidden) 단독 present.
      pendingNextRef.current = { kind: 'preMed' };
    } else if (showImmediateSuggest) {
      // 몸상태 권유 → 스피너 onHidden 에서 단독 present(적층 회피).
      //    다음알림 정보는 권유 팝업의 "나중에"/닫기 시점에 promise ref(resolveAndShowNextNotif)로 읽는다.
      pendingNextRef.current = { kind: 'bodyStateSuggest' };
    } else {
      // [버그수정 B] 복용직후 추적이 없어 몸상태 권유 팝업을 안 띄우는 경우(예: 12시 약):
      //   저장이 끝나 더 입력할 게 없으므로, 다음알림 정보가 있으면 바로 다음알림 팝업을 띄운다.
      //   (권유 팝업 경로에서는 그 팝업 종료 시 표시하므로 여기 분기와 중복되지 않는다.)
      //
      // ⚠️ 표시 타이밍을 onHidden 으로 일원화: 기존 setTimeout(400ms)/선행 confirm 토글과의
      //    적층 회피를 위해 쓰던 지연을 제거하고, 스피너 Modal 이 완전히 사라진 뒤(onHidden)
      //    NextNotifModal 을 단독 present 한다. confirm→스피너→다음모달 3개가 절대 동시에 안 뜬다.
      // ⚠️ nextNotifPromise 는 스피너가 떠 있는 동안 await 해 결과를 pendingNextRef 에 담아둔다.
      // ⚠️ null-게이트 제거: 다음 알림은 최소한 내일 복용이라도 항상 존재하므로,
      //    fetch 가 null/throw 여도 폴백 정보로 "무조건" 다음알림 팝업을 띄운다.
      const nextNotifInfoLocal = (await nextNotifPromise) ?? FALLBACK_NEXT_NOTIF;
      pendingNextRef.current = { kind: 'nextNotif', info: nextNotifInfoLocal };
    }

    // [임시 진단] 복용직후 팝업 유실 원인 추적 — fire-and-forget(흐름 영향 없음). 원인 확인 후 제거.
    try {
      (supabase.from('med_flow_debug' as any) as any)
        .insert({
          patient_id: resolvedPatientId,
          med_log_id: result.medLogId,
          dose_slot_id: result.doseSlotId,
          stage: 'proceedSave',
          immediate_track: String(result.immediateTrack),
          pending_kind: pendingNextRef.current?.kind ?? 'NULL',
          track_intervals: JSON.stringify(trackIntervalsEff ?? null),
          note: `isPreMed=${isPreMed} showImmediateSuggest=${showImmediateSuggest}`,
        })
        .then(() => {}, () => {});
    } catch {}
    } finally {
      // in-flight 락 해제(성공/실패/조기반환 무관).
      proceedSaveInFlightRef.current = false;
      // ⚠️ 스피너 해제 보장 — takeMedication 이 throw 해도 여기서 반드시 내려간다.
      //    내려간 뒤(Modal dismiss 완료) onHidden 이 pendingNextRef 의 후속 팝업을 단독 present.
      setSaving(false);
    }
  };

  // 스피너(BrandProgressOverlay)가 화면에서 완전히 사라진 뒤 1회 호출.
  //   이 시점엔 스피너 Modal 이 확실히 내려가 있으므로 후속 팝업을 적층 없이 단독 present.
  const handleSavingHidden = useCallback(() => {
    const pending = pendingNextRef.current;
    pendingNextRef.current = null;
    // [임시 진단] onHidden 이 실제로 발화했는지 + 그때 pending 종류. 원인 확인 후 제거.
    try {
      (supabase.from('med_flow_debug' as any) as any)
        .insert({ stage: 'savingHidden', pending_kind: pending?.kind ?? 'NULL', note: 'handleSavingHidden fired' })
        .then(() => {}, () => {});
    } catch {}
    if (!pending) return;
    switch (pending.kind) {
      case 'error':
        dialog.alert({ title: pending.title, message: pending.message });
        break;
      case 'preMed':
        setShowPreMedInfo(true);
        break;
      case 'bodyStateSuggest':
        setShowBodyStateSuggest(true);
        break;
      case 'nextNotif':
        setNextNotifInfo(pending.info);
        setShowNextNotifModal(true);
        break;
    }
  }, [dialog]);

  // 선택(mealTime/doseSlotId) → activeStatus 키 해석.
  // dose_slots 환자면 슬롯 id, 미이관 환자면 meal key 그대로.
  // (write 경로의 "이미 기록 있음" 확인용 — 표시 규칙과 동일하게 슬롯 단위로 조회)
  const findLogBySel = (sel: { mealTime: MealTime | null; doseSlotId: string | null }): any => {
    const slot = sel.doseSlotId
      ? displaySlots.find((s) => s.id === sel.doseSlotId)
      : (sel.mealTime ? displaySlots.find((s) => s.legacyKey === sel.mealTime) : undefined);
    const key = slot ? slotStatusKey(slot) : (sel.doseSlotId ?? sel.mealTime);
    return (key && activeStatus[key]) || (sel.mealTime && (activeStatus as any)[sel.mealTime]) || null;
  };

  const handleMealTimeSelect = (sel: { mealTime: MealTime | null; doseSlotId: string | null }) => {
    setShowMealTimeModal(false);

    // 라벨: legacy key 우선, 없으면 슬롯 label.
    const selSlot = sel.doseSlotId
      ? displaySlots.find((s) => s.id === sel.doseSlotId)
      : (sel.mealTime ? displaySlots.find((s) => s.legacyKey === sel.mealTime) : undefined);
    const label =
      (sel.mealTime ? t(MEAL_LABEL_KEYS[sel.mealTime]) : null) ||
      selSlot?.label ||
      '';
    const labelPrefix = label ? t('medication.labelPrefix', { label }) : '';

    // 이미 기록이 있으면 덮어쓰기 확인
    const existingLog = findLogBySel(sel);
    if (existingLog) {
      const takenAtStr = formatTakenAt(existingLog.taken_at);
      dialog
        .confirm({
          title: t('medication.alreadyRecordedTitle'),
          message: t('medication.alreadyRecordedMsg', { labelPrefix, time: takenAtStr }),
          confirmText: t('medication.overwrite'),
          cancelText: t('common.cancel'),
        })
        .then((ok) => {
          if (ok) proceedSave(sel);
        });
      return;
    }

    proceedSave(sel);
  };

  // sel(알림에 실린 식별자)로 슬롯 리스트에서 대상 슬롯 찾기. doseSlotId 우선, mealTime 보조.
  const matchSlot = useCallback(
    (
      slotList: DoseSlot[],
      sel: { mealTime: string | null; doseSlotId: string | null },
    ): DoseSlot | undefined =>
      sel.doseSlotId
        ? slotList.find((s) => s.id === sel.doseSlotId)
        : (sel.mealTime ? slotList.find((s) => s.legacyKey === sel.mealTime) : undefined),
    [],
  );

  // 슬롯을 확정한 뒤 "○○ 약을 드셨나요?" 확인 다이얼로그 → 바로 기록. (자동 판별 결과 확정 경로)
  const confirmAndRecordSlot = useCallback(
    (selSlot: DoseSlot) => {
      const title = slotTitle(selSlot.label, selSlot.legacyKey, selSlot.time);

      // [복용 완료 게이트 — 1순위 수정]
      //   알림 진입은 med_logs 완료 상태를 보지 않고 무조건 확인 다이얼로그를 띄워왔다.
      //   그 결과 이미 복용한 슬롯에 재진입하면 같은 확인 다이얼로그가 또 떴다.
      //   여기서 오늘 현황(todayBySlotId, ref=최신값)으로 그 슬롯이 이미 복용 완료인지 먼저 판정한다.
      //   - 완료면: 확인 다이얼로그 대신 "이미 복용하셨어요" 간단 안내만 하고 종료.
      //   - 로딩 중(현황 미확정)이면: 오판 방지를 위해 게이트를 적용하지 않고 기존 동작 유지.
      //     (이 경우 handleMealTimeSelect 의 "이미 기록이 있어요" 덮어쓰기 확인이 2차 방어로 남는다.)
      //   - slotStatusKey 와 동일 규칙(slot.id ?? legacyKey)으로 키 산출.
      const slotKey = selSlot.id ?? selSlot.legacyKey ?? null;
      if (todayStatusReadyRef.current && slotKey) {
        const existing = todayBySlotIdRef.current?.[slotKey];
        if (existing) {
          const takenAtStr = existing.taken_at ? formatTakenAt(existing.taken_at) : '';
          dialog.alert({
            title: t('medication.alreadyTakenTitle'),
            message: takenAtStr
              ? t('medication.alreadyTakenMsgAt', { title, time: takenAtStr })
              : t('medication.alreadyTakenMsg', { title }),
          });
          return;
        }
      }

      dialog
        .confirm({
          title: t('medication.recordTitle'),
          message: t('medication.recordConfirmMsg', { title }),
          confirmText: t('medication.recordConfirmYes'),
          cancelText: t('medication.recordConfirmOther'),
        })
        .then((ok) => {
          if (ok) {
            // 이미 기록이 있으면 handleMealTimeSelect 가 덮어쓰기 확인 후 저장.
            handleMealTimeSelect({
              mealTime: (selSlot.legacyKey as MealTime | null) ?? null,
              doseSlotId: selSlot.id ?? null,
            });
          } else {
            // 자동 판별이 틀렸을 수 있으니 전체 선택 모달로.
            setShowMealTimeModal(true);
          }
        });
    },
    [dialog],
  );

  // 진입 스피너(BrandProgressOverlay)가 화면에서 완전히 사라진 뒤 1회 호출.
  //   이 시점엔 스피너 Modal 이 확실히 내려가 있으므로, 복용 확인 다이얼로그(또는 폴백 모달)를
  //   적층 없이 단독 present 한다(진입스피너 → (닫힘) → confirm 순서 보장 = 모달 적층 교착 회피).
  const handleEnteringHidden = useCallback(() => {
    const pending = pendingEnterRef.current;
    pendingEnterRef.current = null;
    if (!pending) return;
    if (pending.kind === 'confirm') {
      confirmAndRecordSlot(pending.slot);
    } else {
      if (pending.mealTime) setSelectedMealTime(pending.mealTime);
      setShowMealTimeModal(true);
    }
  }, [confirmAndRecordSlot]);

  // 알림(약 복용/미복용)을 눌러 진입한 경우: 알림에 실린 슬롯 식별자로 "어떤 약인지" 자동 판별.
  //  → 매번 시간대를 직접 고르게 하지 않고, "○○ 약을 드셨나요?" 한 번만 확인받고 바로 기록.
  //  (자동 판별이 틀렸으면 '다른 시간 선택'으로 기존 선택 모달로 폴백)
  //
  // 콜드스타트 stale closure 대비:
  //  - 렌더 캡처된 displaySlots 가 (콜드스타트라) 비었거나 legacy 라 doseSlotId(8:10 등 비표준 슬롯)
  //    매칭에 실패하면, 그 자리에서 fetchPatientDoseSlots 로 최신 슬롯을 직접 조회해 매칭한다.
  //  - patientId 가 아직 로드 전이면 짧게(2회·400/800ms) 재시도. 로드되면 fresh fetch 로 한 번에 해결.
  //  - 가드(notifEntryGuardRef)는 "확인 다이얼로그를 띄웠다"는 중복방지 용도 → 슬롯을 찾아
  //    다이얼로그를 띄울 때만 점유한다. 못 찾아 폴백/대기하는 경로는 가드를 점유하지 않아
  //    먼저 도착한 stale 경로가 폴백해도 다른 경로가 재시도할 수 있다.
  // attempt: patientId 로드 전 짧은 재시도 카운터.
  async function enterFromNotification(
    sel: { mealTime: string | null; doseSlotId: string | null },
    attempt: number = 0,
  ) {
    // ⚠️ 크래시 안전망: 알림 탭으로 콜드스타트 진입 시 이 경로(async fetch·dialog·setState)에서
    //   어떤 throw 가 나도 앱이 죽지 않게 전체를 try/catch 로 감싼다(setTimeout 호출이라 미처리 시
    //   uncaught → 크래시·콜드스타트 무한루프). 자동선택 실패해도 최소한 전체 선택 모달로 폴백한다.
    try {
      // 이미 확인 다이얼로그를 띄운 직후면(3초 윈도우) 중복 진입 차단.
      if (Date.now() - notifEntryGuardRef.current < 3000) return;

      // [H-2 TOCTOU 수정] 가드 점유를 await(fetchPatientDoseSlots) '이전'으로 옮긴다.
      //   기존엔 가드 세팅이 await 뒤(아래 confirmAndRecordSlot 직전)에 있어, 콜드스타트에서
      //   두 트리거(autoOpen route / intentManager / consumePendingMedNotif)가 await 사이에
      //   겹치면 둘 다 위 3초 체크를 통과 → 확인 다이얼로그가 2번 떴다.
      //   여기서 즉시 점유하면 두 번째 트리거는 위 체크에 막힌다.
      //   단, 슬롯을 못 찾아 폴백/재시도(=다이얼로그 미표시)하는 경로에서는 반드시 해제(=0)해
      //   먼저 도착한 stale 경로가 폴백해도 정상 경로/재시도가 다시 진입할 수 있게 한다.
      notifEntryGuardRef.current = Date.now();

      // 1) 렌더 캡처된 displaySlots 에서 우선 탐색 — 워밍 경로(네트워크 대기 없음).
      //    즉시 매칭되면 스피너 없이 바로 확인 다이얼로그(불필요한 번쩍임/지연 방지).
      const warmSlot = matchSlot(displaySlots, sel);
      if (warmSlot) {
        // 슬롯 확정 → 가드를 다이얼로그 표시 시점으로 재스탬프(3초 윈도우 기준 갱신) 후 확인 다이얼로그.
        notifEntryGuardRef.current = Date.now();
        confirmAndRecordSlot(warmSlot);
        return;
      }

      // 2) displaySlots 미매칭 + patientId 미로드(콜드스타트 state 로드 대기) → 짧게 재시도.
      //    이 대기는 네트워크가 아니라 sub-초 state 로드라 스피너를 띄우지 않는다
      //    (재진입은 ref 로 fresh patientId 를 캡처해 곧 아래 3) 네트워크 조회로 넘어간다).
      if (!patientId) {
        // 재시도/폴백 모두 다이얼로그를 띄우지 않으므로 가드 해제 — 재진입 허용.
        notifEntryGuardRef.current = 0;
        if (attempt < 2) {
          const delay = attempt === 0 ? 400 : 800;
          setTimeout(() => { safeEnterFromNotification(sel, attempt + 1); }, delay);
          return;
        }
        // 끝까지 patientId 가 없으면 기존처럼 전체 선택 모달로 폴백.
        if (sel.mealTime) setSelectedMealTime(sel.mealTime as MealTime);
        setShowMealTimeModal(true);
        return;
      }

      // 3) patientId 확보 + displaySlots 미매칭 → 최신 dose_slots 직접 조회(네트워크, stale closure 회피).
      //    ⚠️ 사용자가 무피드백으로 기다리던 지점 → 진입 스피너("불러오는 중이에요")를 표시한다.
      //    ⚠️ 모달 적층 회피: 스피너가 떠 있는 동안 confirm 다이얼로그를 띄우지 않는다.
      //       조회 결과(확인/폴백)를 pendingEnterRef 에 담고 setEntering(false) → 스피너 onHidden 에서 단독 present.
      //    ⚠️ 해제 보장: try/finally 의 finally 에서 스피너를 반드시 내린다(조회 실패/throw/슬롯 못 찾음 무관).
      setEntering(true);
      enteringActiveRef.current = true;
      let resolvedSlot: DoseSlot | undefined;
      try {
        invalidateDoseSlotsCache(patientId);
        const fresh = await fetchPatientDoseSlots(patientId);
        resolvedSlot = matchSlot(fresh, sel);
      } catch (fetchErr) {
        // fresh fetch 실패해도 죽지 않고 폴백으로(스피너는 finally 에서 해제).
        console.warn('[MedicationScreen] enterFromNotification fresh fetch 실패:', fetchErr);
        resolvedSlot = undefined;
      } finally {
        enteringActiveRef.current = false;
        if (resolvedSlot) {
          // 슬롯 확정 → 가드 재스탬프(3초 윈도우 갱신) 후, 스피너 onHidden 에서 확인 다이얼로그 단독 present.
          notifEntryGuardRef.current = Date.now();
          pendingEnterRef.current = { kind: 'confirm', slot: resolvedSlot };
        } else {
          // 슬롯 못 찾음 → 다이얼로그 미표시이므로 가드 해제, 스피너 onHidden 에서 전체 선택 모달 단독 present.
          notifEntryGuardRef.current = 0;
          pendingEnterRef.current = { kind: 'fallbackModal', mealTime: (sel.mealTime as MealTime | null) ?? null };
        }
        // 스피너 해제 → onHidden(handleEnteringHidden)에서 pendingEnterRef 동작을 단독 present.
        setEntering(false);
      }
      return;
    } catch (e) {
      // 어떤 예외든 크래시 대신 안전 폴백: 약복용 화면 전체 선택 모달.
      //  (폴백 경로 — 가드 해제해 정상 재진입 허용.)
      notifEntryGuardRef.current = 0;
      console.error('[MedicationScreen] enterFromNotification 예외(안전망 폴백):', e);
      try {
        if (enteringActiveRef.current) {
          // 진입 스피너가 켜진 채 예외가 났다면, 폴백 모달을 스피너 위에 적층하지 말고
          //   스피너를 내린 뒤 onHidden 에서 단독 present(해제 보장 + 적층 회피).
          enteringActiveRef.current = false;
          pendingEnterRef.current = { kind: 'fallbackModal', mealTime: (sel?.mealTime as MealTime | null) ?? null };
          setEntering(false);
        } else {
          if (sel?.mealTime) setSelectedMealTime(sel.mealTime as MealTime);
          setShowMealTimeModal(true);
        }
      } catch {
        // setState 조차 실패하면(언마운트 등) 조용히 무시 — 앱은 살아있다.
      }
    }
  }

  // enterFromNotification 의 stale closure 방지: 항상 최신 displaySlots 를 잡은 함수를 호출하도록 ref 화.
  // (subscribe useEffect 등 빈 deps 경로가 콜드스타트 시점의 빈/legacy displaySlots 클로저를 영구 캡처하던 문제 해결)
  const enterFromNotificationRef = useRef(enterFromNotification);
  enterFromNotificationRef.current = enterFromNotification;

  // 안전 호출 래퍼: setTimeout/subscribe 콜백에서 ref 가 undefined 이거나
  // 호출 자체가 throw 해도(콜드스타트 타이밍) uncaught 로 앱이 죽지 않게 한다.
  const safeEnterFromNotification = useCallback(
    (sel: { mealTime: string | null; doseSlotId: string | null }, attempt: number = 0) => {
      try {
        const fn = enterFromNotificationRef.current;
        if (typeof fn !== 'function') return;
        void fn(sel, attempt).catch((e) => {
          console.error('[MedicationScreen] enterFromNotification reject(무시):', e);
        });
      } catch (e) {
        console.error('[MedicationScreen] safeEnterFromNotification throw(무시):', e);
      }
    },
    [],
  );

  const handleBodyStateSave = async (record: { bodyScore: number; moodScore: number; sleepScore?: number; constipation?: boolean }) => {
    await saveBodyState({
      body_state: record.bodyScore,
      mood: record.moodScore,
      sleep_quality: record.sleepScore,
      constipation: record.constipation,
      trigger_time_label: 'after_medication',
    }, 'notification');
    setShowBodyStatePopup(false);
    setSelectedMealTime(null);
  };

  // ─── 표시 슬롯 리스트(단일 분기점) ────────────────────────────────────────────
  // dose_slots 환자면 N개 동적, 미이관 환자면 legacy 4슬롯 가상슬롯.
  // (resolveDisplaySlots 가 useMedication.slots 가 비면 meal_schedules 로 폴백)
  const displaySlots: DoseSlot[] = resolveDisplaySlots(doseSlots, userMealSchedules, notifPrefs);

  // ─── 슬롯 로딩 게이트(디폴트 시각 깜빡임 방지) ─────────────────────────────────
  // 콜드스타트(slotsCache 미스) 시 dose_slots 가 아직 도착하지 않았는데도
  // resolveDisplaySlots 가 buildLegacySlots 폴백으로 하드코딩 디폴트 시각
  // (아침08:00/점심12:00/저녁18:00/취침22:00)을 한 프레임 그려 깜빡인다.
  // → 로딩 중(slotsLoading: patientId 미resolve 포함)이고 아직 실제 슬롯이
  //   안 들어왔으면(doseSlots 0개) 시간 카드 대신 스켈레톤을 렌더한다.
  // 캐시 히트(세션 내 재진입)는 doseSlots 가 이미 채워져 slotsLoading=false →
  //   스켈레톤 없이 즉시 실제값 표시. legacy(미이관) 환자도 로딩이 끝나면
  //   (slotsLoading=false) 정상적으로 legacy 슬롯이 보인다.
  // "아직 로딩 중" vs "조회 끝 + 진짜 0개"를 구분: 후자(slotsLoading=false)는
  //   기존대로 resolveDisplaySlots 결과(legacy 합성 또는 빈 목록)를 그대로 표시.
  const slotsResolving = slotsLoading && doseSlots.length === 0 && !slotsError;

  // 슬롯의 현황 키 = dose_slot id 또는 legacyKey(=meal_time). activeStatus 와 동일 규칙.
  const slotStatusKey = (slot: DoseSlot): string | null => slot.id ?? slot.legacyKey ?? null;

  // [변비/수면 게이팅] 변비=그날 "마지막 약효추적 시점", 수면=그날 "첫 약효추적 시점" 1건에서만.
  //   ⚠️ BodyStateScreen 과 동일 로직. 슬롯-id 기준 게이팅은 같은 슬롯의 복용직후 + 약효추적 기록이
  //      모두 게이트를 통과시켜 변비가 마지막 슬롯의 복용직후에서 떠버렸다(정반대 동작).
  //   → "슬롯시각 + interval" 합으로 펼친 그날 약효추적 시점들의 최댓값/최솟값과 정확히 일치하는
  //      단 1건에서만 묻는다(getTrackingDayBounds).
  const isDoseSlotPatient = hasDoseSlots;
  const trackingDayBounds = getTrackingDayBounds(displaySlots);
  // 복용 직후 몸상태 팝업은 "복용 직후"(after_medication, interval=0) 기록이다.
  //   (dose_slot 환자에서 이 팝업은 immediateTrack=true, 즉 슬롯 trackIntervals 에 0 포함일 때만 뜬다.)
  //   현재 약효추적 시점(분, 자정 기준) = 방금 복용한 슬롯(lastDoseSlotId)의 시각 + 0.
  const currentTrackingMin: number | null = (() => {
    if (!lastDoseSlotId) return null;
    const slot = displaySlots.find((s) => s.id === lastDoseSlotId);
    if (!slot) return null;
    const base = slotSortValue(slot.time);
    return Number.isFinite(base) ? base : null; // + interval 0
  })();

  // [수면 게이팅] 그날 이미 수면(sleep_quality)이 기록됐는지 — "하루 1회"(중복 방지) 불변식 유지용.
  //   BodyStateScreen 과 대칭. 이미 로드된 오늘 on_off_logs(useBodyState.todayLogs)에서 판단(추가 쿼리 없음).
  //   저장 시 saveBodyState 가 insert 결과 행을 todayLogs 에 반영 → 다음 진입에서 중복 노출이 막힌다.
  const hasSleepToday = bodyStateTodayLogs.some((log: any) => log?.sleep_quality != null);

  // displaySlots → MedicationStatus[] 변환 (카드 표시용, 디자인 그대로)
  const displayList: MedicationStatus[] = displaySlots.map((slot, idx) => {
    const key = slotStatusKey(slot);
    const log = key ? activeStatus[key] : null;
    // 라벨: 설정 화면(slotTitle)과 동일하게 이름+시각 인라인 → "아침 오전 6:00", "밤 11:00".
    const label = slotTitle(slot.label, slot.legacyKey, slot.time);
    // 시간대 아이콘용 원본 시각(HH:MM).
    const slotTime = slot.time;
    const labelHasTime = true; // 시각이 라벨에 포함되므로 시각을 별도로 표시하지 않음
    // 시각: 슬롯 time(HH:MM) → '오전 H:MM'
    const timeStr = formatSlotTime(slot.time);
    // 카드 key: 슬롯 id(이관) 또는 legacyKey(미이관). 둘 다 없으면 시각+idx로 고유화.
    const cardId = (slot.id ?? slot.legacyKey ?? `${slot.time}-${idx}`) as any;

    return log
      ? { id: cardId, label, slotTime, time: timeStr, labelHasTime, taken: true, takenAt: formatTakenAt(log.taken_at), medLogId: log.id }
      : { id: cardId, label, slotTime, time: timeStr, labelHasTime, taken: false };
  });

  // 오늘 모든 활성 슬롯 복용 완료 여부 (4슬롯 가정 제거, N개 every)
  const allSlotsTaken =
    isToday &&
    displaySlots.length > 0 &&
    displaySlots.every((slot) => {
      const key = slotStatusKey(slot);
      return key ? !!activeStatus[key] : false;
    });

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title={t('medication.brandTitle')}
        showParkinon
        showKakao
        onKakaoPress={() => {
          Linking.openURL(KAKAO_OPEN_CHAT_URL).catch(() => {});
        }}
        showDiary
        onDiaryPress={() => navigateTo('Diary')}
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigateTo('NotificationHistory', { mode: 'all' })}
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getDateLabel(selectedDate)}</Text>
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
          
        </TouchableOpacity>
      </View>

      <ScrollView ref={scrollRef} style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 첫 로그인/미등록 유도 배너 — 활성 dose_slot 0개일 때만 노출(그룹 기준, 역할 무관).
            단, 미연동 보호자는 등록할 환자가 없어 "복용 시간대 등록" 안내가 오노출되므로 숨김
            (메인 버튼 아래 '환자와 연동 후 기록할 수 있어요' 안내가 대신 노출됨). 환자 본인 0슬롯엔 정상 노출. */}
        {!caregiverUnlinked && <SetupGuideBanner />}

        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              (userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday || allSlotsTaken) && styles.mainButtonDisabled,
            ]}
            disabled={userRole === 'caregiver_no_patient' || userRole === 'caregiver_separate' || !isToday || allSlotsTaken}
            onPress={async () => {
              if (await ensureNotGuest(user, dialog, { signOut })) return;
              // 게이팅(B차): 미등록(활성 슬롯 0)이면 모달을 열지 않고 통합 등록 유도.
              if (!(await requireSetup(dialog))) return;
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                setShowMealTimeModal(true);
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name={allSlotsTaken ? 'checkmark-circle' : 'medkit'} size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>
                {allSlotsTaken ? t('medication.mainButtonDone') : t('medication.mainButtonRecord')}
              </Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('medication.noticeCaregiverNoPatient')}</Text>
          )}
          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>{t('medication.noticeCaregiverSeparate')}</Text>
          )}
          {!isToday && userRole !== 'caregiver_separate' && userRole !== 'caregiver_no_patient' && (
            <Text style={styles.caregiverNotice}>{t('medication.noticeNotToday')}</Text>
          )}
        </View>

        {/* 오늘 복용 현황 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>{isToday ? t('medication.statusTitleToday') : t('medication.statusTitle')}</Text>
            <View style={styles.divider} />
          </View>
          {/* 광고: 오늘 복용 현황 리스트 최상단(첫 슬롯 자리) — 해외+free 전용 */}
          <AdSlot placement="medication" />
          {slotsResolving ? (
            /* 콜드스타트 로딩 중 — 디폴트 시각 대신 스켈레톤(깜빡임 방지) */
            <>
              {[0, 1, 2, 3].map((i) => (
                <View key={`skeleton-${i}`} style={styles.cardShadow}>
                  <SkeletonCard index={i} />
                </View>
              ))}
            </>
          ) : (
          displayList.map(item => (
            /* 그림자용 outer wrapper */
            <View key={item.id} style={styles.cardShadow}>
              {/* overflow hidden inner wrapper */}
              <View style={[styles.cardInner, item.taken ? styles.cardInnerDone : styles.cardInnerPending]}>
                {/* 완료: 박스 전체 연녹색 배경(cardInnerDone) / 미완료: 흰색 배경 — 좌측 띠 없음 */}
                <View style={[styles.cardContent, item.taken && styles.cardContentDone]}>
                  <Ionicons
                    name={item.taken ? 'checkmark-circle' : 'time-outline'}
                    size={28}
                    color={item.taken ? Colors.dark : Colors.accent}
                    style={styles.cardIcon}
                  />
                  <View style={styles.cardBody}>
                    <View style={styles.cardLabelRow}>
                      <SlotTimeIcon time={item.slotTime} size={28} />
                      <Text style={styles.cardLabel}>{t('medication.cardMedLabel', { label: item.label })}</Text>
                    </View>
                    <Text style={styles.cardTime}>
                      {item.taken
                        ? t('medication.cardTaken', { time: item.takenAt })
                        : item.labelHasTime
                          ? t('medication.cardScheduled')
                          : t('medication.cardScheduledAt', { time: item.time })}
                    </Text>
                  </View>
                </View>
                {/* 미완료: '취소' 버튼과 완전히 동일한 디자인(투명 배경·테두리 없음·연회색)의 표시용 배지. 같은 우측 위치/크기로 정렬. 누르는 기능 없음(표시 전용) */}
                {!item.taken && (
                  <View style={styles.cardCancelBtn}>
                    <Text style={styles.cardCancelText}>{t('medication.cardIncomplete')}</Text>
                  </View>
                )}
                {item.taken && canCancelRecord && item.medLogId && (
                  <TouchableOpacity
                    style={styles.cardCancelBtn}
                    onPress={() => handleCancelRecord(item.medLogId!)}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                    activeOpacity={0.7}
                  >
                    <Text style={styles.cardCancelText}>{t('medication.cardCancel')}</Text>
                  </TouchableOpacity>
                )}
              </View>
            </View>
          ))
          )}
        </View>

        {/* 과거 기록 보기 타임라인 */}
        <HistoryTimeline type="medication" patientId={patientId} refreshKey={recordsRefreshKey} />
      </ScrollView>

      <MealTimeModal
        visible={showMealTimeModal}
        onSelect={handleMealTimeSelect}
        onClose={() => setShowMealTimeModal(false)}
        mealSchedules={userMealSchedules}
        notifPrefs={notifPrefs}
      />
      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={patientName}
        onConfirm={() => { setShowCaregiverConfirm(false); setShowMealTimeModal(true); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <DevLetterModal
        visible={showDevLetter}
        onClose={() => {
          setShowDevLetter(false);
          // 편지가 닫힌 뒤: 최초 1회 알림 설정 화면으로 강제, 이후엔 가족 연동 안내.
          afterDevLetterClose();
        }}
      />
      <Modal
        visible={showBodyStateSuggest}
        transparent
        animationType="fade"
        onRequestClose={() => {
          // [버그수정 B] 권유 팝업을 백버튼으로 닫는 것도 "나중에"와 동일 처리 — 다음알림 팝업 표시.
          //   ("기록하기"는 BodyState로 이어지므로 거기선 다음알림 스킵 — 별도 onPress에서 처리.)
          //   ⚠️ 표시 타이밍 분리: state 가 아직 null 이어도 promise ref 를 await 해 보장된 값으로 표시.
          setShowBodyStateSuggest(false);
          setSelectedMealTime(null);
          resolveAndShowNextNotif();
        }}
      >
        <View style={{
          flex: 1,
          justifyContent: 'center',
          alignItems: 'center',
          backgroundColor: 'rgba(0,0,0,0.45)',
          paddingHorizontal: 28,
        }}>
          <View style={{
            backgroundColor: '#fff',
            borderRadius: 20,
            padding: 28,
            width: '100%',
            alignItems: 'center',
            elevation: 8,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 4 },
            shadowOpacity: 0.15,
            shadowRadius: 12,
          }}>
            <View style={{
              width: 64, height: 64, borderRadius: 32,
              backgroundColor: '#FFF3E0',
              alignItems: 'center', justifyContent: 'center',
              marginBottom: 16,
            }}>
              <Text style={{ fontSize: 32 }}>😊</Text>
            </View>
            <Text style={{
              fontSize: 20, fontWeight: '700', color: '#222',
              textAlign: 'center', marginBottom: 10,
            }}>
              {t('medication.bodyStateSuggestTitle')}
            </Text>
            <Text style={{
              fontSize: 15, color: '#666', textAlign: 'center',
              lineHeight: 22, marginBottom: 24,
            }}>
              {t('medication.bodyStateSuggestDesc')}
            </Text>
            <TouchableOpacity
              onPress={async () => {
                const mealTimeForNav = selectedMealTime;
                // 7단계: 즉시 몸상태 팝업도 방금 기록한 복용의 슬롯/복용 식별자를 함께 전달.
                //   BodyStateScreen 이 triggerDoseSlotId / triggerMedLogId →
                //   pendingDoseSlotId / pendingMedLogId → on_off_logs.dose_slot_id / med_log_id 로 기록.
                //   (medication_meal_time 전달은 그대로 보존 = dual)
                const doseSlotIdForNav = lastDoseSlotId;
                const medLogIdForNav = lastMedLogId;
                setShowBodyStateSuggest(false);
                // AsyncStorage write 완료 보장 후 navigate — race condition 방지
                // (BodyStateScreen useFocusEffect가 read 시점에 값이 있어야 함)
                try {
                  await AsyncStorage.setItem('pendingBodyStateNotif', JSON.stringify({
                    triggerMinutes: 0,
                    triggerMealTime: mealTimeForNav,
                    triggerDoseSlotId: doseSlotIdForNav,
                    triggerMedLogId: medLogIdForNav,
                  }));
                } catch {}
                // 안전한 nested navigation: Main > BodyStateTab > BodyState
                // route.params에도 직접 전달 (AsyncStorage 콜드스타트 fallback과 이중화)
                navigateTo('Main', {
                  screen: 'BodyStateTab',
                  params: {
                    screen: 'BodyState',
                    params: {
                      triggerMinutes: 0,
                      triggerMealTime: mealTimeForNav,
                      triggerDoseSlotId: doseSlotIdForNav,
                      triggerMedLogId: medLogIdForNav,
                      triggerTs: Date.now(),
                    },
                  },
                });
              }}
              style={{
                backgroundColor: '#FF6B35',
                borderRadius: 12,
                paddingVertical: 15,
                width: '100%',
                alignItems: 'center',
                marginBottom: 10,
              }}
            >
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>{t('medication.bodyStateSuggestRecord')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              onPress={() => {
                setShowBodyStateSuggest(false);
                setSelectedMealTime(null);
                // 다음 알림 팝업 표시 — 표시 타이밍 분리: state 가 아직 null 이어도
                //   promise ref 를 await 해 보장된 값으로 표시(권유 팝업 빠르게 닫기 시 누락 방지).
                resolveAndShowNextNotif();
              }}
              style={{ paddingVertical: 10, width: '100%', alignItems: 'center' }}
            >
              <Text style={{ color: '#999', fontSize: 16 }}>{t('medication.later')}</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      <BodyStatePopupFlow
        visible={showBodyStatePopup}
        onClose={() => { setShowBodyStatePopup(false); setSelectedMealTime(null); }}
        onSave={handleBodyStateSave}
        // 오늘 몸상태 로그 최소 1회 로드 후에만 수면/변비 단계 스냅샷(콜드스타트 알림 진입 시 중복 수면 방지).
        gatingReady={bodyLogsLoadedOnce}
        showSleep={
          isDoseSlotPatient
            // dose_slot 환자: 그날 수면 미기록(!hasSleepToday) 상태에서, 이 복용직후 기록의 약효추적
            //   시점이 "그날 첫 약효추적 시점" 이상인 다음 기록에서 수면 노출.
            //   [변경 이유] 기존엔 firstTrackingMin 과 '정확히 일치'만 노출 → 아침 첫 약효추적 알림을
            //   껐거나 그 시점 진입을 놓치면 그날 수면 진입점이 사라졌다. 미기록이면 첫 시점 이후 첫
            //   진입에서 뜨도록 완화하고 hasSleepToday 로 하루 1회를 보장. BodyStateScreen 과 대칭.
            ? (!hasSleepToday &&
               currentTrackingMin !== null &&
               trackingDayBounds.firstTrackingMin !== null &&
               currentTrackingMin >= trackingDayBounds.firstTrackingMin)
            // legacy 환자: 그날 수면 미기록이면 노출(아침이 보통 첫 기록이라 자연히 아침 우선).
            //   미기록 조건이 곧 중복 방지 → 한 번 남기면 이후엔 안 뜬다.
            : !hasSleepToday
        }
        showConstipation={
          isDoseSlotPatient
            // dose_slot 환자: 이 복용직후 기록의 약효추적 시점이 "그날 마지막 약효추적 시점"과 일치할 때만.
            ? (currentTrackingMin !== null &&
               trackingDayBounds.lastTrackingMin !== null &&
               currentTrackingMin === trackingDayBounds.lastTrackingMin)
            // legacy 환자: 기존 meal_time 게이팅 유지(회귀 방지)
            : (selectedMealTime === 'bedtime')
        }
      />
      <DatePickerModal
        visible={showDatePicker}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setShowDatePicker(false)}
      />
      <PreMedInfoModal
        visible={showPreMedInfo}
        message={preMedMessage}
        onClose={() => {
          setShowPreMedInfo(false);
          // 모달 중첩(iOS) 방지: 안내 팝업이 완전히 닫힌 뒤 몸상태 권유 표시
          // (단, "복용 직후"가 꺼진 슬롯이면 표시하지 않는다)
          if (immediateSuggestRef.current) {
            setTimeout(() => setShowBodyStateSuggest(true), 300);
          } else {
            // [버그수정 B] 권유 팝업을 안 띄우는 종료 상태 — 사전기록 안내만 닫고 끝나는 경우에도
            //   다음알림 정보가 있으면 다음알림 팝업 표시(저장 완료 = 더 입력할 것 없음).
            //   ⚠️ 표시 타이밍 분리: state 가 아직 null 이어도 promise ref 를 await 해 보장된 값으로 표시.
            //   iOS 모달 중첩 방지 위해 사전기록 안내가 완전히 닫힌 뒤(300ms) 띄운다.
            setTimeout(() => { resolveAndShowNextNotif(); }, 300);
          }
        }}
      />
      <NextNotifModal
        visible={showNextNotifModal}
        info={nextNotifInfo}
        onClose={() => setShowNextNotifModal(false)}
      />
      {/* 알림 진입 스피너 — 슬롯 조회(fetchPatientDoseSlots) 네트워크 대기 구간 무피드백 해소.
          저장 스피너와 동시에 뜨지 않도록 `!saving` 으로 한 번 더 가드(둘은 시간상 겹치지 않음).
          내려간 뒤(onHidden) pendingEnterRef 의 복용 확인 다이얼로그를 적층 없이 단독 present. */}
      <BrandProgressOverlay
        visible={entering && !saving}
        title={t('medication.spinnerLoading')}
        minVisibleMs={400}
        onHidden={handleEnteringHidden}
      />
      {/* 복용 저장 스피너 — 저장~다음 팝업 구간 무피드백 해소.
          내려간 뒤(onHidden) pendingNextRef 의 후속 팝업을 적층 없이 단독 present. */}
      <BrandProgressOverlay
        visible={saving}
        title={t('medication.spinnerSaving')}
        minVisibleMs={500}
        onHidden={handleSavingHidden}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  dateHeader: {
    height: DATE_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 16,
  },
  dateText: { fontSize: 26, fontWeight: '800', color: Colors.text },
  calBtn: { padding: 4, flexDirection: 'row', alignItems: 'center', gap: 4 },
  calBtnText: { fontSize: 16, color: Colors.textSub },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 32,
  },

  mainButton: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  mainButtonDisabled: { backgroundColor: '#BDBDBD' },
  mainButtonInner: { alignItems: 'center', gap: 12 },
  mainButtonText: { fontSize: 28, fontWeight: '800', color: Colors.white },

  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },

  records: { paddingHorizontal: 16, paddingBottom: 40 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },

  /* 그림자용 outer — overflow hidden 없음 */
  cardShadow: {
    borderRadius: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
    elevation: 3,
  },
  /* 내용 + 띠 담는 inner — overflow hidden으로 띠가 둥근 모서리 안에 잘림 */
  cardInner: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    minHeight: 96,
    overflow: 'hidden',
  },
  /* 완료: 테두리 없이 연녹색 톤 배경(Colors.light=#E8F5E9). 글자/아이콘은 기존 색 그대로 또렷하게(고대비, 60대 가독성) */
  cardInnerDone: { backgroundColor: Colors.light },
  cardInnerPending: { backgroundColor: Colors.white },
  /* 완료 항목 글자는 흐리게 하지 않음 — 연녹색 배경 위에서 또렷하게 읽혀야 함 */
  cardContentDone: {},
  cardContent: { flex: 1, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 20 },
  cardIcon: { marginRight: 14 },
  cardBody: { flex: 1 },
  cardLabel: { fontSize: 20, fontWeight: '600', color: Colors.text, marginBottom: 3 },
  cardLabelEmoji: { fontSize: 20 },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cardTime: { fontSize: 17, color: Colors.textSub },
  /* 복용 기록 취소 버튼 — 테두리 없이 차분하게(연한 회색). 기능은 유지, 시각적으로만 눈에 덜 띄게 */
  cardCancelBtn: {
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: 'transparent',
  },
  cardCancelText: { fontSize: 16, fontWeight: '600', color: Colors.textSub },
});

// ─── NextNotifInfo 타입 ───────────────────────────────────────────────────────

interface NextNotifInfo {
  label: string;      // 알림 종류 (예: "아침약 복용 30분 후 약효추적")
  timeStr: string;    // 구체적 시간 (예: "오전 9:30")
  minutesLeft: number; // 남은 분
  isTomorrow: boolean; // 다음 알림이 내일이면 true (시각 위계상 "내일" 명시용)
}

// fetch 실패(throw)·환자ID 미해석 등으로 다음 알림 정보를 못 구한 경우에도 팝업은 항상 띄운다
// (다음 알림은 최소한 내일 복용이라도 늘 존재). timeStr 가 비면 NextNotifModal 이 일반 문구로 렌더.
const FALLBACK_NEXT_NOTIF: NextNotifInfo = {
  label: isEnLocale() ? 'Next notification' : '다음 알림',
  timeStr: '',
  minutesLeft: 0,
  isTomorrow: false,
};

// ─── fetchNextNotifMessage ────────────────────────────────────────────────────
// 기록 완료 후 다음 예정 알림 정보를 반환합니다.
// effect_tracking_queue (약효추적), meal_schedules (식사 알림), exercise_notif_prefs (운동 알림) 중 가장 가까운 것 선택.

function formatTimeHHMM(date: Date): string {
  const h = date.getHours();
  const m = date.getMinutes();
  const hour = h % 12 === 0 ? 12 : h % 12;
  const mm = m.toString().padStart(2, '0');
  if (isEnLocale()) {
    return `${hour}:${mm} ${h < 12 ? 'AM' : 'PM'}`;
  }
  const ampm = h < 12 ? '오전' : '오후';
  return `${ampm} ${hour}:${mm}`;
}

// 'HH:MM[:SS]' → 오늘(now 기준) 해당 시각의 Date
function parseHHMM(hhmm: string, base: Date): Date {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date(base);
  d.setHours(h || 0, m || 0, 0, 0);
  return d;
}

// 인터벌(분) → "복용 N분 후" 스타일 라벨. ko는 기존과 100% 동일.
function mIntervalLabel(intervalMin: number): string {
  if (isEnLocale()) {
    if (intervalMin === 0) return 'right after taking';
    if (intervalMin < 60) return `${intervalMin} min after taking`;
    const h = Math.floor(intervalMin / 60);
    const rem = intervalMin % 60;
    return rem === 0 ? `${h} hr after taking` : `${h} hr ${rem} min after taking`;
  }
  if (intervalMin === 0) return '복용 직후';
  if (intervalMin < 60) return `복용 ${intervalMin}분 후`;
  const h = Math.floor(intervalMin / 60);
  const rem = intervalMin % 60;
  return rem === 0 ? `복용 ${h}시간 후` : `복용 ${h}시간 ${rem}분 후`;
}

// 슬롯명에 "약" 단위 붙이기(아침→아침약). 영어는 그대로(단위 불필요).
// ⚠️ mealKo는 dose_slots.label 등 raw DB 값(항상 한글)일 수 있어, 먼저 translateRawSlotLabel로
//   표시용 변환을 거친다(해외 로케일에서 "아침"이 그대로 노출되던 버그 수정).
function mMealMedLabel(mealKo: string | null): string | null {
  if (!mealKo) return null;
  const display = translateRawSlotLabel(mealKo) ?? mealKo;
  if (isEnLocale()) return display;
  return display.endsWith('약') ? display : `${display}약`;
}

// "{시간대} {interval} 약효추적" 라벨. ko는 기존과 100% 동일.
function mEffectTrackingLabel(mealKoMed: string | null, intervalLabel: string): string {
  if (isEnLocale()) {
    return mealKoMed ? `${mealKoMed} effect tracking, ${intervalLabel}` : `Effect tracking, ${intervalLabel}`;
  }
  return mealKoMed ? `${mealKoMed} ${intervalLabel} 약효추적` : `${intervalLabel} 약효추적`;
}

// "다음 {슬롯}약 복용" / "다음 {시각} 복용" 라벨. ko는 기존과 100% 동일.
// ⚠️ slotLabel은 dose_slots.label(raw DB, 항상 한글)일 수 있어 translateRawSlotLabel로 먼저 변환.
function mNextDoseLabel(slotLabel: string | null, hhmm: string, now: Date): string {
  const display = translateRawSlotLabel(slotLabel);
  if (isEnLocale()) {
    return display ? `Next: ${display} dose` : `Next dose (${formatTimeHHMM(parseHHMM(hhmm, now))})`;
  }
  return display ? `다음 ${display}약 복용` : `다음 ${formatTimeHHMM(parseHHMM(hhmm, now))} 복용`;
}


async function fetchNextNotifMessage(
  patientId: string,
  // 방금 기록한 복용의 약효추적 시점을 결정적으로 후보에 넣기 위한 정보.
  //  - 큐(effect_tracking_queue) insert 는 takeMedication 의 백그라운드 invoke 라,
  //    복용 직후 이 함수가 도는 시점엔 아직 큐에 안 들어가 있을 수 있다(경합).
  //    그 결과 가장 가까운 약효추적(예: 복용 30분 후)이 후보에서 누락되어
  //    더 먼 "다음 복용"이 최근접으로 잘못 선택된다.
  //  - 따라서 큐 도착을 기다리지 않고 takenAt + 각 track_interval(분) 시각을 직접 계산해 후보에 추가한다.
  justTaken?: { takenAt: Date; trackIntervals: number[] | null; slotLabel: string | null } | null,
): Promise<NextNotifInfo | null> {
  try {
    const now = new Date();
    let candidates: Array<{ minutesLeft: number; label: string; sendAt: Date }> = [];

    // 0) 방금 기록한 복용의 약효추적 후보(결정적). 큐 적재 여부와 무관하게 항상 포함.
    //    0(복용 직후)은 이미 지난 시점이라 제외하고, 미래 시점(예: 30분 후)만 후보로.
    if (justTaken && justTaken.trackIntervals && justTaken.trackIntervals.length > 0) {
      const mealKoMed = mMealMedLabel(justTaken.slotLabel);
      for (const intervalMin of justTaken.trackIntervals) {
        if (!intervalMin || intervalMin <= 0) continue; // 0=복용직후(과거) 제외
        const sendAt = new Date(justTaken.takenAt.getTime() + intervalMin * 60000);
        if (sendAt <= now) continue; // 미래만
        const minutesLeft = Math.round((sendAt.getTime() - now.getTime()) / 60000);
        const intervalLabel = mIntervalLabel(intervalMin);
        const label = mEffectTrackingLabel(mealKoMed, intervalLabel);
        candidates.push({ minutesLeft, label, sendAt });
      }
    }

    // 1) 약효추적 큐에서 미발송 + 미래 항목 중 가장 가까운 것
    //    dose_slot_id 있으면 슬롯 label 로, 없으면 legacy meal_time 으로 라벨 해석.
    const { data: queueRows } = await supabase
      .from('effect_tracking_queue')
      .select('send_at, interval_minutes, meal_time, dose_slot_id')
      .eq('patient_id', patientId)
      .is('sent_at', null)
      .gt('send_at', now.toISOString())
      .order('send_at', { ascending: true })
      .limit(1);

    if (queueRows && queueRows.length > 0) {
      const row = queueRows[0];
      const sendAt = new Date(row.send_at);
      const minutesLeft = Math.round((sendAt.getTime() - now.getTime()) / 60000);
      const intervalMin: number = row.interval_minutes ?? 0;
      // 라벨 해석: dose_slot_id 있으면 슬롯 label, 없으면 legacy meal_time.
      let mealKo: string | null = null;
      if (row.dose_slot_id) {
        const qSlots = await fetchPatientDoseSlots(patientId);
        const qSlot = qSlots.find((s) => s.id === row.dose_slot_id);
        mealKo = qSlot?.label ?? mealTimeToKorean(row.meal_time);
      } else {
        mealKo = mealTimeToKorean(row.meal_time);
      }

      const intervalLabel = mIntervalLabel(intervalMin);
      // 슬롯명에 "약"을 붙여 용어 통일 (아침→아침약). 이미 "약"으로 끝나면 그대로.
      const mealKoMed = mMealMedLabel(mealKo);
      const label = mEffectTrackingLabel(mealKoMed, intervalLabel);
      candidates.push({ minutesLeft, label, sendAt });
    }

    // 2) meal_schedules에서 현재 시각 이후 다음 식사 알림 + exercise_notif_prefs 운동 알림
    //    users 조회와 dose_slots 조회는 서로 독립이라 병렬로(로딩 워터폴 제거).
    const [userResult, slotResult] = await Promise.all([
      supabase
        .from('users')
        .select('meal_schedules, exercise_notif_prefs')
        .eq('id', patientId)
        .single(),
      // dose_slots 조회 → 있으면 슬롯 시각/라벨로, 없으면 legacy meal_schedules 폴백.
      // 공용 상수(LEGACY_SLOT_META/ORDER) 사용으로 화면 내 하드코딩 제거.
      supabase
        .from('dose_slots')
        .select('time, label, remind_enabled, sort_order')
        .eq('patient_id', patientId)
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .order('time', { ascending: true }),
    ]);

    const { data: userData, error: userError } = userResult;
    if (userError) console.error('[fetchNextNotifMessage] userData error:', userError);

    const { data: slotRows } = slotResult;

    // 다음 복용 후보: { time'HH:MM', label } 리스트 (시각 오름차순)
    type MealCandidate = { time: string; label: string };
    let mealCandidates: MealCandidate[] = [];

    if (slotRows && slotRows.length > 0) {
      // dose_slots 환자: 알림 켜진 슬롯만, 시각순. 라벨은 슬롯 label 우선.
      mealCandidates = slotRows
        .filter((r: any) => r.remind_enabled !== false && r.time)
        .map((r: any) => {
          const hhmm = String(r.time).slice(0, 5);
          const labelText = mNextDoseLabel(r.label ?? null, hhmm, now);
          return { time: hhmm, label: labelText };
        });
    } else {
      // 미이관(legacy) 환자: meal_schedules + 공용 LEGACY_SLOT_META
      const mealSchedules: Record<string, string> =
        (userData?.meal_schedules as Record<string, string>) ?? {};
      mealCandidates = LEGACY_SLOT_ORDER.map((key) => {
        const meta = LEGACY_SLOT_META[key];
        const time = mealSchedules[key] ?? meta.defaultTime;
        return { time, label: `${isEnLocale() ? 'Next: ' : '다음 '}${mealTimeToKorean(key)}${isEnLocale() ? '' : ' 복용'}` };
      });
    }

    let foundMeal = false;
    for (const mc of mealCandidates) {
      const scheduled = parseHHMM(mc.time, now);
      if (scheduled > now) {
        const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
        candidates.push({ minutesLeft, label: mc.label, sendAt: scheduled });
        foundMeal = true;
        break; // 가장 가까운 한 개만
      }
    }

    // 오늘 복용 시간이 모두 지난 경우 → 내일 첫 복용 폴백
    if (!foundMeal && mealCandidates.length > 0) {
      const first = mealCandidates[0];
      const tomorrowFirst = parseHHMM(first.time, now);
      tomorrowFirst.setDate(tomorrowFirst.getDate() + 1);
      const minutesLeft = Math.round((tomorrowFirst.getTime() - now.getTime()) / 60000);
      // "내일"은 시각(timeStr)에서 명시하므로 라벨엔 붙이지 않음(중복 방지). 라벨은 오늘과 동일한 "다음 ○○약 복용".
      candidates.push({ minutesLeft, label: first.label, sendAt: tomorrowFirst });
    }

    // 3) 운동 알림 (exercise_notif_prefs) — 오늘 이후 가장 가까운 운동 알림 시간
    const exercisePrefs = userData?.exercise_notif_prefs as Array<{
      id: string; ampm: '오전' | '오후'; hour: number; minute: number; enabled: boolean;
    }> | null;
    if (exercisePrefs && exercisePrefs.length > 0) {
      for (const ep of exercisePrefs) {
        if (!ep.enabled) continue;
        let hour = ep.hour;
        if (ep.ampm === '오후' && hour !== 12) hour += 12;
        if (ep.ampm === '오전' && hour === 12) hour = 0;
        const scheduled = new Date(now);
        scheduled.setHours(hour, ep.minute, 0, 0);
        if (scheduled > now) {
          const minutesLeft = Math.round((scheduled.getTime() - now.getTime()) / 60000);
          candidates.push({ minutesLeft, label: isEnLocale() ? 'Exercise time' : '운동 시간', sendAt: scheduled });
        }
      }
    }

    // 최후 폴백: candidates가 비어있으면 내일 아침 08:00
    if (candidates.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return {
        // "내일"은 timeStr 에서 명시 → 라벨은 오늘과 동일한 형태로.
        label: isEnLocale() ? 'Next: morning dose' : '다음 아침약 복용',
        timeStr: formatTimeHHMM(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
        isTomorrow: true,
      };
    }

    // dedup: 같은 분(minute)에 발송되는 중복 후보 제거.
    //   결정적 약효추적 후보(0번 섹션)와 큐 후보(1번 섹션)가 같은 시각(예: 복용 30분 후)을
    //   가리킬 수 있다. 결정적 후보가 배열 앞에 있으므로 그쪽을 유지한다(라벨 동일).
    {
      const seen = new Set<number>();
      candidates = candidates.filter((c) => {
        const key = Math.floor(c.sendAt.getTime() / 60000);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    // 더 가까운 것 선택 — 1분 미만(이미 임박/경과)은 제외하고 다음으로 미룬다.
    //   (예전엔 best.minutesLeft<1 이면 null 반환 → 팝업 누락. 대신 내일 첫 복용으로 폴백.)
    const futureCandidates = candidates.filter((c) => c.minutesLeft >= 1);
    if (futureCandidates.length === 0) {
      const tomorrow = new Date(now);
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(8, 0, 0, 0);
      return {
        label: isEnLocale() ? 'Next: morning dose' : '다음 아침약 복용',
        timeStr: formatTimeHHMM(tomorrow),
        minutesLeft: Math.round((tomorrow.getTime() - now.getTime()) / 60000),
        isTomorrow: true,
      };
    }
    futureCandidates.sort((a, b) => a.minutesLeft - b.minutesLeft);
    const best = futureCandidates[0];

    // 다음 알림이 오늘이 아닌 날짜면 "내일"로 간주(시각만으론 오늘/내일 구분 불가).
    const isTomorrow =
      best.sendAt.getFullYear() !== now.getFullYear() ||
      best.sendAt.getMonth() !== now.getMonth() ||
      best.sendAt.getDate() !== now.getDate();

    return {
      label: best.label,
      timeStr: formatTimeHHMM(best.sendAt),
      minutesLeft: best.minutesLeft,
      isTomorrow,
    };
  } catch (e) {
    console.error('[fetchNextNotifMessage] error:', e);
    return null;
  }
}

// ─── NextNotifModal ───────────────────────────────────────────────────────────

function NextNotifModal({ visible, info, onClose }: { visible: boolean; info: NextNotifInfo | null; onClose: () => void }) {
  const { t } = useTranslation();
  // ⚠️ visible 로는 언마운트하지 않는다(info 만 가드) — 닫힐 때 Modal 애니 도중 언마운트 시 iOS 에서
  //    모달 뷰가 남아 다음 팝업/버튼 터치를 막는다. Modal 은 항상 마운트, visible 로만 토글.
  if (!info) return null;

  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={nnStyles.overlay}>
        <View style={nnStyles.card}>
          <Text style={nnStyles.icon}>🔔</Text>
          <Text style={nnStyles.title}>{t('medication.nextNotifTitle')}</Text>

          {/* 알림 종류 — 오렌지 배경 pill (보조 정보) */}
          <View style={nnStyles.labelPill}>
            <Text style={nnStyles.labelPillText}>{info.label}</Text>
          </View>

          {/* 시각 — 화면에서 가장 도드라지는 메인 정보.
              시각 미상(폴백)일 땐 빈 큰 글자 대신 일반 안내 문구로 대체. */}
          {info.timeStr ? (
            <>
              {info.isTomorrow && <Text style={nnStyles.tomorrowText}>{t('medication.nextNotifTomorrow')}</Text>}
              <Text style={nnStyles.timeText}>{info.timeStr}</Text>
              {/* 서브텍스트 — 시각이 메인이므로 보조 한 줄 */}
              <Text style={nnStyles.subText}>{t('medication.nextNotifSub')}</Text>
            </>
          ) : (
            <Text style={nnStyles.subText}>{t('medication.nextNotifSubGeneric')}</Text>
          )}

          <TouchableOpacity style={nnStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={nnStyles.closeBtnText}>{t('common.confirm')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const nnStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 20 },
  /* 라벨 pill — 보조 정보. 시각보다 약하게(연한 오렌지 배경 + 진한 글자) */
  labelPill: {
    backgroundColor: '#FFF0E6',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 8,
    marginBottom: 14,
  },
  labelPillText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#E25A00',
    textAlign: 'center',
  },
  /* "내일" — 시각 바로 위, 오렌지 강조 */
  tomorrowText: {
    fontSize: 20,
    fontWeight: '800',
    color: '#FF6B00',
    marginBottom: 2,
  },
  /* 시각 — 모달에서 가장 크고 도드라지는 메인 정보 */
  timeText: {
    fontSize: 40,
    fontWeight: '900',
    color: '#FF6B00',
    letterSpacing: 0.5,
    textAlign: 'center',
    marginBottom: 14,
  },
  subText: {
    fontSize: 17,
    color: Colors.textSub,
    lineHeight: 26,
    textAlign: 'center',
    marginBottom: 28,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── PreMedInfoModal ──────────────────────────────────────────────────────────

function PreMedInfoModal({ visible, message, onClose }: { visible: boolean; message: string; onClose: () => void }) {
  const { t } = useTranslation();
  if (!visible) return null;
  return (
    <Modal visible={visible} transparent animationType="fade" statusBarTranslucent onRequestClose={onClose}>
      <View style={pmStyles.overlay}>
        <View style={pmStyles.card}>
          <Text style={pmStyles.icon}>🔕</Text>
          <Text style={pmStyles.title}>{t('medication.preMedTitle')}</Text>
          <Text style={pmStyles.message}>{message}</Text>
          <TouchableOpacity style={pmStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
            <Text style={pmStyles.closeBtnText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const pmStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 32,
    width: '100%',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.2,
    shadowRadius: 16,
    elevation: 10,
  },
  icon: { fontSize: 40, marginBottom: 12 },
  title: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 16 },
  message: {
    fontSize: 18,
    color: Colors.text,
    lineHeight: 28,
    textAlign: 'center',
    marginBottom: 28,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 48,
  },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
