import React, { useRef, useEffect, useState } from 'react';
import { OverlaySheet } from '../../components/common/OverlaySheet';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SlotTimeIcon, slotIconMeta } from '../../components/common/SlotTimeIcon';
import { useTranslation } from 'react-i18next';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { useDoseSlots, resolveDisplaySlots, type DoseSlot } from '../../hooks/useDoseSlots';
import {
  LEGACY_SLOT_META,
  formatSlotTime,
  slotTitle,
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
  color: string;
  notifOn: boolean;
}

function buildOptions(slots: DoseSlot[]): MealOption[] {
  return slots.map((slot) => {
    const { color } = slotIconMeta(slot.time);
    // 라벨: 설정 화면(DoseSlotSetList)과 동일한 slotTitle(이름+시각) 사용 → 명칭 일치.
    //   표준 "아침 오전 6:00 약", 비표준 "밤 11:00 약". 시각이 이름에 포함되므로 별도 표시 안 함.
    const title = slotTitle(slot.label, slot.legacyKey, slot.time);
    return {
      key: (slot.id ?? slot.legacyKey ?? slot.time) as string,
      selectKey: slot.legacyKey,
      doseSlotId: slot.id,
      // 이름+시각(raw). " 약" 접미사는 렌더에서 i18n(medication.cardMedLabel)으로 붙인다.
      label: title,
      time: slot.time,
      labelHasTime: true,
      color,
      notifOn: slot.remindEnabled,
    };
  });
}

export function MealTimeModal({ visible, onSelect, onClose, mealSchedules, notifPrefs }: Props) {
  const { t } = useTranslation();
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
    <OverlaySheet visible={visible} onRequestClose={onClose} animationType="none">
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(36, insets.bottom + 20), transform: [{ translateY: slideAnim }] }]}>
          <View style={styles.handleWrap}>
            <View style={styles.handleBar} />
          </View>

          <Text style={styles.title}>{t('medication.mealTimeTitle')}</Text>
          <Text style={styles.subtitle}>{t('medication.mealTimeSubtitle')}</Text>

          <View style={styles.optionList}>
            {options.map((opt, i) => {
              const displayTime = formatSlotTime(opt.time);
              const isSelected = selected === opt.key;
              // 5단계: dose_slot_id 또는 legacy key 가 있으면 선택 가능(비표준 슬롯도 쓰기 가능).
              const selectable = !!(opt.doseSlotId || opt.selectKey);
              // 기록 시트에서는 알림 ON/OFF로 흐림/회색 처리하지 않는다(약 복용 없음처럼 보여 혼란).
              // 선택 가능한 슬롯은 알림 OFF여도 일반 슬롯과 동일하게, 선택 불가일 때만 회색.
              const iconColor = selectable ? opt.color : '#AAAAAA';

              return (
                <TouchableOpacity
                  key={opt.key}
                  style={[
                    styles.optionRow,
                    i < options.length - 1 && styles.optionRowBorder,
                    isSelected && styles.optionRowSelected,
                    !selectable && styles.optionRowDim,
                  ]}
                  onPress={() => { if (selectable) setSelected(opt.key); }}
                  activeOpacity={selectable ? 0.75 : 1}
                  disabled={!selectable}
                >
                  <View style={[styles.iconCircle, { backgroundColor: iconColor + '22' }]}>
                    <SlotTimeIcon time={opt.time} size={34} color={selectable ? undefined : '#AAAAAA'} />
                  </View>
                  <View style={styles.optionText}>
                    {/* 기록 시트에서는 알림 ON/OFF로 슬롯을 흐리게(dim) 하지 않는다.
                        알림 OFF 슬롯이 '약 복용 없음'처럼 보여 혼란을 주므로, 선택 불가일 때만 dim. */}
                    <Text style={[styles.optionLabel, !selectable && styles.dimText]}>{t('medication.cardMedLabel', { label: opt.label })}</Text>
                    {/* 비표준 슬롯은 라벨에 이미 시각이 있어 시각 줄 생략(중복 방지) */}
                    {!opt.labelHasTime && (
                      <Text style={[styles.optionTime, !selectable && styles.dimText]}>{displayTime}</Text>
                    )}
                  </View>
                  {isSelected ? (
                    <Ionicons name="checkmark-circle" size={28} color={Colors.primary} />
                  ) : !selectable ? null : (
                    // 알림 OFF여도 일반 선택 가능 슬롯과 동일하게 표시('알림 없음' 배지 제거)
                    <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={styles.actionRow}>
            <TouchableOpacity style={styles.closeBtn} onPress={onClose} activeOpacity={0.75}>
              <Ionicons name="close-outline" size={22} color={Colors.textSub} />
              <Text style={styles.closeText}>{t('common.close')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.submitBtn, !(selectedOption?.doseSlotId || selectedOption?.selectKey) && styles.submitBtnDisabled]}
              onPress={handleSubmit}
              activeOpacity={0.8}
              disabled={!(selectedOption?.doseSlotId || selectedOption?.selectKey)}
            >
              <Text style={styles.submitText}>{t('medication.mealTimeSubmit')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </Animated.View>
    </OverlaySheet>
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
