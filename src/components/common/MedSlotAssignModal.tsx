/**
 * MedSlotAssignModal — 온보딩 마무리: 등록한 약을 "복용 시간대(dose_slot)"에 배정
 *
 * 오너 결정(2026-07-16): 약효추적 안내 팝업 다음 단계.
 *   등록한 약을 하나씩 보여주고, 각 약을 어느 시간대에 드시는지 다중 선택하게 한다.
 *   - 기본값은 모든 시간대가 선택된 상태(대부분 매 끼니마다 드시므로) → 안 드시는 시간만 해제.
 *   - "다음" 누르면 그 약의 medication_dose_slots 를 재작성하고 다음 약으로.
 *   - 마지막 약까지 끝내면 onDone() → 모든 세팅 마무리.
 */
import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { supabase } from '../../lib/supabase';
import { autoSlotLabel } from '../../constants/doseSlots';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';

type Med = { id: string; name: string };
type Slot = { id: string; time: string; label: string | null };

export function MedSlotAssignModal({
  visible,
  patientId,
  onDone,
}: {
  visible: boolean;
  patientId: string | null;
  onDone: () => void;
}) {
  const { t } = useTranslation();
  const bottomPad = useBottomSheetPadding(24);

  const [loading, setLoading] = useState(true);
  const [meds, setMeds] = useState<Med[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [idx, setIdx] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  // 열릴 때 1회 로드 — 등록 약 + 활성 슬롯. 기본은 모든 슬롯 선택.
  useEffect(() => {
    if (!visible || !patientId) return;
    let alive = true;
    (async () => {
      setLoading(true);
      const [medRes, slotRes] = await Promise.all([
        supabase
          .from('medications')
          .select('id, name')
          .eq('patient_id', patientId)
          .eq('is_active', true)
          .order('created_at', { ascending: true }),
        supabase
          .from('dose_slots')
          .select('id, time, label')
          .eq('patient_id', patientId)
          .eq('is_active', true)
          .order('time', { ascending: true }),
      ]);
      if (!alive) return;
      const m = ((medRes.data as any[]) ?? []).map((x) => ({ id: x.id, name: x.name })) as Med[];
      const s = ((slotRes.data as any[]) ?? []).map((x) => ({ id: x.id, time: x.time, label: x.label })) as Slot[];
      setMeds(m);
      setSlots(s);
      setIdx(0);
      setSelected(new Set(s.map((x) => x.id))); // 기본 전체 선택
      setLoading(false);
      // 배정할 약이나 시간대가 없으면 바로 종료.
      if (m.length === 0 || s.length === 0) onDone();
    })();
    return () => {
      alive = false;
    };
  }, [visible, patientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (slotId: string) => {
    setSelected((prev) => {
      const n = new Set(prev);
      if (n.has(slotId)) n.delete(slotId);
      else n.add(slotId);
      return n;
    });
  };

  // 현재 약의 배정 저장 → 다음 약으로(마지막이면 완료).
  const handleNext = useCallback(async () => {
    if (saving || !patientId) return;
    const med = meds[idx];
    if (!med) {
      onDone();
      return;
    }
    setSaving(true);
    try {
      // 이 약의 기존 배정을 비우고 선택된 시간대로 재작성.
      await supabase.from('medication_dose_slots').delete().eq('medication_id', med.id);
      const rows = Array.from(selected).map((sid) => ({ medication_id: med.id, dose_slot_id: sid }));
      if (rows.length > 0) await supabase.from('medication_dose_slots').insert(rows);
    } catch {
      // 실패해도 진행 — 복용시간 설정 화면에서 직접 조정 가능.
    } finally {
      setSaving(false);
    }
    if (idx + 1 >= meds.length) {
      onDone();
    } else {
      setIdx(idx + 1);
      setSelected(new Set(slots.map((x) => x.id))); // 다음 약도 기본 전체 선택
    }
  }, [saving, patientId, meds, idx, selected, slots, onDone]);

  if (!visible) return null;
  const med = meds[idx];
  const isLast = idx + 1 >= meds.length;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={[styles.sheet, { paddingBottom: bottomPad }]}>
          {loading || !med ? (
            <ActivityIndicator color={Colors.primary} style={{ paddingVertical: 48 }} />
          ) : (
            <>
              <Text style={styles.progress}>
                {t('medSlotAssign.progress', { cur: idx + 1, total: meds.length })}
              </Text>
              <Text style={styles.title}>{t('medSlotAssign.title', { name: med.name })}</Text>
              <Text style={styles.hint}>{t('medSlotAssign.hint')}</Text>

              <ScrollView style={styles.list} contentContainerStyle={{ gap: 12 }}>
                {slots.map((s) => {
                  const on = selected.has(s.id);
                  return (
                    <TouchableOpacity
                      key={s.id}
                      style={[styles.row, on && styles.rowOn]}
                      onPress={() => toggle(s.id)}
                      activeOpacity={0.85}
                    >
                      <Text style={[styles.rowText, on && styles.rowTextOn]}>
                        {s.label || autoSlotLabel(s.time)}
                      </Text>
                      {on && <Ionicons name="checkmark-sharp" size={26} color={Colors.primary} />}
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>

              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={handleNext}
                disabled={saving}
                activeOpacity={0.85}
              >
                {saving ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={styles.primaryBtnText}>
                    {isLast ? t('medSlotAssign.finish') : t('medSlotAssign.next')}
                  </Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 24,
    paddingTop: 24,
    maxHeight: '85%',
  },
  progress: { fontSize: 15, fontWeight: '700', color: Colors.primary, marginBottom: 6 },
  title: { fontSize: 24, fontWeight: '800', color: Colors.text, marginBottom: 8, lineHeight: 32 },
  hint: { fontSize: 16, color: Colors.textSub, marginBottom: 20, lineHeight: 24 },
  list: { maxHeight: 360 },
  // 선택 표시는 테두리·배경으로만(체크 아이콘은 텍스트 위 겹침 없이 우측 배치).
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 64,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
  },
  rowOn: { borderColor: Colors.primary, backgroundColor: Colors.light },
  rowText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  rowTextOn: { color: Colors.dark },
  primaryBtn: {
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 20,
  },
  primaryBtnText: { fontSize: 20, fontWeight: '800', color: Colors.white },
});
