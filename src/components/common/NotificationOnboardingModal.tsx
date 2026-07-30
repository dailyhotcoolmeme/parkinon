/**
 * NotificationOnboardingModal
 *
 * 온보딩 완료 후 홈 최초 진입 시 1회만 표시되는 알림 설정 팝업.
 * - 역할(환자/보호자)에 따라 해당 역할의 알림 항목만 표시
 * - 하나라도 ON → Notifications.requestPermissionsAsync() 호출
 * - 전체 OFF → 권한 요청 없이 닫기
 * - AsyncStorage 'notif_onboarding_shown' 키로 1회만 표시
 *
 * [삼성 nav bar 가림 fix 재적용]
 * - SafeAreaProvider initialMetrics 재주입 (Modal 내부에서 insets 0 반환되는 이슈 대응)
 * - ScrollView로 콘텐츠 감싸 + 하단 버튼은 sticky
 * - statusBarTranslucent={true}
 * - SamsungOne 폰트 한글 ascender 클리핑 방지 (lineHeight + includeFontPadding + textAlignVertical)
 */
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  TouchableOpacity,
  Switch,
  ScrollView,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Notifications from 'expo-notifications';
import { Colors } from '../../constants/colors';
import { useSettings } from '../../context/SettingsContext';
import { supabase } from '../../lib/supabase';
import { requestPermissionsAndSaveToken } from '../../utils/notifications';
import { useTranslation } from 'react-i18next';
import i18n from '../../i18n';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const NOTIF_ONBOARDING_SHOWN_KEY = 'notif_onboarding_shown';

// ─── 환자 알림 항목 ────────────────────────────────────────────────────────────
interface PatientItem {
  id: string;
  label: string;
  desc: string;
}

function getPatientItems(): PatientItem[] {
  return [
    { id: 'med', label: i18n.t('notifOnboard.medLabel'), desc: i18n.t('notifOnboard.medDesc') },
    { id: 'effect_track', label: i18n.t('notifOnboard.effectTrackLabel'), desc: i18n.t('notifOnboard.effectTrackDesc') },
    { id: 'exercise', label: i18n.t('notifOnboard.exerciseLabel'), desc: i18n.t('notifOnboard.exerciseDesc') },
  ];
}

// ─── 보호자 알림 항목 ──────────────────────────────────────────────────────────
interface CaregiverItem {
  id: string;
  label: string;
  desc: string;
}

// ※ 아래는 안내용 표시 항목(3개)일 뿐, 실제 보호자 알림 저장은
//   DEFAULT_CAREGIVER_PREFS(전체 기본 키)로 한다. (handleConfirm 참조)
function getCaregiverItems(): CaregiverItem[] {
  return [
    { id: 'med_taken', label: i18n.t('notifOnboard.caregiverMedTakenLabel'), desc: i18n.t('notifOnboard.caregiverMedTakenDesc') },
    { id: 'effect_track', label: i18n.t('notifOnboard.caregiverEffectTrackLabel'), desc: i18n.t('notifOnboard.caregiverEffectTrackDesc') },
    { id: 'med_missed', label: i18n.t('notifOnboard.caregiverMedMissedLabel'), desc: i18n.t('notifOnboard.caregiverMedMissedDesc') },
  ];
}

// 실제 보호자 알림 설정 저장용 기본 키 전체.
// SettingsScreen.tsx의 DEFAULT_CAREGIVER_NOTIFS와 동일한 스키마를 유지해야
// confirm 시 caregiver_notif_prefs 전체가 망가지지 않는다.
// (sleep/constipation은 기본 OFF, 나머지는 ON)
// 기본 OFF (오너 결정 2026-07-15): 보호자 알림은 전부 꺼진 채로 시작한다.
//   온보딩 직후 강제 이동되는 보호자 알림 설정 화면에서 사용자가 직접 켠다.
//   (발송부가 참조하는 키 missed_first/missed_second/measurement_completed 도 명시 false 로 둬 확실히 차단)
const DEFAULT_CAREGIVER_PREFS: Record<string, boolean> = {
  med_taken: false,
  med_missed: false,
  missed_first: false,
  missed_second: false,
  body_state: false,
  mood: false,
  exercise: false,
  measurement_completed: false,
  sleep: false,
  constipation: false,
};

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  isCaregiver: boolean;
  userId: string;
  visible: boolean;
  onClose: () => void;
}

// ─── Inner Content (SafeAreaProvider 내부에서만 useSafeAreaInsets 사용) ───────
function NotificationOnboardingModalContent({ isCaregiver, userId, visible, onClose }: Props) {
  const { t } = useTranslation();
  const { setNotificationEnabled } = useSettings();
  const insets = useSafeAreaInsets();
  // 삼성 3버튼 nav bar(고정) 환경에서 insets.bottom이 0으로 잡히는 경우가 있어 fallback
  const bottomInset = insets.bottom > 0 ? insets.bottom : 24;

  // 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(400)).current;

  React.useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(400);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 5 }),
      ]).start();
    }
  }, [visible]);

  const closeWithAnim = (callback: () => void) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
    ]).start(() => callback());
  };

  // ─── 확인 버튼 ──────────────────────────────────────────────────────────────
  const handleConfirm = async () => {
    await AsyncStorage.setItem(NOTIF_ONBOARDING_SHOWN_KEY, 'done').catch(() => {});

    const anyEnabled = true; // 항상 ON

    closeWithAnim(async () => {
      onClose();
      if (anyEnabled) {
        await new Promise(resolve => setTimeout(resolve, 500));
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;

        if (existing !== 'granted') {
          const { status: requested } = await Notifications.requestPermissionsAsync();
          finalStatus = requested;
        }

        if (finalStatus === 'granted') {
          await setNotificationEnabled(true);
          await requestPermissionsAndSaveToken(userId).catch((e) =>
            console.warn('[NotificationOnboardingModal] push_token save error:', e)
          );

          if (isCaregiver) {
            try {
              const { data: { session } } = await supabase.auth.getSession();
              if (session?.user) {
                await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
                  method: 'PATCH',
                  headers: {
                    apikey: SUPABASE_ANON_KEY,
                    Authorization: `Bearer ${session.access_token}`,
                    'Content-Type': 'application/json',
                    Prefer: 'return=minimal',
                  },
                  body: JSON.stringify({ caregiver_notif_prefs: DEFAULT_CAREGIVER_PREFS }),
                });
              }
            } catch (e) {
              console.warn('[NotificationOnboardingModal] caregiver_notif_prefs save error:', e);
            }
          }
        }
      } else {
        await setNotificationEnabled(false);
      }
    });
  };

  // ─── 나중에 버튼 ─────────────────────────────────────────────────────────────
  const handleLater = async () => {
    await AsyncStorage.setItem(NOTIF_ONBOARDING_SHOWN_KEY, 'done').catch(() => {});
    closeWithAnim(onClose);
  };

  const items = isCaregiver ? getCaregiverItems() : getPatientItems();

  return (
    <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
      {/* 딤 탭으로 닫기 */}
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleLater} />

      <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
        {/* 핸들 */}
        <View style={styles.handle} />

        {/* 스크롤 가능한 콘텐츠 */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          {/* 헤더 */}
          <View style={styles.headerArea}>
            <View style={styles.iconCircle}>
              <Ionicons name="notifications" size={32} color={Colors.primary} />
            </View>
            <Text style={styles.title}>{t('notifOnboard.title')}</Text>
            <Text style={styles.subtitle}>
              {isCaregiver ? t('notifOnboard.subtitleCaregiver') : t('notifOnboard.subtitlePatient')}
            </Text>
          </View>

          {/* 알림 항목 목록 */}
          <View style={styles.listContent}>
            {items.map((item) => (
              <View key={item.id} style={[styles.itemRow, styles.itemRowEnabled]}>
                <View style={styles.itemText}>
                  <Text style={[styles.itemLabel, styles.itemLabelEnabled]}>
                    {item.label}
                  </Text>
                  <Text style={styles.itemDesc}>{item.desc}</Text>
                </View>
                <Switch
                  value={true}
                  onValueChange={() => {}}
                  trackColor={{ false: Colors.border, true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ))}
          </View>

          {/* 광고·홍보 알림 없음 강조 (환자·보호자 공통) */}
          <View style={styles.adFreeBox}>
            <Text style={styles.adFreeText}>
              <Text style={styles.adFreeStrong}>{t('notifOnboard.adFreeStrong')}</Text>
              {' ' + t('notifOnboard.adFreeRest')}
            </Text>
          </View>

          {/* 사전 안내 박스 */}
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              {t('notifOnboard.noticePre')}
              <Text style={styles.noticeStrong}>{t('notifOnboard.noticeAllowWord')}</Text>
              {' ' + t('notifOnboard.noticePost')}
            </Text>
          </View>
        </ScrollView>

        {/* 하단 sticky 버튼 영역 (ScrollView 밖) */}
        <View
          style={[
            styles.buttonArea,
            { paddingBottom: Math.max(16, bottomInset + 16) },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.confirmBtn}
            onPress={handleConfirm}
          >
            <Text style={styles.confirmBtnText}>{t('notifOnboard.confirmBtn')}</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.laterBtn} onPress={handleLater}>
            <Text style={styles.laterBtnText}>{t('notifOnboard.laterBtn')}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────
export function NotificationOnboardingModal(props: Props) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={() => {
        AsyncStorage.setItem(NOTIF_ONBOARDING_SHOWN_KEY, 'done').catch(() => {});
        props.onClose();
      }}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <NotificationOnboardingModalContent {...props} />
      </SafeAreaProvider>
    </Modal>
  );
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: '90%',
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
    alignSelf: 'center',
    marginTop: 14,
    marginBottom: 4,
  },

  // ── ScrollView ──
  scrollView: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },

  // ── 헤더 ──
  headerArea: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 16,
  },
  iconCircle: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 8,
    lineHeight: 32,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },

  // ── 항목 목록 ──
  listContent: {
    paddingHorizontal: 20,
    gap: 10,
    paddingBottom: 4,
  },
  itemRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.background,
    borderRadius: 14,
    paddingHorizontal: 18,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    minHeight: 80,
  },
  itemRowEnabled: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  itemText: {
    flex: 1,
    marginRight: 12,
  },
  itemLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 3,
    lineHeight: 28,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  itemLabelEnabled: {
    color: Colors.text,
  },
  itemDesc: {
    fontSize: 14,
    color: Colors.textSub,
    lineHeight: 22,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },

  // ── 안내 박스 ──
  noticeBox: {
    backgroundColor: '#FFF3E0',
    borderLeftWidth: 4,
    borderLeftColor: '#FF9800',
    borderRadius: 8,
    padding: 14,
    marginHorizontal: 20,
    marginTop: 12,
    marginBottom: 8,
  },
  noticeText: {
    fontSize: 16,
    color: '#111111',
    lineHeight: 26,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  noticeStrong: {
    fontWeight: '700',
    color: '#E65100',
  },

  // ── 광고 없음 안내 ──
  adFreeBox: {
    backgroundColor: Colors.light,
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginHorizontal: 20,
    marginTop: 12,
  },
  adFreeText: {
    fontSize: 15,
    color: Colors.textSub,
    lineHeight: 24,
    textAlign: 'center',
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  adFreeStrong: {
    fontWeight: '700',
    color: Colors.primary,
  },

  // ── 버튼 영역 ──
  buttonArea: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  confirmBtn: {
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnOutline: {
    backgroundColor: Colors.white,
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  confirmBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.white,
    lineHeight: 28,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  confirmBtnTextOutline: {
    color: Colors.primary,
  },
  laterBtn: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnText: {
    fontSize: 17,
    color: Colors.textSub,
    fontWeight: '600',
    lineHeight: 24,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
});
