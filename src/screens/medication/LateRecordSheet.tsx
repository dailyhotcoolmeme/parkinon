/*
 * "늦게 기록" 시트 — 복용 예정 시각에서 ±30분을 벗어나 기록할 때 뜬다.
 *
 * ★왜 있나 (2026-08-15 오너 결정)
 *  원래는 ±30분 밖이면 **기록 자체를 막았다**(오너 결정 2026-07-24). 늦게 기록하면 그
 *  시각을 기준으로 잡히는 약효추적 알림이 통째로 어긋나기 때문이다. 그런데 실제로는
 *  "약은 드셨는데 기록을 깜빡"하는 경우가 흔하고, 그때 아예 못 남기는 편이 더 나쁘다.
 *
 *  그래서 막는 대신 **복용 시각을 직접 받는다**. 기본값은 그 슬롯의 예정 시각이다 —
 *  깜빡한 경우 대개 그 근처에 드셨으므로, 대부분은 [기록하기]만 누르면 끝난다.
 *  그리고 이렇게 남긴 기록에는 **약효추적을 걸지 않는다**(useMedication 의
 *  takenAtOverride 경로). 어긋난 시각으로 추적이 돌면 추적 자료 자체가 못 믿을 게 된다.
 *
 * UI 규칙(CLAUDE.md): 탭/선택 위주(휠·자유입력 금지) · 하단 여백은 useBottomSheetPadding.
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { OverlaySheet } from '../../components/common/OverlaySheet';
import {
  PickerCol,
  pickStyles,
  HOURS,
  MINUTES,
  fromHHMM,
  toHHMM,
  type AmPm,
} from '../../components/common/TimeColumns';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { Colors } from '../../constants/colors';
import { formatSlotTime } from '../../constants/doseSlots';

const SHEET_ENTER_OFFSET = 700;
const SHEET_ENTER_MS = 240;
const SHEET_CLOSE_OFFSET = 700;
const SHEET_CLOSE_MS = 220;

export interface LateRecordTarget {
  /** 화면에 보여줄 슬롯 이름 — slotTitle() 결과 */
  title: string;
  /** 그 슬롯의 예정 시각 'HH:MM' — 시각 기본값 */
  slotTime: string;
  /** 이 슬롯에 약효추적이 걸려 있는가 — 걸려 있으면 이번엔 추적이 안 간다고 미리 알린다 */
  trackEnabled: boolean;
}

export function LateRecordSheet({
  target,
  onCancel,
  onConfirm,
}: {
  target: LateRecordTarget | null;
  onCancel: () => void;
  /** 사용자가 고른 복용 시각 'HH:MM' 을 돌려준다 */
  onConfirm: (takenTime: string) => void;
}) {
  const { t } = useTranslation();
  const { translateY, panHandlers } = useSwipeDownDismiss(onCancel);
  const sheetPad = useBottomSheetPadding(32);
  const visible = !!target;

  const [editing, setEditing] = useState(false);
  const [ampm, setAmpm] = useState<AmPm>('am');
  const [hour, setHour] = useState(9);
  const [minute, setMinute] = useState(0);

  /* 열릴 때마다 그 슬롯의 예정 시각으로 초기화 — 앞서 다른 슬롯에서 고른 값이 남으면 안 된다. */
  useEffect(() => {
    if (!target) return;
    const v = fromHHMM(target.slotTime);
    setAmpm(v.ampm);
    setHour(v.hour);
    setMinute(v.minute);
    setEditing(false);
    translateY.setValue(SHEET_ENTER_OFFSET);
    Animated.timing(translateY, { toValue: 0, duration: SHEET_ENTER_MS, useNativeDriver: true }).start();
  }, [target?.slotTime, target?.title]);

  const runClose = React.useCallback(
    (after: () => void) => {
      Animated.timing(translateY, {
        toValue: SHEET_CLOSE_OFFSET,
        duration: SHEET_CLOSE_MS,
        useNativeDriver: true,
      }).start(() => after());
    },
    [translateY]
  );

  const picked = useMemo(() => toHHMM(ampm, hour, minute), [ampm, hour, minute]);

  if (!target) return null;

  return (
    <OverlaySheet visible={visible} onRequestClose={() => runClose(onCancel)} animationType="none">
      <View style={styles.backdrop}>
        <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={() => runClose(onCancel)} />
        <Animated.View style={[styles.sheet, { paddingBottom: sheetPad, transform: [{ translateY }] }]}>
          <View {...panHandlers}>
            <View style={styles.handle} />
            <Text style={styles.title}>{t('lateRecord.title', { title: target.title })}</Text>
          </View>

          {/* 복용 시각 — 기본값은 예정 시각. 그대로 두고 기록해도 되게. */}
          <View style={styles.timeRow}>
            <Text style={styles.timeLabel}>{t('lateRecord.takenAtLabel')}</Text>
            <View style={styles.timeRight}>
              <Text style={styles.timeValue}>{formatSlotTime(picked)}</Text>
              <TouchableOpacity
                style={styles.editBtn}
                activeOpacity={0.7}
                onPress={() => setEditing((v) => !v)}
                accessibilityLabel={t('lateRecord.editTime')}
              >
                <Ionicons
                  name={editing ? 'chevron-up' : 'create-outline'}
                  size={20}
                  color={Colors.primary}
                />
                <Text style={styles.editBtnText}>
                  {editing ? t('common.close') : t('lateRecord.editTime')}
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {editing && (
            <View style={pickStyles.colsRow}>
              <View style={pickStyles.col}>
                <Text style={pickStyles.colHeader}>{t('doseSlotSetList.ampmHeader')}</Text>
                <PickerCol
                  items={[
                    { value: 'am', label: t('common.am') },
                    { value: 'pm', label: t('common.pm') },
                  ]}
                  selected={ampm}
                  onSelect={(v) => setAmpm(v as AmPm)}
                />
              </View>
              <View style={pickStyles.colDivider} />
              <View style={pickStyles.col}>
                <Text style={pickStyles.colHeader}>{t('doseSlotSetList.hourHeader')}</Text>
                <PickerCol
                  items={HOURS.map((h) => ({ value: h, label: String(h) }))}
                  selected={hour}
                  onSelect={(v) => setHour(v as number)}
                />
              </View>
              <View style={pickStyles.colDivider} />
              <View style={pickStyles.col}>
                <Text style={pickStyles.colHeader}>{t('doseSlotSetList.minuteHeader')}</Text>
                <PickerCol
                  items={MINUTES.map((m) => ({ value: m, label: String(m).padStart(2, '0') }))}
                  selected={minute}
                  onSelect={(v) => setMinute(v as number)}
                />
              </View>
            </View>
          )}

          {/* 추적이 걸린 슬롯이면, 왜 추적 알림이 안 오는지 미리 알린다(안 알리면 고장으로 보인다). */}
          {target.trackEnabled && (
            <View style={styles.notice}>
              <Ionicons name="information-circle-outline" size={20} color={Colors.textSub} />
              <Text style={styles.noticeText}>{t('lateRecord.trackingSkipped')}</Text>
            </View>
          )}

          <View style={styles.btnRow}>
            <TouchableOpacity style={styles.cancelBtn} activeOpacity={0.7} onPress={() => runClose(onCancel)}>
              <Text style={styles.cancelBtnText}>{t('common.cancel')}</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.saveBtn}
              activeOpacity={0.85}
              onPress={() => runClose(() => onConfirm(picked))}
            >
              <Text style={styles.saveBtnText}>{t('lateRecord.confirm')}</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 10,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 14 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 18 },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderColor: Colors.border,
  },
  timeLabel: { fontSize: 18, color: Colors.textSub, flexShrink: 1 },
  timeRight: { flexDirection: 'row', alignItems: 'center', gap: 12, minWidth: 0 },
  timeValue: { fontSize: 22, fontWeight: '700', color: Colors.text },
  editBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 8 },
  editBtnText: { fontSize: 16, color: Colors.primary, fontWeight: '600' },
  notice: { flexDirection: 'row', gap: 8, alignItems: 'flex-start', marginTop: 14 },
  noticeText: { flex: 1, fontSize: 16, lineHeight: 24, color: Colors.textSub },
  btnRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  cancelBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  saveBtn: {
    flex: 2,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
