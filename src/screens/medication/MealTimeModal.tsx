import React, { useRef, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  visible: boolean;
  onSelect: (mealTime: MealTime) => void;
  onClose: () => void;
  mealSchedules?: Record<string, string> | null;
  notifPrefs?: Record<string, boolean> | null;
}

function formatMealTime(timeStr: string): string {
  const [h, m] = timeStr.split(':').map(Number);
  const ampm = h < 12 ? '오전' : '오후';
  const hour = h % 12 === 0 ? 12 : h % 12;
  return `${ampm} ${hour}:${m.toString().padStart(2, '0')}`;
}

const MEAL_DEFAULT_TIMES: Record<MealTime, string> = {
  morning: '08:00',
  lunch:   '12:00',
  dinner:  '18:00',
  bedtime: '22:00',
};

const MEAL_OPTIONS: { id: MealTime; label: string; icon: IoniconName; color: string }[] = [
  { id: 'morning', label: '아침 약', icon: 'sunny-outline',        color: '#FF9800' },
  { id: 'lunch',   label: '점심 약', icon: 'partly-sunny-outline', color: '#4CAF50' },
  { id: 'dinner',  label: '저녁 약', icon: 'moon-outline',         color: '#3F51B5' },
  { id: 'bedtime', label: '취침 약', icon: 'bed-outline',          color: '#7C4DFF' },
];

export function MealTimeModal({ visible, onSelect, onClose, mealSchedules, notifPrefs }: Props) {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;

  useEffect(() => {
    if (visible) {
      slideAnim.setValue(80);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={onClose}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(36, insets.bottom + 20), transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.handleWrap}>
            <View style={styles.handleBar} />
          </View>

          <Text style={styles.title}>어느 시간 약을 드셨나요?</Text>
          <Text style={styles.subtitle}>복용한 시간대를 선택해주세요</Text>

          <View style={styles.optionList}>
            {MEAL_OPTIONS.map((opt, i) => {
              const notifOn = !notifPrefs || notifPrefs[opt.id] !== false;
              const rawTime = mealSchedules?.[opt.id] ?? MEAL_DEFAULT_TIMES[opt.id];
              const displayTime = formatMealTime(rawTime);
              const iconColor = notifOn ? opt.color : '#AAAAAA';

              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.optionRow,
                    i < MEAL_OPTIONS.length - 1 && styles.optionRowBorder,
                    !notifOn && styles.optionRowDim,
                  ]}
                  onPress={() => onSelect(opt.id)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconCircle, { backgroundColor: iconColor + '22' }]}>
                    <Ionicons name={opt.icon} size={30} color={iconColor} />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, !notifOn && styles.dimText]}>{opt.label}</Text>
                    <Text style={[styles.optionTime, !notifOn && styles.dimText]}>{displayTime}</Text>
                  </View>
                  {notifOn ? (
                    <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
                  ) : (
                    <View style={styles.noNotifBadge}>
                      <Text style={styles.noNotifBadgeText}>알림 없음</Text>
                    </View>
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
            <Ionicons name="close-outline" size={22} color={Colors.textSub} />
            <Text style={styles.closeText}>닫기</Text>
          </TouchableOpacity>
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

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
    paddingBottom: 36,
  },
  handleWrap: { alignItems: 'center', paddingTop: 14, paddingBottom: 8 },
  handleBar: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border },

  title: {
    fontSize: 24,
    fontWeight: '800',
    color: Colors.text,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginTop: 8,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 17,
    color: Colors.textSub,
    textAlign: 'center',
    paddingHorizontal: 16,
    marginBottom: 20,
    lineHeight: 24,
  },
  optionList: {
    marginHorizontal: 16,
    backgroundColor: Colors.white,
    borderRadius: 18,
    overflow: 'hidden',
    borderWidth: 1.5,
    borderColor: Colors.border,
    marginBottom: 16,
  },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 18,
    minHeight: 84,
    backgroundColor: Colors.white,
    gap: 16,
  },
  optionRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  optionRowDim: { backgroundColor: '#F8F8F8' },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 3 },
  optionTime:  { fontSize: 17, color: Colors.textSub },
  dimText: { color: '#AAAAAA' },
  noNotifBadge: {
    backgroundColor: '#EEEEEE',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  noNotifBadgeText: { fontSize: 14, fontWeight: '600', color: '#888888' },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 16,
    marginBottom: 4,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  closeText: { fontSize: 18, color: Colors.textSub, fontWeight: '700' },
});
