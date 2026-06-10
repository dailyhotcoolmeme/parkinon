import React, { useRef, useEffect, useState } from 'react';
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
import { useDoseSlots, resolveDisplaySlots, type DoseSlot } from '../../hooks/useDoseSlots';
import {
  LEGACY_SLOT_META,
  formatSlotTime,
  slotDisplayName,
  labelContainsTime,
} from '../../constants/doseSlots';

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Props {
  visible: boolean;
  /** 5단계: {mealTime(legacy key, 없으면 null), doseSlotId(dose_slots.id, 없으면 null)} 전달. */
  onSelect: (sel: { mealTime: MealTime | null; doseSlotId: string | null }) => void;
  onClose: () => void;
  mealSchedules?: Record<string, string> | null;
  notifPrefs?: Record<string, boolean> | null;
}

// 표시용 옵션. selectKey = legacy meal key(있으면), doseSlotId = dose_slots.id(이관 환자).
// 5단계: dose_slot_id 가 있으면 비표준 라벨 슬롯도 선택 가능.
interface MealOption {
  key: string;                 // 렌더 key (slot id 또는 legacy key)
  selectKey: MealTime | null;  // onSelect 전달용 legacy key (비표준 슬롯이면 null)
  doseSlotId: string | null;   // onSelect 전달용 dose_slots.id (legacy 가상슬롯이면 null)
  label: string;
  time: string;                // 'HH:MM'
  /** 라벨이 이미 시각을 포함(비표준 추가 슬롯) → 아래 시각 줄을 따로 표시하지 않음(중복 방지). */
  labelHasTime: boolean;
  icon: IoniconName;
  color: string;
  notifOn: boolean;
}

// dose_slot.legacyKey → 아이콘/색. 비표준 슬롯은 시간대 기반 기본값.
function slotIcon(slot: DoseSlot): { icon: IoniconName; color: string } {
  if (slot.legacyKey) {
    const meta = LEGACY_SLOT_META[slot.legacyKey];
    return { icon: meta.icon as IoniconName, color: meta.color };
  }
  // 비표준 슬롯: 시각으로 대략 아이콘 추정
  const h = parseInt(slot.time.split(':')[0] ?? '0', 10);
  if (h < 11) return { icon: 'sunny-outline', color: '#FF9800' };
  if (h < 15) return { icon: 'partly-sunny-outline', color: '#4CAF50' };
  if (h < 21) return { icon: 'moon-outline', color: '#3F51B5' };
  return { icon: 'bed-outline', color: '#7C4DFF' };
}

function buildOptions(slots: DoseSlot[]): MealOption[] {
  return slots.map((slot) => {
    const { icon, color } = slotIcon(slot);
    // 라벨: 표준은 "아침 약", 비표준 추가 슬롯은 라벨이 곧 "오후 3:00 약".
    const baseLabel = slotDisplayName(slot.label, slot.legacyKey, slot.time);
    const labelHasTime = labelContainsTime(slot.label, slot.legacyKey);
    return {
      key: (slot.id ?? slot.legacyKey ?? slot.time) as string,
      selectKey: slot.legacyKey,
      doseSlotId: slot.id,
      label: `${baseLabel} 약`,
      time: slot.time,
      labelHasTime,
      icon,
      color,
      notifOn: slot.remindEnabled,
    };
  });
}

export function MealTimeModal({ visible, onSelect, onClose, mealSchedules, notifPrefs }: Props) {
  const insets = useSafeAreaInsets();
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;
  const [selected, setSelected] = useState<string | null>(null);

  // dose_slots(이관) 우선, 없으면 legacy meal_schedules/notifPrefs 폴백.
  const { slots: doseSlots } = useDoseSlots();
  const displaySlots = resolveDisplaySlots(doseSlots, mealSchedules, notifPrefs);
  const options = buildOptions(displaySlots);
  const selectedOption = options.find((o) => o.key === selected) ?? null;

  useEffect(() => {
    if (visible) {
      setSelected(null);
      slideAnim.setValue(80);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [visible]);

  const handleSubmit = () => {
    if (!selectedOption) return;
    // dose_slot_id 또는 legacy key 중 하나라도 있으면 선택 가능(비표준 슬롯 포함).
    if (!selectedOption.doseSlotId && !selectedOption.selectKey) return;
    onSelect({ mealTime: selectedOption.selectKey, doseSlotId: selectedOption.doseSlotId });
  };

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
            {options.map((opt, i) => {
              const notifOn = opt.notifOn;
              const displayTime = formatSlotTime(opt.time);
              const iconColor = notifOn ? opt.color : '#AAAAAA';
              const isSelected = selected === opt.key;
              // 5단계: dose_slot_id 또는 legacy key 가 있으면 선택 가능(비표준 슬롯도 쓰기 가능).
              const selectable = !!(opt.doseSlotId || opt.selectKey);

              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.optionRow,
                    i < options.length - 1 && styles.optionRowBorder,
                    !notifOn && styles.optionRowDim,
                    isSelected && styles.optionRowSelected,
                    !selectable && styles.optionRowDim,
                  ]}
                  onPress={() => { if (selectable) setSelected(opt.key); }}
                  activeOpacity={selectable ? 0.75 : 1}
                  disabled={!selectable}
                >
                  <View style={[styles.iconCircle, { backgroundColor: iconColor + '22' }]}>
                    <Ionicons name={opt.icon} size={30} color={iconColor} />
                  </View>
                  <View style={styles.optionText}>
                    <Text style={[styles.optionLabel, (!notifOn || !selectable) && styles.dimText]}>{opt.label}</Text>
                    {/* 비표준 슬롯은 라벨에 이미 시각이 있어 시각 줄 생략(중복 방지) */}
                    {!opt.labelHasTime && (
                      <Text style={[styles.optionTime, (!notifOn || !selectable) && styles.dimText]}>{displayTime}</Text>
                    )}
                  </View>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                  ) : !selectable ? null : notifOn ? (
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

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
              <Ionicons name="close-outline" size={22} color={Colors.textSub} />
              <Text style={styles.closeText}>닫기</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, !(selectedOption?.doseSlotId || selectedOption?.selectKey) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.8}
              disabled={!(selectedOption?.doseSlotId || selectedOption?.selectKey)}
            >
              <Text style={styles.submitText}>등록</Text>
            </TouchableOpacity>
          </View>
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
  optionRowSelected: { backgroundColor: Colors.light },
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
  actionRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 16,
    marginBottom: 4,
  },
  closeBtn: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: Colors.background,
    borderWidth: 1.5,
    borderColor: Colors.border,
  },
  closeText: { fontSize: 18, color: Colors.textSub, fontWeight: '700' },
  submitBtn: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    paddingVertical: 16,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  submitBtnDisabled: {
    backgroundColor: Colors.border,
  },
  submitText: { fontSize: 19, color: Colors.white, fontWeight: '800' },
});
