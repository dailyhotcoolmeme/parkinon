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

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

export const NOTIF_ONBOARDING_SHOWN_KEY = 'notif_onboarding_shown';

// ─── 환자 알림 항목 ────────────────────────────────────────────────────────────
interface PatientItem {
  id: string;
  label: string;
  desc: string;
}

const PATIENT_ITEMS: PatientItem[] = [
  { id: 'immediate', label: '복용 직후', desc: '약을 드신 직후 몸 상태를 확인해요' },
  { id: 'after2h',   label: '복용 2시간 후', desc: '약효가 나타나는 시간에 확인해요' },
  { id: 'exercise',  label: '운동 알림', desc: '매일 운동을 권장해드려요' },
];

// ─── 보호자 알림 항목 ──────────────────────────────────────────────────────────
interface CaregiverItem {
  id: string;
  label: string;
  desc: string;
}

const CAREGIVER_ITEMS: CaregiverItem[] = [
  { id: 'med_taken',  label: '약 복용 기록 시',        desc: '환자분이 약을 드셨을 때 알려드려요' },
  { id: 'med_missed', label: '약 미복용 알림 (20분 후)',  desc: '약을 드시지 않으셨을 때 알려드려요' },
  { id: 'body_state', label: '몸상태 기록 시',          desc: '환자분의 몸 상태가 기록되면 알려드려요' },
  { id: 'exercise',   label: '운동 기록 시',            desc: '환자분이 운동을 완료하면 알려드려요' },
];

// ─── Props ────────────────────────────────────────────────────────────────────
interface Props {
  isCaregiver: boolean;
  userId: string;
  visible: boolean;
  onClose: () => void;
}

// ─── Inner Content (SafeAreaProvider 내부에서만 useSafeAreaInsets 사용) ───────
function NotificationOnboardingModalContent({ isCaregiver, userId, visible, onClose }: Props) {
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
            console.warn('[NotificationOnboardingModal] push_token 저장 오류:', e)
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
                  body: JSON.stringify({ caregiver_notif_prefs: Object.fromEntries(CAREGIVER_ITEMS.map(i => [i.id, true])) }),
                });
              }
            } catch (e) {
              console.warn('[NotificationOnboardingModal] caregiver_notif_prefs 저장 오류:', e);
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

  const items = isCaregiver ? CAREGIVER_ITEMS : PATIENT_ITEMS;

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
            <Text style={styles.title}>알림을 허용해야 해요</Text>
            <Text style={styles.subtitle}>
              {isCaregiver
                ? '환자분의 기록을 놓치지 않으려면\n아래 알림을 허용해주세요.'
                : '약 복용 시간과 몸 상태 알림을\n허용해야 파킨온을 제대로 쓸 수 있어요.'}
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

          {/* 사전 안내 박스 */}
          <View style={styles.noticeBox}>
            <Text style={styles.noticeText}>
              {'잠시 후 스마트폰이 알림 허용 여부를\n물어봐요. '}
              <Text style={styles.noticeStrong}>"허용"</Text>
              {' 버튼을 눌러주세요.'}
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
            <Text style={styles.confirmBtnText}>알림 허용하기</Text>
          </TouchableOpacity>
          <TouchableOpacity activeOpacity={0.7} style={styles.laterBtn} onPress={handleLater}>
            <Text style={styles.laterBtnText}>나중에 설정할게요</Text>
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
    height: 60,
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
    height: 56,
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
