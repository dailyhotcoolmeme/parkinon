/**
 * MedTimeOnboardingScreen — 환자 온보딩 복약 알림 설정(간단 순차 방식)
 *
 * 오너 결정(2026-07-16): 복약 횟수가 사람마다 달라 고정 4슬롯(아침/점심/저녁/취침) 대신,
 *   "첫 번째 약 몇 시? → 두 번째 약 몇 시? → …" 로 개수 제한 없이 등록.
 *   - 2번째부터 "다 등록했어요" 노출. 마지막에 요약·수정 후 완료.
 *   - 각 시간 = dose_slot 1개(라벨=autoSlotLabel 자동, 예 "아침 8:00"), 알림 자동 ON.
 *   - 약 이름은 안 물어봄(시간만). 보호자 연동 시 "보호자에게 맡기기" 가능.
 *
 * 온보딩 첫 진입 흐름: 개발자 편지 닫힘 → (환자면) 이 화면으로 강제 이동(MedicationScreen).
 */
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import { supabase } from '../../lib/supabase';
import { autoSlotLabel } from '../../constants/doseSlots';
import { navigateTo } from '../../navigation/navigationRef';

type Ampm = 'am' | 'pm';

// 12시간 표기(ampm/hour/minute) → 'HH:MM'(24시간).
function toHHMM(ampm: Ampm, hour: number, minute: number): string {
  let h = hour % 12; // 12 → 0
  if (ampm === 'pm') h += 12; // 오후 12 → 12, 오후 1 → 13 …
  return `${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export function MedTimeOnboardingScreen() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const dialog = useDialog();
  const bottomPad = useBottomSheetPadding(24);

  // 등록된 복약 시각(HH:MM) 목록. 시간순 정렬해 표시.
  const [times, setTimes] = useState<string[]>([]);
  const [view, setView] = useState<'pick' | 'summary'>('pick');
  const [saving, setSaving] = useState(false);

  // 현재 시간 선택 상태(기본 오전 8:00). 수정 시 해당 값으로 세팅.
  const [ampm, setAmpm] = useState<Ampm>('am');
  const [hour, setHour] = useState(8); // 1~12
  const [minute, setMinute] = useState(0); // 0~55(5분 단위)
  // 수정 중인 인덱스(null=신규 추가)
  const [editIndex, setEditIndex] = useState<number | null>(null);

  const hasCaregiver = !!user?.patient_group_id;
  const count = times.length;

  // 진입 시 1회 안내 팝업(온보딩 취지).
  const introShownRef = useRef(false);
  useEffect(() => {
    if (introShownRef.current) return;
    introShownRef.current = true;
    setTimeout(() => {
      dialog.alert({ title: t('medTimeOnboarding.introTitle'), message: t('medTimeOnboarding.introMsg') });
    }, 300);
  }, []);

  const resetPicker = (defaultHour = 8, defaultAmpm: Ampm = 'am') => {
    setAmpm(defaultAmpm);
    setHour(defaultHour);
    setMinute(0);
    setEditIndex(null);
  };

  const stepHour = (d: number) => setHour((h) => ((h - 1 + d + 12) % 12) + 1);
  const stepMinute = (d: number) => setMinute((m) => (m + d * 5 + 60) % 60);

  // 시각 저장. 신규 추가면 → 바로 "다음 약" 물어보기(pick 유지). 수정이면 → 요약으로.
  const confirmTime = useCallback(() => {
    const hhmm = toHHMM(ampm, hour, minute);
    const wasEdit = editIndex != null;
    setTimes((prev) => {
      const next = wasEdit ? prev.map((v, i) => (i === editIndex ? hhmm : v)) : [...prev, hhmm];
      return Array.from(new Set(next)).sort(); // 중복 제거 + 시간순
    });
    resetPicker();
    if (wasEdit) setView('summary'); // 수정은 요약에서 온 것 → 요약으로 복귀
    // 신규 추가는 view='pick' 유지 → 다음 약 시각을 이어서 묻는다("다 등록했어요"로 요약 이동)
  }, [ampm, hour, minute, editIndex]);

  // 요약에서 "약 더 추가" → 다음 시각 선택(신규)
  const addMore = () => {
    resetPicker();
    setView('pick');
  };

  // 요약에서 특정 항목 수정 → 그 값으로 picker 세팅
  const editItem = (index: number) => {
    const hhmm = times[index];
    const [hStr, mStr] = hhmm.split(':');
    const h24 = parseInt(hStr, 10);
    const m = parseInt(mStr, 10);
    setAmpm(h24 >= 12 ? 'pm' : 'am');
    setHour(((h24 % 12) === 0 ? 12 : h24 % 12));
    setMinute(m);
    setEditIndex(index);
    setView('pick');
  };

  const deleteItem = (index: number) => {
    setTimes((prev) => prev.filter((_, i) => i !== index));
  };

  // 완료 → dose_slots 로 저장 + 알림 ON. (온보딩 기본 슬롯 대체)
  const handleFinish = useCallback(async () => {
    if (!user?.id || saving) return;
    if (times.length === 0) {
      setView('pick');
      return;
    }
    setSaving(true);
    try {
      const pid = user.id;
      // 온보딩 시 자동 생성된 기본 슬롯(4개, 알림 off·기록 없음)을 지우고 사용자가 정한 시각으로 대체.
      await supabase.from('dose_slots' as any).delete().eq('patient_id', pid);
      const rows = times.map((time, idx) => ({
        patient_id: pid,
        time,
        label: autoSlotLabel(time),
        sort_order: idx,
        remind_enabled: true, // 사용자가 정한 알림 → 켜짐
        track_enabled: false, // 약효추적은 기본 off(원할 때 별도로)
        track_intervals: [0, 30, 120],
        is_active: true,
      }));
      const { error: insErr } = await supabase.from('dose_slots' as any).insert(rows);
      if (insErr) throw insErr;
      // 마스터 알림 게이트 ON (복약 알림 발송 조건).
      // ⚠️ supabase-js .update()는 RN 새 아키텍처에서 hang 위험 → raw fetch(PATCH)로 우회(앱 관례).
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.access_token) {
        await fetch(`${process.env.EXPO_PUBLIC_SUPABASE_URL}/rest/v1/users?id=eq.${pid}`, {
          method: 'PATCH',
          headers: {
            apikey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
            Authorization: `Bearer ${session.access_token}`,
            'Content-Type': 'application/json',
            Prefer: 'return=minimal',
          },
          body: JSON.stringify({ notification_enabled: true }),
        }).catch(() => {});
      }

      await dialog.alert({
        title: t('medTimeOnboarding.doneTitle'),
        message: t('medTimeOnboarding.doneMsg'),
      });
      navigateTo('Main', { screen: 'Medication' });
    } catch (e: any) {
      dialog.alert({ title: t('common.error'), message: t('medTimeOnboarding.saveFail') });
    } finally {
      setSaving(false);
    }
  }, [user?.id, saving, times, dialog, t]);

  // 보호자에게 맡기기 → 설정 건너뛰고 안내.
  const handoffToCaregiver = useCallback(async () => {
    await dialog.alert({
      title: t('medTimeOnboarding.handoffTitle'),
      message: t('medTimeOnboarding.handoffMsg'),
    });
    navigateTo('Main', { screen: 'Medication' });
  }, [dialog, t]);

  const ordinal = count + 1; // 지금 묻는 게 몇 번째 약인지

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title={t('medTimeOnboarding.headerTitle')} />

      {view === 'pick' ? (
        <View style={styles.body}>
          <Text style={styles.question}>
            {editIndex != null
              ? t('medTimeOnboarding.editQuestion')
              : t('medTimeOnboarding.askQuestion', { n: ordinal })}
          </Text>
          <Text style={styles.hint}>{t('medTimeOnboarding.askHint')}</Text>

          {/* 오전/오후 */}
          <View style={styles.ampmRow}>
            {(['am', 'pm'] as Ampm[]).map((v) => (
              <TouchableOpacity
                key={v}
                style={[styles.ampmBtn, ampm === v && styles.ampmBtnOn]}
                onPress={() => setAmpm(v)}
                activeOpacity={0.85}
              >
                <Text style={[styles.ampmText, ampm === v && styles.ampmTextOn]}>
                  {v === 'am' ? t('common.am') : t('common.pm')}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 시 · 분 스텝퍼 */}
          <View style={styles.stepperRow}>
            <View style={styles.stepperCol}>
              <Text style={styles.stepperLabel}>{t('medTimeOnboarding.hour')}</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => stepHour(-1)} activeOpacity={0.7}>
                  <Ionicons name="remove" size={30} color={Colors.primary} />
                </TouchableOpacity>
                <Text style={styles.stepValue}>{hour}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => stepHour(1)} activeOpacity={0.7}>
                  <Ionicons name="add" size={30} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
            <Text style={styles.colon}>:</Text>
            <View style={styles.stepperCol}>
              <Text style={styles.stepperLabel}>{t('medTimeOnboarding.minute')}</Text>
              <View style={styles.stepper}>
                <TouchableOpacity style={styles.stepBtn} onPress={() => stepMinute(-1)} activeOpacity={0.7}>
                  <Ionicons name="remove" size={30} color={Colors.primary} />
                </TouchableOpacity>
                <Text style={styles.stepValue}>{String(minute).padStart(2, '0')}</Text>
                <TouchableOpacity style={styles.stepBtn} onPress={() => stepMinute(1)} activeOpacity={0.7}>
                  <Ionicons name="add" size={30} color={Colors.primary} />
                </TouchableOpacity>
              </View>
            </View>
          </View>

          {/* 미리보기 라벨 */}
          <Text style={styles.preview}>{autoSlotLabel(toHHMM(ampm, hour, minute))}</Text>

          <View style={[styles.bottomArea, { paddingBottom: bottomPad }]}>
            <TouchableOpacity style={styles.primaryBtn} onPress={confirmTime} activeOpacity={0.85}>
              <Text style={styles.primaryBtnText}>{t('medTimeOnboarding.saveTime')}</Text>
            </TouchableOpacity>
            {/* 2번째 약부터 "다 등록했어요" */}
            {count >= 1 && editIndex == null && (
              <TouchableOpacity style={styles.ghostBtn} onPress={() => setView('summary')} activeOpacity={0.7}>
                <Text style={styles.ghostBtnText}>{t('medTimeOnboarding.doneAdding')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      ) : (
        // ── 요약/확인 ──
        <View style={styles.body}>
          <Text style={styles.question}>{t('medTimeOnboarding.summaryTitle')}</Text>
          <Text style={styles.hint}>{t('medTimeOnboarding.summaryHint')}</Text>

          <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingVertical: 8 }}>
            {times.map((time, i) => (
              <View key={time} style={styles.summaryRow}>
                <Text style={styles.summaryLabel}>{autoSlotLabel(time)}</Text>
                <View style={styles.summaryActions}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => editItem(i)} activeOpacity={0.7}>
                    <Text style={styles.editBtnText}>{t('common.edit')}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.delBtn} onPress={() => deleteItem(i)} activeOpacity={0.7}>
                    <Text style={styles.delBtnText}>{t('common.delete')}</Text>
                  </TouchableOpacity>
                </View>
              </View>
            ))}
            {times.length === 0 && <Text style={styles.emptyText}>{t('medTimeOnboarding.emptyTimes')}</Text>}

            <TouchableOpacity style={styles.addMoreBtn} onPress={addMore} activeOpacity={0.7}>
              <Ionicons name="add-circle-outline" size={22} color={Colors.primary} />
              <Text style={styles.addMoreText}>{t('medTimeOnboarding.addMore')}</Text>
            </TouchableOpacity>
          </ScrollView>

          <View style={[styles.bottomArea, { paddingBottom: bottomPad }]}>
            <TouchableOpacity
              style={[styles.primaryBtn, (saving || times.length === 0) && styles.btnDisabled]}
              onPress={handleFinish}
              disabled={saving || times.length === 0}
              activeOpacity={0.85}
            >
              {saving ? (
                <ActivityIndicator color={Colors.white} />
              ) : (
                <Text style={styles.primaryBtnText}>{t('medTimeOnboarding.finish')}</Text>
              )}
            </TouchableOpacity>
            {hasCaregiver && (
              <TouchableOpacity style={styles.ghostBtn} onPress={handoffToCaregiver} activeOpacity={0.7}>
                <Text style={styles.ghostBtnText}>{t('medTimeOnboarding.handoff')}</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  body: { flex: 1, paddingHorizontal: 24, paddingTop: 12 },
  question: { fontSize: 24, fontWeight: '800', color: Colors.text, marginBottom: 8, lineHeight: 34 },
  hint: { fontSize: 16, color: Colors.textSub, marginBottom: 24, lineHeight: 24 },

  ampmRow: { flexDirection: 'row', gap: 12, marginBottom: 24 },
  ampmBtn: {
    flex: 1, minHeight: 60, borderRadius: 14, borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
  },
  ampmBtnOn: { borderColor: Colors.primary, backgroundColor: Colors.light },
  ampmText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  ampmTextOn: { color: Colors.dark },

  stepperRow: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'center', gap: 8 },
  stepperCol: { alignItems: 'center' },
  stepperLabel: { fontSize: 15, color: Colors.textSub, marginBottom: 8 },
  stepper: {
    flexDirection: 'row', alignItems: 'center', borderWidth: 2, borderColor: Colors.border,
    borderRadius: 14, backgroundColor: Colors.white,
  },
  stepBtn: { width: 56, height: 72, alignItems: 'center', justifyContent: 'center' },
  stepValue: { width: 60, textAlign: 'center', fontSize: 34, fontWeight: '800', color: Colors.text },
  colon: { fontSize: 34, fontWeight: '800', color: Colors.text, marginBottom: 14 },
  preview: { textAlign: 'center', fontSize: 22, fontWeight: '800', color: Colors.primary, marginTop: 22 },

  bottomArea: { marginTop: 'auto', paddingTop: 16, gap: 12 },
  primaryBtn: {
    minHeight: 60, borderRadius: 16, backgroundColor: Colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  primaryBtnText: { fontSize: 20, fontWeight: '800', color: Colors.white },
  btnDisabled: { opacity: 0.5 },
  ghostBtn: {
    minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderColor: Colors.border,
    backgroundColor: Colors.white, alignItems: 'center', justifyContent: 'center',
  },
  ghostBtnText: { fontSize: 17, fontWeight: '700', color: Colors.textSub },

  summaryRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderWidth: 1, borderColor: Colors.border,
    borderRadius: 14, paddingVertical: 16, paddingHorizontal: 18, marginBottom: 12,
  },
  summaryLabel: { fontSize: 20, fontWeight: '700', color: Colors.text },
  summaryActions: { flexDirection: 'row', gap: 8 },
  editBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: Colors.light },
  editBtnText: { fontSize: 16, fontWeight: '700', color: Colors.dark },
  delBtn: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: 10, backgroundColor: '#FDECEA' },
  delBtnText: { fontSize: 16, fontWeight: '700', color: Colors.danger },
  emptyText: { fontSize: 16, color: Colors.textSub, textAlign: 'center', paddingVertical: 24 },
  addMoreBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', borderColor: Colors.primary,
    marginTop: 4,
  },
  addMoreText: { fontSize: 17, fontWeight: '700', color: Colors.primary },
});
