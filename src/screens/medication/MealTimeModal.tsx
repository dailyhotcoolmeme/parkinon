import React, { useRef, useEffect, useMemo } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';

/** 현재 시각 기준으로 기본 추천 시간대를 반환 */
function getDefaultMealTime(): MealTime {
  const h = new Date().getHours();
  if (h < 11) return 'morning';
  if (h < 15) return 'lunch';
  if (h < 20) return 'dinner';
  return 'bedtime';
}
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  visible: boolean;
  onSelect: (mealTime: MealTime) => void;
  onClose: () => void;
}

const MEAL_OPTIONS: { id: MealTime; label: string; icon: IoniconName; time: string; color: string }[] = [
  { id: 'morning',  label: '아침 약',  icon: 'sunny-outline',        time: '오전 8:00',  color: '#FF9800' },
  { id: 'lunch',    label: '점심 약',  icon: 'partly-sunny-outline', time: '오후 12:00', color: '#4CAF50' },
  { id: 'dinner',   label: '저녁 약',  icon: 'moon-outline',         time: '오후 6:00',  color: '#3F51B5' },
  { id: 'bedtime',  label: '취침 약',  icon: 'bed-outline',          time: '오후 10:00', color: '#9C27B0' },
];

export function MealTimeModal({ visible, onSelect, onClose }: Props) {
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;

  // 현재 시간 기준 추천 시간대 (모달 열릴 때마다 계산)
  const suggestedMealTime = useMemo(() => getDefaultMealTime(), [visible]);

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
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.handleWrap}>
            <View style={styles.handleBar} />
          </View>

          <Text style={styles.title}>어느 시간 약을 드셨나요?</Text>
          <Text style={styles.subtitle}>복용한 시간대를 선택해주세요</Text>

          <View style={styles.optionList}>
            {MEAL_OPTIONS.map((opt, i) => {
              const isSuggested = opt.id === suggestedMealTime;
              return (
                <TouchableOpacity
                  key={opt.id}
                  style={[
                    styles.optionRow,
                    i < MEAL_OPTIONS.length - 1 && styles.optionRowBorder,
                    isSuggested && styles.optionRowSuggested,
                  ]}
                  onPress={() => onSelect(opt.id)}
                  activeOpacity={0.75}
                >
                  <View style={[styles.iconCircle, { backgroundColor: opt.color + '22' }]}>
                    <Ionicons name={opt.icon} size={30} color={opt.color} />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={styles.optionLabel}>{opt.label}</Text>
                    <Text style={styles.optionTime}>{opt.time}</Text>
                  </View>
                  {isSuggested ? (
                    <View style={styles.suggestedBadge}>
                      <Text style={styles.suggestedBadgeText}>추천</Text>
                    </View>
                  ) : (
                    <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
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
    paddingHorizontal: 24,
    marginTop: 8,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 17,
    color: Colors.textSub,
    textAlign: 'center',
    paddingHorizontal: 24,
    marginBottom: 20,
    lineHeight: 24,
  },
  optionList: {
    marginHorizontal: 20,
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
    paddingHorizontal: 20,
    paddingVertical: 18,
    minHeight: 84,
    backgroundColor: Colors.white,
    gap: 16,
  },
  optionRowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  optionRowSuggested: { backgroundColor: Colors.primary + '0D' },
  suggestedBadge: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  suggestedBadgeText: { fontSize: 15, fontWeight: '700', color: Colors.white },
  iconCircle: {
    width: 58,
    height: 58,
    borderRadius: 29,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionText: { flex: 1 },
  optionLabel: { fontSize: 22, fontWeight: '700', color: Colors.text, marginBottom: 3 },
  optionTime: { fontSize: 17, color: Colors.textSub },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginHorizontal: 20,
    marginBottom: 4,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  closeText: { fontSize: 18, color: Colors.textSub, fontWeight: '700' },
});
