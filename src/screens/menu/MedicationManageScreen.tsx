import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
  Linking,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect, useRoute, useNavigation } from '@react-navigation/native';
import type { RouteProp } from '@react-navigation/native';
import type { MenuStackParamList } from '../../navigation/MenuNavigator';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useSettings, MedNotif } from '../../context/SettingsContext';
import { useDialog } from '../../context/DialogContext';
import { buildRecommendedMedNotifs, resolveTrackingRecommendation } from '../../utils/recommendUtils';
import { minutesToLabel } from '../../utils/medUtils';
import {
  getRecommendationMeta,
  patchRecommendationMeta,
  buildSourceMedSignature,
} from '../../utils/medNotifRecommendationMeta';
import {
  LEGACY_SLOT_ORDER,
  LEGACY_SLOT_META,
  labelToLegacyKey,
  normalizeHhmm,
  slotTitle,
  type LegacyMealKey,
} from '../../constants/doseSlots';
import {
  ensurePatientDoseSlots,
  syncMedicationDoseSlots,
  invalidateDoseSlotsCache,
} from '../../hooks/useDoseSlots';

// ─── 타입 ────────────────────────────────────────────────────────────────────

type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'bedtime';

// 화면 내 슬롯 표시 상수(값 동일) — 공용 단일 출처(LEGACY_SLOT_META)에서 파생.
// label 은 기존 '아침약' 표기 유지(korMed). emoji/defaultTime/bgColor 동일.
const TIME_SLOTS: { key: TimeSlot; label: string; emoji: string; defaultTime: string; bgColor: string }[] =
  LEGACY_SLOT_ORDER.map((key) => {
    const meta = LEGACY_SLOT_META[key];
    return {
      key,
      label: meta.korMed,
      emoji: meta.emoji,
      defaultTime: meta.defaultTime,
      bgColor: meta.bgColor,
    };
  });

type MealSchedules = Partial<Record<TimeSlot, string>>;

interface DrugInfo {
  itemName: string;
  entpName?: string;
  itemImage?: string;
  chart?: string;
  drugShape?: string;
  colorClass?: string;
  className?: string;
  etcOtcName?: string;
  printFront?: string;
  printBack?: string;
  itemSeq?: string;
}

/**
 * 약에 배정된 dose_slots 조인 결과(표시 전용).
 * - key: dose_slot.label 을 legacy 슬롯 키로 역매핑한 값(표준 4슬롯). 비표준 라벨이면 null.
 * - time: 'HH:MM' (dose_slots.time 정규화)
 * - sortOrder: dose_slots.sort_order (표시 정렬용)
 * ⚠️ 표시 전용. 쓰기(meal_times/meal_schedules)에는 사용하지 않음.
 */
interface MedDoseSlot {
  key: LegacyMealKey | null;
  time: string;
  sortOrder: number;
}

interface Medication {
  id: string;
  name: string;
  dosage?: string | null;
  times: TimeSlot[];
  schedules?: MealSchedules;
  drugInfo?: DrugInfo | null;
  ediCode?: string;
  /** medication_dose_slots 조인(표시 우선). 없으면 legacy(times/schedules) 폴백. */
  doseSlots?: MedDoseSlot[];
}

type ChangeType = 'added' | 'updated' | 'deleted';

interface MedSnapshot {
  id: string;
  name: string;
  dosage?: string | null;
  meal_times: TimeSlot[];
}

// ─── API 함수 ─────────────────────────────────────────────────────────────────

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

async function getAccessToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();
  return session?.access_token ?? SUPABASE_ANON_KEY;
}

async function callClaudeOCR(
  base64Image: string,
  mediaType: string,
): Promise<{ medications: { name: string; ediCode: string; times: string[] }[]; rawText: string }> {
  // image_type: 'jpeg' | 'png'
  const rawType = mediaType.replace('image/', '');
  const imageType: 'jpeg' | 'png' = rawType === 'png' ? 'png' : 'jpeg';

  const accessToken = await getAccessToken();
  const response = await fetch(`${SUPABASE_URL}/functions/v1/claude-medical-record`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({
      image_base64: base64Image,
      image_type: imageType,
      mode: 'medication_manage',
    }),
  });

  if (!response.ok) throw new Error(`OCR 오류: ${response.status}`);
  const data = await response.json();
  const normalized = {
    medications: (data.medications ?? []).map((m: any) => ({
      name: String(m.name ?? ''),
      ediCode: (m.ediCode ?? '').toString().trim(),
      times: Array.isArray(m.times) ? m.times : [],
    })),
  };
  return { ...normalized, rawText: '' };
}

// mfds-proxy Edge Function 호출 헬퍼
async function callMfdsProxy(endpoint: 'grn' | 'easy' | 'easy01', query: string, opts?: { numOfRows?: number; pageNo?: number }): Promise<any> {
  const accessToken = await getAccessToken();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/mfds-proxy`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_ANON_KEY,
      'Authorization': `Bearer ${accessToken}`,
    },
    body: JSON.stringify({ endpoint, query, ...(opts ?? {}) }),
  });
  if (!res.ok) return null;
  return res.json();
}

function normalizeDrugName(s: string): string {
  return (s || '').replace(/[\s()（）\-_\/]/g, '').toUpperCase();
}

function isNameMatched(searchName: string, returnedName: string): boolean {
  if (!returnedName) return false;
  const s = normalizeDrugName(searchName);
  const r = normalizeDrugName(returnedName);
  if (!s || !r) return false;
  const sHead = s.slice(0, 3);
  const rHead = r.slice(0, 3);
  return r.includes(sHead) || s.includes(rHead);
}

async function searchMfdsInfo(drugName: string): Promise<DrugInfo | null> {
  // 1차: 의약품 e약은요 API (제품허가 기반, 브랜드명 검색에 강함) — mfds-proxy 경유
  let easyHit: {
    itemName: string;
    entpName?: string;
    itemImage?: string;
    efcyQesitm?: string;
    useMethodQesitm?: string;
  } | null = null;

  try {
    const easyData = await callMfdsProxy('easy', drugName, { numOfRows: 5, pageNo: 1 });
    if (easyData) {
      const rawEasy = easyData?.body?.items?.item ?? easyData?.body?.items;
      if (rawEasy) {
        const easyList = Array.isArray(rawEasy) ? rawEasy : [rawEasy];
        const matched = easyList.find((it: any) => isNameMatched(drugName, it?.itemName ?? '')) ?? easyList[0];
        if (matched && matched.itemName) {
          easyHit = {
            itemName: matched.itemName,
            entpName: matched.entpName ?? undefined,
            itemImage: matched.itemImage ?? undefined,
            efcyQesitm: matched.efcyQesitm ?? undefined,
            useMethodQesitm: matched.useMethodQesitm ?? undefined,
          };
        }
      }
    }
  } catch {
    // ignore, fallback to 낱알식별
  }

  // 2차: 낱알식별 API (이미지/모양 정보 보강) — mfds-proxy 경유
  let grnHit: any = null;
  try {
    const data = await callMfdsProxy('grn', drugName, { numOfRows: 5, pageNo: 1 });
    if (data) {
      const rawItems = data?.body?.items?.item ?? data?.body?.items;
      if (rawItems) {
        const list = Array.isArray(rawItems) ? rawItems : [rawItems];
        const matched = list.find((it: any) => isNameMatched(drugName, it?.ITEM_NAME ?? '')) ?? list[0];
        if (matched && isNameMatched(drugName, matched.ITEM_NAME ?? '')) {
          grnHit = matched;
        }
      }
    }
  } catch {
    // ignore
  }

  if (!easyHit && !grnHit) return null;

  const itemName = easyHit?.itemName || grnHit?.ITEM_NAME || drugName;
  const entpName = easyHit?.entpName ?? grnHit?.ENTP_NAME ?? undefined;
  const itemImage = easyHit?.itemImage || grnHit?.ITEM_IMAGE || undefined;

  return {
    itemName,
    entpName,
    itemImage,
    chart: grnHit?.CHART ?? undefined,
    drugShape: grnHit?.DRUG_SHAPE ?? undefined,
    colorClass: grnHit?.COLOR_CLASS1 ?? undefined,
    className: grnHit?.CLASS_NAME ?? undefined,
    etcOtcName: grnHit?.ETC_OTC_NAME ?? undefined,
    printFront: grnHit?.PRINT_FRONT ?? undefined,
    printBack: grnHit?.PRINT_BACK ?? undefined,
    itemSeq: grnHit?.ITEM_SEQ ?? undefined,
  };
}

// ─── 스와이프 다운 닫기 훅 ────────────────────────────────────────────────────

function useSwipeToDismiss(onDismiss: () => void) {
  const translateY = useRef(new Animated.Value(0)).current;

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) => gs.dy > 8 && Math.abs(gs.dy) > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (gs.dy > 80) {
          Animated.timing(translateY, { toValue: 600, duration: 200, useNativeDriver: true }).start(() => {
            translateY.setValue(0);
            onDismiss();
          });
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  return { translateY, panResponder };
}

// ─── 시간 선택 모달 ────────────────────────────────────────────────────────────

function TimePickerModal({
  visible,
  initialTime,
  slotLabel,
  onConfirm,
  onClose,
}: {
  visible: boolean;
  initialTime: string;
  slotLabel: string;
  onConfirm: (time: string) => void;
  onClose: () => void;
}) {
  const parseTime = (t: string) => {
    const [h, m] = t.split(':').map(Number);
    return { hour: isNaN(h) ? 8 : h, minute: isNaN(m) ? 0 : Math.floor(m / 10) * 10 };
  };

  const [hour, setHour] = useState(() => parseTime(initialTime).hour);
  const [minute, setMinute] = useState(() => parseTime(initialTime).minute);
  const hourScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      const parsed = parseTime(initialTime);
      setHour(parsed.hour);
      setMinute(parsed.minute);
      // 현재 시(hour)로 스크롤 위치 이동 (아이템 높이 56 + marginBottom 4 = 60px)
      setTimeout(() => {
        hourScrollRef.current?.scrollTo({ y: parsed.hour * 60, animated: false });
      }, 50);
    }
  }, [visible, initialTime]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 10, 20, 30, 40, 50];

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={tpStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={tpStyles.sheet} activeOpacity={1} onPress={() => {}}>
          <Text style={tpStyles.title}>{slotLabel} 시간 선택</Text>
          <View style={tpStyles.pickerRow}>
            <View style={tpStyles.pickerCol}>
              <Text style={tpStyles.colLabel}>시</Text>
              <ScrollView ref={hourScrollRef} style={tpStyles.scroll} showsVerticalScrollIndicator={false}>
                {hours.map(h => (
                  <TouchableOpacity
                    key={h}
                    style={[tpStyles.timeOption, h === hour && tpStyles.timeOptionSelected]}
                    onPress={() => setHour(h)}
                    activeOpacity={0.7}
                  >
                    <Text style={[tpStyles.timeOptionText, h === hour && tpStyles.timeOptionTextSelected]}>
                      {String(h).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            <Text style={tpStyles.colon}>:</Text>
            <View style={tpStyles.pickerCol}>
              <Text style={tpStyles.colLabel}>분</Text>
              <ScrollView style={tpStyles.scroll} showsVerticalScrollIndicator={false}>
                {minutes.map(m => (
                  <TouchableOpacity
                    key={m}
                    style={[tpStyles.timeOption, m === minute && tpStyles.timeOptionSelected]}
                    onPress={() => setMinute(m)}
                    activeOpacity={0.7}
                  >
                    <Text style={[tpStyles.timeOptionText, m === minute && tpStyles.timeOptionTextSelected]}>
                      {String(m).padStart(2, '0')}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
          <View style={tpStyles.btnRow}>
            <TouchableOpacity style={tpStyles.cancelBtn} onPress={onClose} activeOpacity={0.8}>
              <Text style={tpStyles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={tpStyles.confirmBtn}
              onPress={() => {
                onConfirm(`${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`);
                onClose();
              }}
              activeOpacity={0.8}
            >
              <Text style={tpStyles.confirmBtnText}>확인</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const tpStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', alignItems: 'center', justifyContent: 'center' },
  sheet: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    width: 280,
    elevation: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 16 },
  pickerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, marginBottom: 20 },
  pickerCol: { width: 80, alignItems: 'center' },
  colLabel: { fontSize: 18, fontWeight: '600', color: Colors.textSub, marginBottom: 8 },
  scroll: { height: 200, width: 72 },
  colon: { fontSize: 28, fontWeight: '700', color: Colors.text, marginTop: 28 },
  timeOption: {
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    marginBottom: 4,
  },
  timeOptionSelected: { backgroundColor: Colors.primary },
  timeOptionText: { fontSize: 20, fontWeight: '600', color: Colors.textSub },
  timeOptionTextSelected: { color: Colors.white, fontWeight: '700' },
  btnRow: { flexDirection: 'row', gap: 10 },
  cancelBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  confirmBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── 시간대 + 시간 선택 행 컴포넌트 ───────────────────────────────────────────

function TimeSlotsWithTime({
  selectedTimes,
  schedules,
  onToggle,
  onTimeChange,
}: {
  selectedTimes: TimeSlot[];
  schedules: MealSchedules;
  onToggle: (slot: TimeSlot) => void;
  onTimeChange: (slot: TimeSlot, time: string) => void;
}) {
  const [pickerSlot, setPickerSlot] = useState<TimeSlot | null>(null);

  const openSlot = TIME_SLOTS.find(s => s.key === pickerSlot);

  return (
    <>
      <View style={tsStyles.container}>
        {TIME_SLOTS.map(t => {
          const sel = selectedTimes.includes(t.key);
          const time = schedules[t.key] ?? t.defaultTime;
          return (
            <View key={t.key} style={tsStyles.slotWrapper}>
              <TouchableOpacity
                style={[tsStyles.slotBtn, sel && tsStyles.slotBtnSelected]}
                onPress={() => onToggle(t.key)}
                activeOpacity={0.85}
              >
                <Text style={[tsStyles.slotLabel, sel && tsStyles.slotLabelSelected]}>{t.label}</Text>
              </TouchableOpacity>
              {sel && (
                <TouchableOpacity
                  style={tsStyles.timeChip}
                  onPress={() => setPickerSlot(t.key)}
                  activeOpacity={0.8}
                >
                  <Text style={tsStyles.timeChipText}>{time}</Text>
                  <View style={tsStyles.timeEditBtn}>
                    <Text style={tsStyles.timeEditText}>수정</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <TimePickerModal
        visible={pickerSlot !== null}
        initialTime={pickerSlot ? (schedules[pickerSlot] ?? (TIME_SLOTS.find(s => s.key === pickerSlot)?.defaultTime ?? '08:00')) : '08:00'}
        slotLabel={openSlot?.label ?? ''}
        onConfirm={(time) => {
          if (pickerSlot) onTimeChange(pickerSlot, time);
        }}
        onClose={() => setPickerSlot(null)}
      />
    </>
  );
}

const tsStyles = StyleSheet.create({
  container: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 16 },
  slotWrapper: { width: '48%', alignItems: 'center', gap: 6 },
  slotBtn: {
    width: '100%',
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    flexDirection: 'row',
    gap: 6,
  },
  slotBtnSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  slotLabel: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  slotLabelSelected: { color: Colors.white },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    width: '100%',
  },
  timeChipText: { fontSize: 18, fontWeight: '700', color: Colors.primary, flex: 1, textAlign: 'center' },
  timeEditBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  timeEditText: { fontSize: 15, fontWeight: '600', color: Colors.primary },
});

// ─── DrugInfoModal ─────────────────────────────────────────────────────────────

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function DrugInfoModal({ drug, onClose }: { drug: Medication | null; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const [easyInfo, setEasyInfo] = useState<{
    efficacy?: string;
    dosage?: string;
    caution?: string;
  } | null>(null);
  const [easyLoading, setEasyLoading] = useState(false);
  const { translateY, panResponder } = useSwipeToDismiss(onClose);

  useEffect(() => {
    if (!drug?.name) return;
    setEasyInfo(null);
    setEasyLoading(true);
    callMfdsProxy('easy01', drug.name, { numOfRows: 3, pageNo: 1 })
      .then(data => {
        if (!data) return;
        // 공공 API 응답: data.response.body 또는 data.body
        const body = data?.response?.body ?? data?.body;
        const rawItems = body?.items?.item ?? body?.items;
        const item = Array.isArray(rawItems) ? rawItems[0] : rawItems;
        if (item) {
          setEasyInfo({
            efficacy: item.EE_DOC_DATA ? stripHtml(item.EE_DOC_DATA) : undefined,
            dosage: item.UD_DOC_DATA ? stripHtml(item.UD_DOC_DATA) : undefined,
            caution: item.NB_DOC_DATA ? stripHtml(item.NB_DOC_DATA) : undefined,
          });
        }
      })
      .catch((e) => { if (__DEV__) console.error('[DrugInfo] easyDrug API 오류:', e); })
      .finally(() => setEasyLoading(false));
  }, [drug?.name]);

  if (!drug) return null;
  const info = drug.drugInfo;

  const shapeDesc = [info?.colorClass, info?.drugShape, info?.chart]
    .filter(Boolean)
    .join(' ');

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[modalStyles.sheet, { paddingBottom: Math.max(32, insets.bottom + 16), transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={modalStyles.dragHandle} />
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={modalStyles.scrollContent}>
              <View style={modalStyles.imageContainer}>
                {info?.itemImage ? (
                  <Image source={{ uri: info.itemImage }} style={modalStyles.drugImage} resizeMode="contain" />
                ) : (
                  <View style={modalStyles.imagePlaceholder}>
                    <Ionicons name="medkit-outline" size={40} color={Colors.textHint} />
                  </View>
                )}
              </View>
              <Text style={modalStyles.drugName}>{drug.name}</Text>
              {info?.entpName && <Text style={modalStyles.companyName}>{info.entpName}</Text>}
              {!info && (
                <View style={modalStyles.noInfoContainer}>
                  <Text style={modalStyles.noInfoText}>식약처 정보를 불러올 수 없어요</Text>
                  <Text style={modalStyles.noInfoSubText}>약 이름이 정확한지 확인해주세요</Text>
                </View>
              )}
              {shapeDesc ? (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>성상</Text>
                  <Text style={modalStyles.sectionContent}>{shapeDesc}</Text>
                </View>
              ) : null}
              {(info?.className || info?.etcOtcName) && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>분류</Text>
                  <Text style={modalStyles.sectionContent}>
                    {[info.className, info.etcOtcName].filter(Boolean).join(' · ')}
                  </Text>
                </View>
              )}
              {(info?.printFront || info?.printBack) && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>식별</Text>
                  <Text style={modalStyles.sectionContent}>
                    {info.printFront ? `앞: ${info.printFront}` : ''}
                    {info.printFront && info.printBack ? '\n' : ''}
                    {info.printBack ? `뒤: ${info.printBack}` : ''}
                  </Text>
                </View>
              )}
              {easyLoading && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.easyLoadingText}>정보 불러오는 중...</Text>
                </View>
              )}
              {!easyLoading && easyInfo?.efficacy && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.sectionHeader}>효능효과</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.efficacy.slice(0, 300)}
                  </Text>
                </View>
              )}
              {!easyLoading && easyInfo?.caution && (
                <View style={modalStyles.section}>
                  <Text style={modalStyles.cautionHeader}>주의사항·부작용</Text>
                  <Text style={modalStyles.sectionContent}>
                    {easyInfo.caution.slice(0, 300)}
                  </Text>
                </View>
              )}
              <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
                <Text style={modalStyles.closeBtnText}>닫기</Text>
              </TouchableOpacity>
            </ScrollView>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>
    </Modal>
  );
}

const modalStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24, maxHeight: '80%', paddingBottom: 32 },
  dragHandle: { width: 40, height: 5, backgroundColor: '#DDDDDD', borderRadius: 3, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  scrollContent: { paddingHorizontal: 24, paddingBottom: 8 },
  imageContainer: { alignItems: 'center', marginVertical: 16 },
  drugImage: { width: 160, height: 100, resizeMode: 'contain', borderRadius: 8, backgroundColor: '#F5F5F5' },
  imagePlaceholder: { width: 100, height: 100, borderRadius: 50, backgroundColor: Colors.light, alignItems: 'center', justifyContent: 'center' },
  drugName: { fontSize: 24, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 6 },
  companyName: { fontSize: 16, color: Colors.textSub, textAlign: 'center', marginBottom: 20 },
  noInfoContainer: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  noInfoText: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  noInfoSubText: { fontSize: 16, color: Colors.textSub, textAlign: 'center', lineHeight: 26 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  sectionContent: { fontSize: 18, color: Colors.textSub, lineHeight: 28 },
  cautionHeader: { fontSize: 18, fontWeight: '700', color: '#C62828', marginBottom: 8 },
  easyLoadingText: { fontSize: 18, color: Colors.textSub, textAlign: 'center', paddingVertical: 8 },
  closeBtn: { backgroundColor: Colors.primary, borderRadius: 12, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── 시간대 수정 바텀시트 ──────────────────────────────────────────────────────

interface SlotEditBottomSheetProps {
  visible: boolean;
  slot: { key: TimeSlot; emoji: string; label: string; defaultTime: string; bgColor: string } | null;
  medications: Medication[];
  onClose: () => void;
  onSave: (updatedMeds: Medication[], newTime: string) => Promise<void>;
}

function SlotEditBottomSheet({ visible, slot, medications, onClose, onSave }: SlotEditBottomSheetProps) {
  const insets = useSafeAreaInsets();
  // 이 시간대의 약들 (초기 체크 상태)
  const slotMeds = medications.filter(m => slot ? m.times.includes(slot.key) : false);
  // 다른 시간대에만 있는 약들 (추가 가능)
  const otherMeds = medications.filter(m => slot ? !m.times.includes(slot.key) : false);

  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [addedIds, setAddedIds] = useState<Set<string>>(new Set());
  const [currentTime, setCurrentTime] = useState(slot?.defaultTime ?? '08:00');
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  const { translateY, panResponder } = useSwipeToDismiss(onClose);

  useEffect(() => {
    if (visible && slot) {
      // 이 시간대에 있는 약들 기본 체크
      const ids = new Set(slotMeds.map(m => m.id));
      setCheckedIds(ids);
      setAddedIds(new Set());
      // 이 시간대의 시간 (첫 번째 약 기준)
      const firstTime = slotMeds[0]?.schedules?.[slot.key] ?? slot.defaultTime;
      setCurrentTime(firstTime);
    }
  }, [visible, slot?.key]);

  if (!slot) return null;

  const toggleCheck = (id: string) => {
    setCheckedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleAdd = (id: string) => {
    setAddedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleSave = async () => {
    setIsSaving(true);
    try {
      // 변경된 약 목록 계산
      const updatedMeds: Medication[] = medications.map(med => {
        const wasInSlot = slotMeds.some(m => m.id === med.id);
        const isChecked = checkedIds.has(med.id);
        const isAdded = addedIds.has(med.id);

        let newTimes = [...med.times];
        let newSchedules = { ...(med.schedules ?? {}) };

        if (wasInSlot && !isChecked) {
          // 체크 해제 → 이 시간대에서 제거
          newTimes = newTimes.filter(t => t !== slot.key);
          delete newSchedules[slot.key];
        } else if (wasInSlot && isChecked) {
          // 체크 유지 → 시간 업데이트
          newSchedules[slot.key] = currentTime;
        } else if (!wasInSlot && isAdded) {
          // 새로 추가
          if (!newTimes.includes(slot.key)) newTimes = [...newTimes, slot.key];
          newSchedules[slot.key] = currentTime;
        }

        return { ...med, times: newTimes, schedules: newSchedules };
      });

      await onSave(updatedMeds, currentTime);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={seBsStyles.overlay} activeOpacity={1} onPress={onClose}>
        <Animated.View
          style={[seBsStyles.sheet, { paddingBottom: Math.max(32, insets.bottom + 16), transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}} style={{ flex: 1, flexDirection: 'column' }}>
            <View style={seBsStyles.dragHandle} />

            {/* 헤더 */}
            <View style={[seBsStyles.header, { backgroundColor: slot.bgColor }]}>
              <Text style={seBsStyles.headerTitle}>{slot.emoji} {slotTitle(slot.label, slot.key, currentTime)} 수정</Text>
              <TouchableOpacity onPress={onClose} style={seBsStyles.closeBtn} activeOpacity={0.7}>
                <Text style={seBsStyles.closeBtnText}>닫기</Text>
              </TouchableOpacity>
            </View>

            <ScrollView style={seBsStyles.scroll} showsVerticalScrollIndicator={false}>
              {/* 복용 시간 변경 */}
              <View style={seBsStyles.section}>
                <Text style={seBsStyles.sectionLabel}>복용 시간</Text>
                <TouchableOpacity
                  style={seBsStyles.timeChangeBtn}
                  onPress={() => setShowTimePicker(true)}
                  activeOpacity={0.8}
                >
                  <Text style={seBsStyles.timeChangeBtnText}>{currentTime} 변경</Text>
                  <Ionicons name="time-outline" size={20} color={Colors.primary} />
                </TouchableOpacity>
              </View>

              <View style={seBsStyles.divider} />

              {/* 이 시간대의 약 */}
              <View style={seBsStyles.section}>
                <Text style={seBsStyles.sectionLabel}>이 시간대에 복용하는 약</Text>
                {slotMeds.length === 0 && (
                  <Text style={seBsStyles.emptyText}>이 시간대에 복용하는 약이 없어요</Text>
                )}
                {slotMeds.map(med => {
                  const checked = checkedIds.has(med.id);
                  return (
                    <TouchableOpacity
                      key={med.id}
                      style={seBsStyles.medRow}
                      onPress={() => toggleCheck(med.id)}
                      activeOpacity={0.8}
                    >
                      <View style={[seBsStyles.checkbox, checked && seBsStyles.checkboxChecked]}>
                        {checked && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                      </View>
                      {med.drugInfo?.itemImage ? (
                        <Image source={{ uri: med.drugInfo.itemImage }} style={seBsStyles.medImg} resizeMode="contain" />
                      ) : (
                        <View style={seBsStyles.medImg} />
                      )}
                      <View style={seBsStyles.medTextGroup}>
                        <Text style={seBsStyles.medName}>{med.name}</Text>
                        {med.dosage ? <Text style={seBsStyles.medDosage}>{med.dosage}</Text> : null}
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </View>

              {/* 다른 약 추가 */}
              {otherMeds.length > 0 && (
                <>
                  <View style={seBsStyles.divider} />
                  <View style={seBsStyles.section}>
                    <Text style={seBsStyles.sectionLabel}>다른 약 추가</Text>
                    {otherMeds.map(med => {
                      const added = addedIds.has(med.id);
                      return (
                        <TouchableOpacity
                          key={med.id}
                          style={seBsStyles.medRow}
                          onPress={() => toggleAdd(med.id)}
                          activeOpacity={0.8}
                        >
                          <View style={[seBsStyles.checkbox, added && seBsStyles.checkboxChecked]}>
                            {added && <Ionicons name="checkmark" size={14} color={Colors.white} />}
                          </View>
                          {med.drugInfo?.itemImage ? (
                            <Image source={{ uri: med.drugInfo.itemImage }} style={seBsStyles.medImg} resizeMode="contain" />
                          ) : (
                            <View style={seBsStyles.medImg} />
                          )}
                          <View style={seBsStyles.medTextGroup}>
                            <Text style={[seBsStyles.medName, { color: Colors.textSub }]}>{med.name}</Text>
                            {med.dosage ? <Text style={seBsStyles.medDosage}>{med.dosage}</Text> : null}
                          </View>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </>
              )}
            </ScrollView>

            {/* 저장 버튼 — ScrollView 밖 고정 */}
            <View style={seBsStyles.saveSection}>
              <TouchableOpacity
                style={seBsStyles.saveBtn}
                onPress={handleSave}
                activeOpacity={0.85}
                disabled={isSaving}
              >
                {isSaving ? (
                  <ActivityIndicator color={Colors.white} />
                ) : (
                  <Text style={seBsStyles.saveBtnText}>저장</Text>
                )}
              </TouchableOpacity>
            </View>
          </TouchableOpacity>
        </Animated.View>
      </TouchableOpacity>

      <TimePickerModal
        visible={showTimePicker}
        initialTime={currentTime}
        slotLabel={slot.label}
        onConfirm={(time) => setCurrentTime(time)}
        onClose={() => setShowTimePicker(false)}
      />
    </Modal>
  );
}

const seBsStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    height: '85%',
    paddingBottom: 32,
  },
  dragHandle: { width: 40, height: 5, backgroundColor: '#DDDDDD', borderRadius: 3, alignSelf: 'center', marginTop: 12, marginBottom: 8 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
  },
  headerTitle: { fontSize: 22, fontWeight: '700', color: Colors.text },
  closeBtn: { paddingHorizontal: 16, paddingVertical: 10, borderRadius: 8, backgroundColor: 'rgba(0,0,0,0.08)' },
  closeBtnText: { fontSize: 18, fontWeight: '600', color: Colors.text },
  scroll: { flex: 1 },
  section: { paddingHorizontal: 20, paddingVertical: 16 },
  sectionLabel: { fontSize: 18, fontWeight: '700', color: Colors.textSub, marginBottom: 12 },
  divider: { height: 1, backgroundColor: Colors.border, marginHorizontal: 20 },
  emptyText: { fontSize: 18, color: Colors.textHint, textAlign: 'center', paddingVertical: 12 },
  timeChangeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    height: 56,
    paddingHorizontal: 20,
    borderRadius: 14,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  timeChangeBtnText: { fontSize: 20, fontWeight: '700', color: Colors.primary, flex: 1 },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  checkbox: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  checkboxChecked: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  medImg: { width: 40, height: 40, borderRadius: 6, backgroundColor: '#F5F5F5' },
  medEmoji: { fontSize: 28, width: 40, textAlign: 'center' },
  medTextGroup: { flex: 1 },
  medName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  medDosage: { fontSize: 18, color: Colors.textSub, marginTop: 2 },
  saveSection: { paddingHorizontal: 20, paddingTop: 8, paddingBottom: 16 },
  saveBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 14,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 20, fontWeight: '700', color: Colors.white },
});

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function MedicationManageScreen() {
  const { user } = useAuth();
  const route = useRoute<RouteProp<MenuStackParamList, 'MedicationManage'>>();
  const openSlotParam = (route.params as any)?.openSlot as ('morning' | 'lunch' | 'dinner' | 'bedtime') | undefined;
  const { getPatientForCaregiver } = useFamilyLink();
  const { unreadCount } = useNotificationBadge();
  const { medNotifs, setMedNotifs } = useSettings();
  const dialog = useDialog();
  const navigation = useNavigation<any>();
  const [medications, setMedications] = useState<Medication[]>([]);
  // 환자에게 dose_slots(이관/신규)가 1개 이상 있으면 true → 표시 슬롯/시각 폴백의 단일 기준.
  // (true면 약 카드/섹션 시각은 dose_slots 조인 우선, false면 legacy meal_schedules)
  const [hasDoseSlots, setHasDoseSlots] = useState(false);
  // 약효 확인 시간 재추천 제안 다이얼로그 진행 중복 방지
  const reRecommendInFlight = useRef(false);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Medication | null>(null);
  const [targetPatientId, setTargetPatientId] = useState<string | null>(null);

  // 전체 수정 영역 (직접 추가 폼 / 약 목록 수정)
  const [showAddForm, setShowAddForm] = useState(false);
  const [showEditList, setShowEditList] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDosage, setAddDosage] = useState('');
  const [addTimes, setAddTimes] = useState<TimeSlot[]>([]);
  const [addSchedules, setAddSchedules] = useState<MealSchedules>({});
  const [addDrugInfo, setAddDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isMfdsLoading, setIsMfdsLoading] = useState(false);

  // 인라인 수정 모드 (전체 수정 내 약 수정)
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDosage, setEditDosage] = useState('');
  const [editTimes, setEditTimes] = useState<TimeSlot[]>([]);
  const [editSchedules, setEditSchedules] = useState<MealSchedules>({});
  const [editDrugInfo, setEditDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isEditMfdsLoading, setIsEditMfdsLoading] = useState(false);

  // 시간대 수정 바텀시트
  const [slotEditTarget, setSlotEditTarget] = useState<typeof TIME_SLOTS[0] | null>(null);
  const openSlotHandled = useRef(false);

  // OCR 결과 확인 바텀시트
  const [ocrResultVisible, setOcrResultVisible] = useState(false);
  const [ocrRawText, setOcrRawText] = useState<string>('');
  const [ocrEnrichedMeds, setOcrEnrichedMeds] = useState<Array<{
    id: string;
    name: string;
    ediCode: string;
    dosage?: string | null;
    times: TimeSlot[];
    schedules?: MealSchedules;
    drugInfo?: DrugInfo | null;
    doseSlots?: MedDoseSlot[];
    checked: boolean;
  }>>([]);

  useEffect(() => {
    if (!openSlotParam || openSlotHandled.current) return;
    if (medications.length === 0) return;
    const slot = TIME_SLOTS.find(s => s.key === openSlotParam);
    if (slot) {
      openSlotHandled.current = true;
      setSlotEditTarget(slot);
    }
  }, [openSlotParam, medications]);

  // 대상 환자 id 결정
  useEffect(() => {
    if (!user) return;
    if (user.role === 'caregiver') {
      getPatientForCaregiver().then(patient => {
        setTargetPatientId(patient?.id ?? null);
      });
    } else {
      setTargetPatientId(user.id);
    }
  }, [user, getPatientForCaregiver]);

  // ── DB 로드 ────────────────────────────────────────────────────────────

  const loadMedications = useCallback(async () => {
    const pid = targetPatientId;
    if (!user || !pid) return;
    setIsLoading(true);
    try {
      const { data, error } = await supabase
        .from('medications')
        .select('*')
        .eq('patient_id', pid)
        .eq('is_active', true)
        .order('created_at', { ascending: true });
      if (error) throw error;
      const baseMeds: Medication[] = (data ?? []).map((row: any) => ({
        id: row.id,
        name: row.name,
        dosage: row.dosage ?? null,
        times: (row.meal_times ?? []) as TimeSlot[],
        schedules: (row.meal_schedules ?? {}) as MealSchedules,
        drugInfo: row.drug_image_url ? { itemName: row.name, itemImage: row.drug_image_url } : undefined,
      }));

      // ── 표시용 dose_slots 조인 (읽기 전용) ──────────────────────────────────
      // 이관/신규 환자: medication_dose_slots(M:N) → dose_slots 의 time/label 로 표시.
      // 없으면 hasDoseSlots=false → 기존 legacy(meal_times/meal_schedules) 폴백.
      // ⚠️ 쓰기 경로(meal_times/meal_schedules)는 전혀 건드리지 않음.
      let medsWithSlots = baseMeds;
      let patientHasDoseSlots = false;
      try {
        const medIds = baseMeds.map((m) => m.id);
        const { data: slotJoin, error: slotErr } = await supabase
          .from('medication_dose_slots')
          .select('medication_id, dose_slots!inner(label, time, sort_order, is_active, patient_id)')
          .eq('dose_slots.patient_id', pid)
          .eq('dose_slots.is_active', true)
          .in('medication_id', medIds.length > 0 ? medIds : ['__none__']);
        if (slotErr) throw slotErr;

        const byMed = new Map<string, MedDoseSlot[]>();
        (slotJoin ?? []).forEach((row: any) => {
          const ds = row.dose_slots;
          if (!ds) return;
          patientHasDoseSlots = true;
          const list = byMed.get(row.medication_id) ?? [];
          list.push({
            key: labelToLegacyKey(ds.label),
            time: normalizeHhmm(ds.time),
            sortOrder: ds.sort_order ?? 0,
          });
          byMed.set(row.medication_id, list);
        });

        if (patientHasDoseSlots) {
          medsWithSlots = baseMeds.map((m) => {
            const slots = byMed.get(m.id);
            if (!slots || slots.length === 0) return m;
            return {
              ...m,
              doseSlots: [...slots].sort((a, b) => a.sortOrder - b.sortOrder),
            };
          });
        }
      } catch (slotE) {
        // dose_slots 조인 실패 시 legacy 표시로 안전 폴백
        console.warn('[MedicationManageScreen] dose_slots 조인 실패, legacy 표시로 폴백:', slotE);
        patientHasDoseSlots = false;
        medsWithSlots = baseMeds;
      }
      setHasDoseSlots(patientHasDoseSlots);
      setMedications(medsWithSlots);

      // drug_image_url 없는 약은 식약처 API로 이미지 보충 시도
      const medsWithoutImage = baseMeds.filter(m => !m.drugInfo?.itemImage);
      if (medsWithoutImage.length > 0) {
        Promise.all(
          medsWithoutImage.map(async med => {
            const info = await searchMfdsInfo(med.name);
            return { id: med.id, drugInfo: info };
          })
        ).then(results => {
          setMedications(prev =>
            prev.map(med => {
              const found = results.find(r => r.id === med.id);
              if (!found) return med;
              // DB에도 이미지 URL 저장 (비동기, 실패해도 무시)
              if (found.drugInfo?.itemImage) {
                supabase
                  .from('medications')
                  .update({
                    drug_image_url: found.drugInfo.itemImage,
                    ...(found.drugInfo.itemSeq ? { item_seq: found.drugInfo.itemSeq } : {}),
                  })
                  .eq('id', med.id)
                  .then(() => {})
                  .catch(() => {});
              }
              return { ...med, drugInfo: found.drugInfo ?? med.drugInfo };
            })
          );
        }).catch(() => {});
      }
    } catch (e) {
      console.error('[MedicationManageScreen] loadMedications 오류:', e);
    } finally {
      setIsLoading(false);
    }
  }, [user, targetPatientId]);

  useEffect(() => {
    if (targetPatientId) loadMedications();
  }, [loadMedications, targetPatientId]);

  useFocusEffect(
    useCallback(() => {
      if (targetPatientId) loadMedications();
    }, [loadMedications, targetPatientId])
  );

  // ── OCR ────────────────────────────────────────────────────────────────

  const pickImageAndRunOCR = async (useCamera: boolean) => {
    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') { await dialog.alert({ title: '권한 필요', message: '카메라 접근 권한이 필요해요.' }); return; }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { await dialog.alert({ title: '권한 필요', message: '갤러리 접근 권한이 필요해요.' }); return; }
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (!asset.base64) { await dialog.alert({ title: '오류', message: '이미지를 읽을 수 없어요.' }); return; }

      const uri = asset.uri.toLowerCase();
      let mediaType = 'image/jpeg';
      if (uri.includes('.png')) mediaType = 'image/png';
      else if (uri.includes('.gif')) mediaType = 'image/gif';
      else if (uri.includes('.webp')) mediaType = 'image/webp';

      setIsOcrLoading(true);

      const parsed = await callClaudeOCR(asset.base64, mediaType);
      const validSlots: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
      const newMeds: Medication[] = parsed.medications.map((med, i) => ({
        id: (Date.now() + i).toString(),
        name: med.name,
        ediCode: (med.ediCode ?? '').trim(),
        times: med.times.filter((t): t is TimeSlot => validSlots.includes(t as TimeSlot)),
        schedules: {},
      }));

      const enriched = await Promise.all(
        newMeds.map(async med => ({ ...med, drugInfo: (await searchMfdsInfo(med.name)) ?? null }))
      );

      if (enriched.length === 0) {
        await dialog.alert({ title: '약을 찾지 못했어요', message: '사진이 선명한지 확인 후 다시 시도하거나, 직접 입력해주세요.' });
        return;
      }

      // DB 저장 대신 바텀시트로 결과 표시
      setOcrRawText(parsed.rawText ?? '');
      setOcrEnrichedMeds(enriched.map(m => ({ ...m, ediCode: m.ediCode ?? '', checked: true })));
      setOcrResultVisible(true);
    } catch {
      await dialog.alert({ message: '분석에 실패했어요. 다시 시도해주세요.' });
    } finally {
      setIsOcrLoading(false);
    }
  };

  // ── 비교 키 / 비교 유틸 ───────────────────────────────────────────────
  const normalizeNameKey = (name: string): string =>
    (name ?? '').replace(/\s/g, '').toLowerCase().slice(0, 5);

  // EDI코드가 있으면 EDI 우선, 없으면 이름 fallback
  const matchKey = (m: { ediCode?: string | null; name?: string | null }): string => {
    const edi = (m.ediCode ?? '').toString().trim();
    if (edi) return 'edi:' + edi;
    return 'name:' + normalizeNameKey(m.name ?? '');
  };

  const slotsLabel = (slots: string[]): string => {
    const order: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
    const sorted = order.filter(s => slots.includes(s));
    return sorted.map(s => TIME_SLOTS.find(t => t.key === s)?.label.replace('약', '') ?? s).join(',') || '없음';
  };

  // ── 표시 슬롯 단일 진입점 (읽기 전용) ─────────────────────────────────────
  // dose_slots 조인(med.doseSlots)이 있으면 그걸로, 없으면 legacy(times/schedules).
  // ⚠️ 쓰기에는 절대 사용하지 않음 — 약 카드/섹션의 라벨·시각 표시 전용.

  /** 약이 속한 표시용 표준 슬롯 키 목록(LEGACY_SLOT_ORDER 순서). */
  const medDisplaySlotKeys = useCallback((med: Medication): TimeSlot[] => {
    if (hasDoseSlots && med.doseSlots && med.doseSlots.length > 0) {
      // dose_slots 조인 우선. 표준 4슬롯으로 역매핑되는 것만(비표준 라벨은 6단계 세트카드에서 처리).
      const keys = med.doseSlots
        .map((s) => s.key)
        .filter((k): k is TimeSlot => k != null);
      return LEGACY_SLOT_ORDER.filter((k) => keys.includes(k));
    }
    // legacy 폴백
    return LEGACY_SLOT_ORDER.filter((k) => med.times.includes(k));
  }, [hasDoseSlots]);

  /** 특정 약·슬롯의 표시 시각('HH:MM'). dose_slots 우선, 없으면 legacy schedules, 최후 defaultTime. */
  const medDisplaySlotTime = useCallback((med: Medication, key: TimeSlot): string => {
    if (hasDoseSlots && med.doseSlots && med.doseSlots.length > 0) {
      const ds = med.doseSlots.find((s) => s.key === key);
      if (ds?.time) return ds.time;
    }
    return med.schedules?.[key] ?? (LEGACY_SLOT_META[key]?.defaultTime ?? '08:00');
  }, [hasDoseSlots]);

  type DiffEntry =
    | { type: 'added'; name: string; ediCode?: string; key: string }
    | { type: 'stopped'; name: string; ediCode?: string; key: string; prevItemId?: string; prevMedId?: string }
    | { type: 'timing_changed'; name: string; ediCode?: string; key: string; prevSlots: string[]; newSlots: string[]; prevMedId?: string }
    | { type: 'dose_changed'; name: string; ediCode?: string; key: string; prevTakes: number; newTakes: number; prevMedId?: string }
    | { type: 'unchanged'; name: string; ediCode?: string; key: string; prevMedId?: string };

  const performOcrSave = async (
    selected: typeof ocrEnrichedMeds,
    diffs: DiffEntry[]
  ) => {
    if (!user || !targetPatientId) {
      setMedications(prev => [...prev, ...selected]);
      return;
    }

    const today = new Date().toISOString().slice(0, 10);

    try {
      // 1) prescription 헤더 저장
      let prescriptionId: string | null = null;
      try {
        const { data: rxRow, error: rxErr } = await supabase
          .from('prescriptions')
          .insert({
            patient_id: targetPatientId,
            issued_at: today,
            hospital: null,
            source: 'ocr',
            image_url: null,
            raw_ocr_text: ocrRawText || null,
          })
          .select()
          .single();
        if (rxErr) throw rxErr;
        prescriptionId = rxRow?.id ?? null;

        if (prescriptionId) {
          const itemRows = selected.map(med => ({
            prescription_id: prescriptionId,
            edi_code: med.ediCode && med.ediCode.trim() ? med.ediCode.trim() : null,
            product_name: med.name,
            dose_per_take: 1,
            takes_per_day: med.times.length,
            total_days: null,
            timing_slots: med.times,
            meal_relation: 'none',
            free_text: null,
          }));
          if (itemRows.length > 0) {
            const { error: itemErr } = await supabase
              .from('prescription_items')
              .insert(itemRows);
            if (itemErr) console.warn('[OCR confirm] prescription_items 저장 실패:', itemErr);
          }
        }
      } catch (rxErr) {
        console.warn('[OCR confirm] prescriptions 저장 실패:', rxErr);
      }

      // 2) medications 동기화 — diff 기반 (EDI코드 우선 매칭)
      const addedKeys = new Set(diffs.filter(d => d.type === 'added').map(d => d.key));
      // 2-1) 신규 약: insert
      const toInsert = selected.filter(m => addedKeys.has(matchKey(m)));
      let insertedDbMeds: Medication[] = [];
      if (toInsert.length > 0) {
        const { data: inserted, error: insertError } = await supabase
          .from('medications')
          .insert(
            toInsert.map(med => ({
              patient_id: targetPatientId,
              name: med.name,
              dosage: null,
              meal_times: med.times,
              meal_schedules: {},
              scheduled_times: [] as string[],
              drug_code: null,
              drug_image_url: med.drugInfo?.itemImage ?? null,
              item_seq: med.drugInfo?.itemSeq ?? null,
              is_active: true,
            }))
          )
          .select();
        if (insertError) throw insertError;
        insertedDbMeds = (inserted ?? []).map((row: any) => {
          const matched = toInsert.find(s => s.name === row.name);
          return {
            id: row.id,
            name: row.name,
            dosage: null,
            times: (row.meal_times ?? []) as TimeSlot[],
            schedules: (row.meal_schedules ?? {}) as MealSchedules,
            drugInfo: matched?.drugInfo ?? null,
            ediCode: matched?.ediCode ?? '',
          };
        });
      }

      // 2-2) 변경된 약: update (meal_times 갱신)
      const toUpdate = diffs.filter(
        d => d.type === 'timing_changed' || d.type === 'dose_changed'
      ) as Extract<DiffEntry, { type: 'timing_changed' | 'dose_changed' }>[];
      const updatedIds: string[] = [];
      for (const d of toUpdate) {
        if (!d.prevMedId) continue;
        const newMed = selected.find(s => matchKey(s) === d.key);
        if (!newMed) continue;
        const { error: upErr } = await supabase
          .from('medications')
          .update({
            meal_times: newMed.times,
            meal_schedules: {},
            scheduled_times: [] as string[],
            is_active: true,
          })
          .eq('id', d.prevMedId);
        if (upErr) console.warn('[OCR confirm] medications update 실패:', upErr);
        else updatedIds.push(d.prevMedId);
      }

      // 2-3) 중단된 약: is_active=false + ended_at(있으면)
      const toStop = diffs.filter(d => d.type === 'stopped') as Extract<DiffEntry, { type: 'stopped' }>[];
      const stoppedIds: string[] = [];
      for (const d of toStop) {
        if (!d.prevMedId) continue;
        // ended_at 컬럼 시도 (실패하면 is_active만)
        const { error: upErr } = await supabase
          .from('medications')
          .update({ is_active: false, ended_at: today })
          .eq('id', d.prevMedId);
        if (upErr) {
          const { error: upErr2 } = await supabase
            .from('medications')
            .update({ is_active: false })
            .eq('id', d.prevMedId);
          if (upErr2) console.warn('[OCR confirm] 중단 처리 실패:', upErr2);
          else stoppedIds.push(d.prevMedId);
        } else {
          stoppedIds.push(d.prevMedId);
        }
      }

      // 2-4) dose_slots dual-write: 신규/변경 약의 약↔슬롯 매핑 동기화 + 중단 약 매핑 정리.
      // OCR 경로는 medications.meal_schedules 를 {} 로 두므로 dose_slot.time 은 환자
      // users.meal_schedules(기존 시각) 기준으로 보장한다. 실패해도 throw 안 함.
      try {
        const { data: freshUser } = await supabase
          .from('users')
          .select('meal_schedules')
          .eq('id', targetPatientId)
          .single();
        const mergedSchedules = (freshUser?.meal_schedules ?? {}) as MealSchedules;
        await ensureDoseSlotsForPatient(mergedSchedules);
        // 신규 약 매핑
        await Promise.all(
          insertedDbMeds.map((m) =>
            syncMedicationDoseSlots(targetPatientId, m.id, (m.times ?? []) as LegacyMealKey[])
          )
        );
        // 변경 약 매핑(새 meal_times 기준)
        await Promise.all(
          toUpdate.map((d) => {
            if (!d.prevMedId) return Promise.resolve();
            const newMed = selected.find((s) => matchKey(s) === d.key);
            if (!newMed) return Promise.resolve();
            return syncMedicationDoseSlots(
              targetPatientId!,
              d.prevMedId,
              (newMed.times ?? []) as LegacyMealKey[]
            );
          })
        );
        // 중단 약 매핑 비움(빈 배열 → 기존 매핑 delete)
        await Promise.all(
          stoppedIds.map((id) => syncMedicationDoseSlots(targetPatientId!, id, []))
        );
        invalidateDoseSlotsCache(targetPatientId);
      } catch (dsErr) {
        console.warn('[OCR confirm] dose_slots 동기화 실패(계속):', dsErr);
      }

      // 3) 화면 상태 동기화
      setMedications(prev => {
        const next = prev
          .filter(m => !stoppedIds.includes(m.id))
          .map(m => {
            const upd = toUpdate.find(d => d.prevMedId === m.id);
            if (!upd) return m;
            const newMed = selected.find(s => matchKey(s) === upd.key);
            if (!newMed) return m;
            return { ...m, times: newMed.times, schedules: {} };
          })
          .concat(insertedDbMeds);
        insertedDbMeds.forEach(m => {
          saveMedicationHistory(targetPatientId!, m.id, 'added', next);
        });
        // 처방전 등록으로 약 변경 → 재추천 제안(비강제 §3-C)
        proposeReRecommend(next);
        return next;
      });
    } catch (e) {
      console.error('[OCR confirm] 저장 오류:', e);
      // 최후 폴백: 화면에 표시만
      setMedications(prev => [...prev, ...selected]);
    }
  };

  const handleOcrConfirm = async () => {
    const selected = ocrEnrichedMeds.filter(m => m.checked);
    if (selected.length === 0) {
      setOcrResultVisible(false);
      return;
    }
    setOcrResultVisible(false);

    // ── 직전 처방전 조회 + 비교 + PK 매칭 안내 통합 ─────────────────────
    let diffs: DiffEntry[] = [];
    let isFirstPrescription = false;
    let pkTips: string[] = [];

    try {
      if (targetPatientId) {
        // 직전 prescription
        const { data: prevRx } = await supabase
          .from('prescriptions')
          .select('id, issued_at')
          .eq('patient_id', targetPatientId)
          .order('issued_at', { ascending: false })
          .limit(1);
        const prevPrescriptionId = prevRx?.[0]?.id;

        // 현재 active medications (medications 테이블엔 edi_code 컬럼 없을 수 있어 이름 기반 매핑)
        const { data: activeMeds } = await supabase
          .from('medications')
          .select('id, name, meal_times')
          .eq('patient_id', targetPatientId)
          .eq('is_active', true);
        const medByNameKey = new Map<string, { id: string; name: string; times: string[] }>();
        (activeMeds ?? []).forEach((r: any) => {
          medByNameKey.set('name:' + normalizeNameKey(r.name), {
            id: r.id,
            name: r.name,
            times: (r.meal_times ?? []) as string[],
          });
        });

        if (!prevPrescriptionId) {
          isFirstPrescription = true;
          diffs = selected.map(m => {
            const key = matchKey(m);
            return {
              type: 'added',
              name: m.name,
              ediCode: m.ediCode,
              key,
            } as DiffEntry;
          });
        } else {
          const { data: prevItems } = await supabase
            .from('prescription_items')
            .select('id, product_name, edi_code, timing_slots, takes_per_day, dose_per_take')
            .eq('prescription_id', prevPrescriptionId);
          // EDI 우선 매칭 키
          const prevByKey = new Map<string, any>();
          (prevItems ?? []).forEach((it: any) => {
            const key = matchKey({ ediCode: it.edi_code, name: it.product_name });
            prevByKey.set(key, it);
          });
          const newByKey = new Map<string, typeof selected[number]>();
          selected.forEach(s => newByKey.set(matchKey(s), s));

          // 추가 / 변경 / 동일
          for (const s of selected) {
            const key = matchKey(s);
            const prev = prevByKey.get(key);
            // medications 테이블 매칭은 이름 키로 (edi_code 컬럼 없을 수 있음)
            const prevMedId = medByNameKey.get('name:' + normalizeNameKey(s.name))?.id;
            if (!prev) {
              diffs.push({ type: 'added', name: s.name, ediCode: s.ediCode, key });
              continue;
            }
            const prevSlots = (prev.timing_slots ?? []) as string[];
            const newSlots = s.times as string[];
            const slotsDiffer =
              prevSlots.length !== newSlots.length ||
              !prevSlots.every(ps => newSlots.includes(ps));
            const prevTakes = prev.takes_per_day ?? prevSlots.length;
            const newTakes = newSlots.length;
            if (slotsDiffer) {
              diffs.push({
                type: 'timing_changed',
                name: s.name,
                ediCode: s.ediCode,
                key,
                prevSlots,
                newSlots,
                prevMedId,
              });
            } else if (prevTakes !== newTakes) {
              diffs.push({
                type: 'dose_changed',
                name: s.name,
                ediCode: s.ediCode,
                key,
                prevTakes,
                newTakes,
                prevMedId,
              });
            } else {
              diffs.push({ type: 'unchanged', name: s.name, ediCode: s.ediCode, key, prevMedId });
            }
          }
          // 중단: 직전엔 있는데 신규엔 없음
          for (const [key, prev] of prevByKey.entries()) {
            if (!newByKey.has(key)) {
              const prevEdi = (prev.edi_code ?? '').toString().trim();
              diffs.push({
                type: 'stopped',
                name: prev.product_name,
                ediCode: prevEdi || undefined,
                key,
                prevItemId: prev.id,
                prevMedId: medByNameKey.get('name:' + normalizeNameKey(prev.product_name))?.id,
              });
            }
          }
        }
      }
    } catch (cmpErr) {
      console.warn('[OCR confirm] 비교 실패, 전부 신규로 진행:', cmpErr);
      diffs = selected.map(m => ({ type: 'added', name: m.name, ediCode: m.ediCode, key: matchKey(m) } as DiffEntry));
    }

    // PK 매칭 tips (실패해도 무시) — EDI코드 있으면 우선 조회
    try {
      for (const med of selected) {
        let profile: any = null;
        const edi = (med.ediCode ?? '').trim();
        if (edi) {
          const { data: byEdi } = await supabase
            .from('medication_pk_profile')
            .select('product_name, ingredient, suggested_slots, onset_min, tmax_min, edi_code')
            .eq('edi_code', edi)
            .limit(1);
          profile = byEdi?.[0] ?? null;
        }
        if (!profile) {
          const nameFrag = med.name.replace(/\s/g, '').slice(0, 3);
          if (!nameFrag) continue;
          const { data: profileRows } = await supabase
            .from('medication_pk_profile')
            .select('product_name, ingredient, suggested_slots, onset_min, tmax_min')
            .or(`product_name.ilike.%${nameFrag}%,ingredient.ilike.%${nameFrag}%`)
            .limit(1);
          profile = profileRows?.[0];
        }
        if (profile) {
          const slots: number[] = (profile?.suggested_slots as number[] | undefined) ?? [0, 30, 120];
          const label = slots
            .filter(s => s > 0)
            .map(s => (s >= 60 ? `${Math.round(s / 60)}시간` : `${s}분`))
            .join(', ');
          pkTips.push(`ℹ️ ${med.name}: 복용 후 ${label} 시점 기록 권장`);
        }
      }
    } catch (matchErr) {
      console.warn('[OCR confirm] PK 매칭 실패:', matchErr);
    }

    // ── 비교 다이얼로그 메시지 작성 ───────────────────────────────────────
    const lines: string[] = [];
    if (isFirstPrescription) {
      lines.push('처음 등록되는 처방입니다.');
    } else {
      const addedLines = diffs.filter(d => d.type === 'added').map(d => `➕ ${d.name} 추가`);
      const stoppedLines = diffs.filter(d => d.type === 'stopped').map(d => `❌ ${d.name} 중단`);
      const timingLines = diffs
        .filter(d => d.type === 'timing_changed')
        .map(d => {
          const t = d as Extract<DiffEntry, { type: 'timing_changed' }>;
          return `🟡 ${t.name} 복용시기 변경 (${slotsLabel(t.prevSlots)} → ${slotsLabel(t.newSlots)})`;
        });
      const doseLines = diffs
        .filter(d => d.type === 'dose_changed')
        .map(d => {
          const t = d as Extract<DiffEntry, { type: 'dose_changed' }>;
          return `🟡 ${t.name} 1일 횟수 변경 (${t.prevTakes}회 → ${t.newTakes}회)`;
        });
      lines.push(...addedLines, ...timingLines, ...doseLines, ...stoppedLines);
      if (lines.length === 0) {
        lines.push('직전 처방과 동일합니다.');
      }
    }
    if (pkTips.length > 0) {
      lines.push('');
      lines.push(...pkTips);
    }

    // 공용 다이얼로그로 확인
    const ok = await dialog.confirm({
      title: '직전 처방과 비교',
      message: lines.join('\n'),
      confirmText: '등록하기',
      cancelText: '취소',
      cancelable: true,
    });
    if (ok) { performOcrSave(selected, diffs); }
  };

  const handleOcrPress = async () => {
    const choice = await dialog.show({
      title: '처방전 사진 등록',
      message: '사진을 어디서 가져올까요?',
      buttons: [
        { id: 'camera', text: '카메라로 찍기' },
        { id: 'gallery', text: '갤러리에서 선택' },
        { id: 'cancel', text: '취소', style: 'cancel' },
      ],
      cancelable: true,
    });
    if (choice === 'camera') pickImageAndRunOCR(true);
    else if (choice === 'gallery') pickImageAndRunOCR(false);
  };

  // ── 식약처 정보 조회 ──────────────────────────────────────────────────

  const handleFetchMfdsForAdd = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { await dialog.alert({ message: '약 이름을 먼저 입력해주세요.' }); return; }
    setIsMfdsLoading(true);
    try {
      const info = await searchMfdsInfo(trimmed);
      setAddDrugInfo(info);
    } finally {
      setIsMfdsLoading(false);
    }
  };

  const handleFetchMfdsForEdit = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { await dialog.alert({ message: '약 이름을 먼저 입력해주세요.' }); return; }
    setIsEditMfdsLoading(true);
    try {
      const info = await searchMfdsInfo(trimmed);
      setEditDrugInfo(info);
    } finally {
      setIsEditMfdsLoading(false);
    }
  };

  // ── medication_history 스냅샷 저장 헬퍼 ────────────────────────────────────

  const saveMedicationHistory = useCallback(async (
    patientId: string,
    changedMedicationId: string | null,
    changeType: ChangeType,
    allMedications: Medication[],
  ) => {
    try {
      const snapshot: MedSnapshot[] = allMedications.map(m => ({
        id: m.id,
        name: m.name,
        dosage: m.dosage ?? null,
        meal_times: m.times,
      }));
      await supabase.from('medication_history').insert({
        patient_id: patientId,
        changed_medication_id: changedMedicationId,
        change_type: changeType,
        snapshot,
      });
    } catch (e) {
      console.warn('[saveMedicationHistory] 이력 저장 실패:', e);
    }
  }, []);

  // ── 약효 확인 시간 재추천(§3-C 비강제) / 사용자 수정값 보존(§13-6) ───────────

  /** 현재 등록 약 목록 → 추천 입력 형태 */
  const toRecommendInput = useCallback((meds: Medication[]) =>
    meds.map(m => ({
      name: m.name,
      mfdsClassName: m.drugInfo?.className ?? undefined,
    })), []);

  /** 현재 등록 약 목록 → 약/용량 시그니처(§8.1) */
  const toSignature = useCallback((meds: Medication[]) =>
    buildSourceMedSignature(
      meds.map(m => ({
        name: m.name,
        className: m.drugInfo?.className ?? null,
        dosage: m.dosage ?? null,
      }))
    ), []);

  /** 등록 레보도파 약 중 식약처 itemSeq 보유한 것(원문 링크용) */
  const findLevodopaSeq = useCallback((meds: Medication[]): { name: string; itemSeq?: string } | null => {
    const levo = meds.filter(m => {
      const rec = resolveTrackingRecommendation(m.name, m.drugInfo?.className ?? undefined);
      return rec?.active === true;
    });
    if (levo.length === 0) return null;
    const withSeq = levo.find(m => m.drugInfo?.itemSeq);
    const pick = withSeq ?? levo[0];
    return { name: pick.name, itemSeq: pick.drugInfo?.itemSeq };
  }, []);

  /** 식약처 원문 직접 보기 (§4-A / 외부 브라우저 — 60대 고지 동반) */
  const openMfdsDetail = useCallback(async (target: { name: string; itemSeq?: string } | null) => {
    if (!target) return;
    const url = target.itemSeq
      ? `https://nedrug.mfds.go.kr/pbp/CCBBB01/getItemDetail?itemSeq=${target.itemSeq}`
      : `https://nedrug.mfds.go.kr/searchDrug?searchYn=true&keyword=${encodeURIComponent(target.name)}`;
    const ok = await dialog.confirm({
      title: '식약처 약 정보',
      message: '인터넷 창이 열려요.\n보고 나서 ◀(뒤로)로 돌아오시면 돼요.',
      confirmText: '식약처 정보 열기',
      cancelText: '취소',
      cancelable: true,
    });
    if (ok) { Linking.openURL(url).catch(() => {}); }
  }, [dialog]);

  /**
   * 약효 확인 시간 재추천 제안(비강제 — §3-C / §13-6).
   *
   * @param meds 평가 대상 약 목록(변경 직후 최신)
   * @param opts.manual true=사용자가 진입점에서 직접 요청(시그니처 동일해도 표시)
   */
  const proposeReRecommend = useCallback(async (meds: Medication[], opts?: { manual?: boolean }) => {
    if (reRecommendInFlight.current) return;
    try {
      const meta = await getRecommendationMeta();
      const userEdited = meta?.userEdited === true;
      const prevSig = meta?.sourceMedSignature;
      const nextSig = toSignature(meds);

      const result = buildRecommendedMedNotifs(toRecommendInput(meds));
      const hasLevodopa = result.notifs.length > 0;

      // 레보도파가 하나도 없게 됨 → 강제 변경 금지, 안심 안내만(§7-X 비레보도파 카피)
      if (!hasLevodopa) {
        // 시그니처는 갱신해 두되(다이얼로그 반복 방지) medNotifs 는 사용자 것 유지
        await patchRecommendationMeta({ sourceMedSignature: nextSig });
        if (opts?.manual || (prevSig !== undefined && prevSig !== nextSig)) {
          await dialog.alert({
            title: '약효 확인 시간',
            message: '지금 등록하신 약은 약효추적 알림 대상이 아니에요.\n약은 평소대로 잘 챙기시면 돼요. 알림은 안 와도 괜찮아요.',
            confirmText: '알겠어요',
          });
        }
        return;
      }

      // 시그니처 변화 없음 + 수동 호출 아님 → 제안 안 함
      const changed = prevSig === undefined || prevSig !== nextSig;
      if (!changed && !opts?.manual) return;

      const levoTarget = findLevodopaSeq(meds);
      const timeList = result.notifs
        .map(n => `• 복용 ${minutesToLabel(n.minutes)}`)
        .join('\n');

      const baseMsg =
        '약이 바뀌었어요. 약에 맞춰 컨디션 확인 시간을 새로 잡아드릴까요?\n\n' +
        '이렇게 맞춰드릴 수 있어요:\n' + timeList;
      const editedWarn = userEdited
        ? '\n\n직접 정하신 시간이 있어요. 바꾸면 그 설정은 사라져요.'
        : '';

      const applyNew = async () => {
        const applied: MedNotif[] = result.notifs.map(n => ({ ...n, enabled: true }));
        setMedNotifs(applied);
        await patchRecommendationMeta({
          recommendedFromClasses: result.activeClasses,
          userEdited: false,            // 사용자가 명시 적용 → 새 기준 확정(§8.1)
          lastAppliedAt: new Date().toISOString(),
          sourceMedSignature: nextSig,
        });
        await dialog.alert({ title: '맞췄어요', message: '약에 맞춰 컨디션 확인 시간을 새로 맞췄어요.\n주치의와 상의해 언제든 바꾸실 수 있어요.', confirmText: '알겠어요' });
      };

      const keepAsIs = async () => {
        // 사용자 값 불변 — 시그니처만 갱신해 다이얼로그 반복 방지
        await patchRecommendationMeta({ sourceMedSignature: nextSig });
      };

      reRecommendInFlight.current = true;
      // 버튼/배경탭/스와이프/백버튼 어느 경로로 닫혀도 dialog.show가
      // 단 한 번만 resolve → 정리 로직 1회·가드 해제 1회 보장.
      const picked = await dialog.show({
        title: '약효 확인 시간',
        message: baseMsg + editedWarn,
        buttons: [
          { id: 'apply', text: '새 시간으로 맞출게요', style: 'primary' },
          { id: 'keep', text: '그대로 둘게요', style: 'cancel' },
        ],
        cancelable: true,
      });
      try {
        // 'apply'만 새 시간 적용, 그 외(그대로 둘게요/배경탭/스와이프/null) = keepAsIs
        if (picked === 'apply') {
          await applyNew();
        } else {
          await keepAsIs();
        }
      } finally {
        reRecommendInFlight.current = false;
      }
    } catch (e) {
      console.warn('[proposeReRecommend] 오류:', e);
      reRecommendInFlight.current = false;
    }
  }, [toSignature, toRecommendInput, findLevodopaSeq, setMedNotifs]);

  // ── dose_slots dual-write 헬퍼 (5단계) ────────────────────────────────────
  // legacy(meal_times/meal_schedules) 쓰기 직후 신규 dose_slots/medication_dose_slots
  // 를 동기화하는 공용 진입점. 헬퍼는 실패해도 throw 하지 않으므로 legacy 쓰기를 막지 않음.
  //
  // notifMinutes: 전역 약효추적(medNotifs)에서 enabled 분만 추출 → 신규 슬롯 insert 시
  //               track_intervals 기본값으로 사용(없으면 헬퍼가 30/120 폴백).
  const enabledTrackMinutes = useCallback(
    () => medNotifs.filter((n) => n.enabled && n.minutes > 0).map((n) => n.minutes),
    [medNotifs]
  );

  /**
   * 환자 dose_slots 를 주어진 meal_schedules 기준으로 보장(멱등 upsert).
   * - users.med_time_notif_prefs 를 신선하게 읽어 remind_enabled 반영.
   * - 보호자 경로 포함: 항상 targetPatientId(연동 환자) 대상.
   * 실패해도 throw 하지 않음(헬퍼 내부에서 흡수).
   */
  const ensureDoseSlotsForPatient = useCallback(
    async (mealSchedules: MealSchedules) => {
      const pid = targetPatientId;
      if (!pid) return;
      let notifPrefs: Record<string, boolean> | null = null;
      try {
        const { data: userRow } = await supabase
          .from('users')
          .select('med_time_notif_prefs')
          .eq('id', pid)
          .single();
        notifPrefs = (userRow?.med_time_notif_prefs ?? null) as Record<string, boolean> | null;
      } catch (e) {
        console.warn('[MedicationManageScreen] med_time_notif_prefs 조회 실패(계속):', e);
      }
      await ensurePatientDoseSlots(pid, mealSchedules, notifPrefs, enabledTrackMinutes());
    },
    [targetPatientId, enabledTrackMinutes]
  );

  // ── 추가 ────────────────────────────────────────────────────────────────

  const handleAddSubmit = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { await dialog.alert({ message: '약 이름을 입력해주세요.' }); return; }
    if (addTimes.length === 0) { await dialog.alert({ message: '복용 시간대를 하나 이상 선택해주세요.' }); return; }
    if (!user || !targetPatientId) return;

    const finalSchedules: MealSchedules = {};
    addTimes.forEach(slot => {
      finalSchedules[slot] = addSchedules[slot] ?? TIME_SLOTS.find(s => s.key === slot)?.defaultTime ?? '08:00';
    });

    try {
      const { data, error } = await supabase
        .from('medications')
        .insert({
          patient_id: targetPatientId,
          name: trimmed,
          dosage: addDosage.trim() || null,
          meal_times: addTimes,
          meal_schedules: finalSchedules,
          scheduled_times: [] as string[],
          drug_code: null,
          drug_image_url: addDrugInfo?.itemImage ?? null,
          item_seq: addDrugInfo?.itemSeq ?? null,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;

      // users.meal_schedules 업데이트 (약 미등록 시에도 알림 발송 가능하도록)
      try {
        const { data: userData } = await supabase
          .from('users')
          .select('meal_schedules')
          .eq('id', targetPatientId)
          .single();

        const currentMealSchedules = (userData?.meal_schedules ?? {}) as MealSchedules;
        const updatedMealSchedules = { ...currentMealSchedules, ...finalSchedules };

        await supabase
          .from('users')
          .update({ meal_schedules: updatedMealSchedules })
          .eq('id', targetPatientId);
      } catch (userError) {
        console.warn('[MedicationManageScreen] users.meal_schedules 업데이트 실패:', userError);
      }

      // dose_slots dual-write: 환자 슬롯 보장(병합된 meal_schedules 기준) → 약↔슬롯 재배정.
      // ensure 가 syncMedicationDoseSlots 의 선행조건이므로 순서 유지. 실패해도 throw 안 함.
      try {
        const { data: freshUser } = await supabase
          .from('users')
          .select('meal_schedules')
          .eq('id', targetPatientId)
          .single();
        const mergedSchedules = (freshUser?.meal_schedules ?? finalSchedules) as MealSchedules;
        await ensureDoseSlotsForPatient(mergedSchedules);
        await syncMedicationDoseSlots(targetPatientId, data.id, addTimes);
        invalidateDoseSlotsCache(targetPatientId);
      } catch (dsErr) {
        console.warn('[MedicationManageScreen] dose_slots 동기화 실패(계속):', dsErr);
      }

      const newMed: Medication = {
        id: data.id,
        name: data.name,
        dosage: data.dosage ?? null,
        times: (data.meal_times ?? []) as TimeSlot[],
        schedules: (data.meal_schedules ?? {}) as MealSchedules,
        drugInfo: addDrugInfo ?? null,
      };
      setMedications(prev => {
        const next = [...prev, newMed];
        // 스냅샷 저장 (비동기, 실패해도 무시)
        saveMedicationHistory(targetPatientId!, data.id, 'added', next);
        // 약 추가 → 약효 확인 시간 재추천 제안(비강제 §3-C)
        proposeReRecommend(next);
        return next;
      });
      setAddName('');
      setAddDosage('');
      setAddTimes([]);
      setAddSchedules({});
      setAddDrugInfo(undefined);
      setShowAddForm(false);
    } catch (e) {
      console.error('[MedicationManageScreen] 약 추가 오류:', e);
      await dialog.alert({ message: '약 추가에 실패했어요. 다시 시도해주세요.' });
    }
  };

  // ── 수정 ────────────────────────────────────────────────────────────────

  const handleEditStart = (med: Medication) => {
    setEditingId(med.id);
    setEditName(med.name);
    setEditDosage(med.dosage ?? '');
    setEditTimes([...med.times]);
    setEditSchedules({ ...(med.schedules ?? {}) });
    setEditDrugInfo(med.drugInfo);
  };

  const handleEditSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { await dialog.alert({ message: '약 이름을 입력해주세요.' }); return; }
    if (editTimes.length === 0) { await dialog.alert({ message: '복용 시간대를 하나 이상 선택해주세요.' }); return; }
    const savedId = editingId;
    if (!savedId) return;

    const finalSchedules: MealSchedules = {};
    editTimes.forEach(slot => {
      finalSchedules[slot] = editSchedules[slot] ?? TIME_SLOTS.find(s => s.key === slot)?.defaultTime ?? '08:00';
    });

    setMedications(prev => {
      const next = prev.map(m =>
        m.id === savedId
          ? { ...m, name: trimmed, dosage: editDosage.trim() || null, times: editTimes, schedules: finalSchedules, drugInfo: editDrugInfo }
          : m
      );
      // 스냅샷 저장 (비동기, 실패해도 무시)
      if (targetPatientId) {
        saveMedicationHistory(targetPatientId, savedId, 'updated', next);
      }
      // 약 수정(계열/제형/용량 변경 포함) → 재추천 제안(비강제 §3-C)
      proposeReRecommend(next);
      return next;
    });
    setEditingId(null);

    try {
      const { error } = await supabase
        .from('medications')
        .update({
          name: trimmed,
          dosage: editDosage.trim() || null,
          meal_times: editTimes,
          meal_schedules: finalSchedules,
          drug_image_url: editDrugInfo?.itemImage ?? null,
          item_seq: editDrugInfo?.itemSeq ?? null,
        })
        .eq('id', savedId);
      if (error) throw error;

      // users.meal_schedules 업데이트 (약 미등록 시에도 알림 발송 가능하도록)
      if (targetPatientId) {
        try {
          const { data: userData } = await supabase
            .from('users')
            .select('meal_schedules')
            .eq('id', targetPatientId)
            .single();

          const currentMealSchedules = (userData?.meal_schedules ?? {}) as MealSchedules;
          const updatedMealSchedules = { ...currentMealSchedules, ...finalSchedules };

          await supabase
            .from('users')
            .update({ meal_schedules: updatedMealSchedules })
            .eq('id', targetPatientId);
        } catch (userError) {
          console.warn('[MedicationManageScreen] users.meal_schedules 업데이트 실패:', userError);
        }

        // dose_slots dual-write: 슬롯 보장(이미 있을 수 있으나 안전위해 ensure 먼저) → 약↔슬롯 재배정.
        try {
          const { data: freshUser } = await supabase
            .from('users')
            .select('meal_schedules')
            .eq('id', targetPatientId)
            .single();
          const mergedSchedules = (freshUser?.meal_schedules ?? finalSchedules) as MealSchedules;
          await ensureDoseSlotsForPatient(mergedSchedules);
          await syncMedicationDoseSlots(targetPatientId, savedId, editTimes);
          invalidateDoseSlotsCache(targetPatientId);
        } catch (dsErr) {
          console.warn('[MedicationManageScreen] dose_slots 동기화 실패(계속):', dsErr);
        }
      }
    } catch (e) {
      console.error('[MedicationManageScreen] 약 수정 오류:', e);
      await dialog.alert({ message: '약 수정에 실패했어요.' });
      loadMedications();
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditName('');
    setEditDosage('');
    setEditTimes([]);
    setEditSchedules({});
    setEditDrugInfo(undefined);
  };

  // ── 삭제 ────────────────────────────────────────────────────────────────

  const handleDelete = async (med: Medication) => {
    const ok = await dialog.confirm({
      title: '약 삭제',
      message: `${med.name}을(를) 삭제할까요?\n삭제해도 복용 기록은 유지돼요.`,
      confirmText: '삭제',
      cancelText: '취소',
      destructive: true,
    });
    if (!ok) return;
    setMedications(prev => {
      const next = prev.filter(m => m.id !== med.id);
      // 스냅샷 저장 (비동기, 실패해도 무시) - 삭제된 약도 포함한 최종 목록
      if (targetPatientId) {
        saveMedicationHistory(targetPatientId, med.id, 'deleted', next);
      }
      // 약 삭제 → 재추천 제안(레보도파 전삭제 시 강제변경 없이 안심 안내 §13-6)
      proposeReRecommend(next);
      return next;
    });
    try {
      const { error } = await supabase
        .from('medications')
        .update({ is_active: false })
        .eq('id', med.id);
      if (error) throw error;

      // dose_slots dual-write: 환자 시간표(dose_slots)는 유지하고, 이 약의 약↔슬롯
      // 매핑(medication_dose_slots)만 비운다(빈 배열 → 기존 매핑 delete). 실패해도 throw 안 함.
      if (targetPatientId) {
        try {
          await syncMedicationDoseSlots(targetPatientId, med.id, []);
          invalidateDoseSlotsCache(targetPatientId);
        } catch (dsErr) {
          console.warn('[MedicationManageScreen] dose_slots 매핑 정리 실패(계속):', dsErr);
        }
      }
    } catch (e) {
      console.error('[MedicationManageScreen] 약 삭제 오류:', e);
      await dialog.alert({ message: '삭제에 실패했어요.' });
      loadMedications();
    }
  };

  // ── 시간대 수정 저장 ────────────────────────────────────────────────────

  const handleSlotEditSave = async (updatedMeds: Medication[], newTime: string) => {
    // 낙관적 UI 업데이트
    setMedications(updatedMeds);

    // DB 업데이트 (변경된 약만)
    const changes = updatedMeds.filter((updated, idx) => {
      const original = medications[idx];
      if (!original) return false;
      const timesChanged = JSON.stringify(updated.times.sort()) !== JSON.stringify(original.times.sort());
      const schedulesChanged = JSON.stringify(updated.schedules) !== JSON.stringify(original.schedules);
      return timesChanged || schedulesChanged;
    });

    await Promise.all(
      changes.map(med =>
        supabase.from('medications').update({
          meal_times: med.times,
          meal_schedules: med.schedules ?? {},
        }).eq('id', med.id)
      )
    );

    // dose_slots dual-write: 이 화면은 users.meal_schedules 를 직접 쓰지 않으므로,
    // 변경된 약들의 슬롯 시각을 모아 환자 dose_slot.time 을 동기화한다(홈/알림 시각 불일치 방지).
    // newTime 은 이번에 편집된 슬롯의 새 시각. 이후 약↔슬롯 매핑도 변경 약만 재배정.
    if (targetPatientId && changes.length > 0) {
      try {
        // 변경된 약들의 슬롯별 시각을 병합(legacy key → 'HH:MM'). 동일 슬롯은 마지막 값 사용.
        const mergedSchedules: MealSchedules = {};
        updatedMeds.forEach((med) => {
          const sched = med.schedules ?? {};
          (Object.keys(sched) as TimeSlot[]).forEach((k) => {
            if (sched[k]) mergedSchedules[k] = sched[k];
          });
        });
        await ensureDoseSlotsForPatient(mergedSchedules);
        await Promise.all(
          changes.map((med) => syncMedicationDoseSlots(targetPatientId, med.id, med.times))
        );
        invalidateDoseSlotsCache(targetPatientId);
      } catch (dsErr) {
        console.warn('[MedicationManageScreen] dose_slots 동기화 실패(계속):', dsErr);
      }
    }
  };

  const toggleAddTime = (t: TimeSlot) => {
    setAddTimes(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      const defaultTime = TIME_SLOTS.find(s => s.key === t)?.defaultTime ?? '08:00';
      setAddSchedules(sched => ({ ...sched, [t]: sched[t] ?? defaultTime }));
      return [...prev, t];
    });
  };

  const toggleEditTime = (t: TimeSlot) => {
    setEditTimes(prev => {
      if (prev.includes(t)) return prev.filter(x => x !== t);
      const defaultTime = TIME_SLOTS.find(s => s.key === t)?.defaultTime ?? '08:00';
      setEditSchedules(sched => ({ ...sched, [t]: sched[t] ?? defaultTime }));
      return [...prev, t];
    });
  };

  // ── 섹션 생성 ────────────────────────────────────────────────────────────

  const activeSections = TIME_SLOTS.filter(slot =>
    medications.some(m => medDisplaySlotKeys(m).includes(slot.key))
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <TopBar
          title="약 관리"
          showBack
          showBell
          bellBadge={unreadCount}
          onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
        />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="약 관리"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {/* ── 처방전으로 등록하기 ── */}
          <TouchableOpacity
            style={styles.prescriptionBtn}
            onPress={handleOcrPress}
            activeOpacity={0.8}
          >
            <View style={styles.prescriptionIconCircle}>
              <Ionicons name="document-text-outline" size={32} color={Colors.primary} />
            </View>
            <View style={styles.prescriptionTextGroup}>
              <Text style={styles.prescriptionTitle}>처방전으로 등록하기</Text>
              <Text style={styles.prescriptionSub}>사진 한 장으로 자동 입력돼요</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color={Colors.primary} />
          </TouchableOpacity>

          {/* ── 섹션형 약 리스트 ── */}
          {!showEditList && (medications.length === 0 ? (
            <View style={styles.emptyCard}>
              <Ionicons name="medkit-outline" size={56} color={Colors.textHint} />
              <Text style={styles.emptyTitle}>등록된 약이 없어요</Text>
              <Text style={styles.emptyDesc}>{'처방전 등록 또는 아래 버튼으로\n약을 추가해보세요'}</Text>
            </View>
          ) : (
            <View style={styles.sectionListContainer}>
              {activeSections.map(slot => {
                const slotMeds = medications.filter(m => medDisplaySlotKeys(m).includes(slot.key));
                const slotTime = slotMeds[0] ? medDisplaySlotTime(slotMeds[0], slot.key) : slot.defaultTime;

                return (
                  <View key={slot.key} style={styles.sectionCard}>
                    {/* 섹션 헤더 */}
                    <View style={[styles.sectionHeader, { backgroundColor: slot.bgColor }]}>
                      <View style={styles.sectionHeaderLeft}>
                        <Text style={styles.sectionHeaderEmoji}>{slot.emoji}</Text>
                        <Text style={styles.sectionHeaderLabel}>{slotTitle(slot.label, slot.key, slotTime)}</Text>
                      </View>
                      <TouchableOpacity
                        style={styles.slotEditBtn}
                        onPress={() => setSlotEditTarget(slot)}
                        activeOpacity={0.8}
                      >
                        <Text style={styles.slotEditBtnText}>수정</Text>
                      </TouchableOpacity>
                    </View>

                    {/* 약 아이템 */}
                    {slotMeds.map((med, idx) => (
                      <TouchableOpacity
                        key={med.id}
                        style={[
                          styles.medItem,
                          idx < slotMeds.length - 1 && styles.medItemBorder,
                        ]}
                        onPress={() => setSelectedDrug(med)}
                        activeOpacity={0.75}
                      >
                        {med.drugInfo?.itemImage ? (
                          <Image source={{ uri: med.drugInfo.itemImage }} style={styles.medItemImg} resizeMode="contain" />
                        ) : (
                          <View style={styles.medItemImg} />
                        )}
                        <View style={styles.medItemTextGroup}>
                          <Text style={styles.medItemName}>
                            {med.name}{med.dosage ? `  ${med.dosage}` : ''}
                          </Text>
                        </View>
                        {med.drugInfo === null && (
                          <Text style={styles.noInfoBadge}>!</Text>
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                );
              })}
            </View>
          ))}

          {/* ── 약효 확인 시간 맞춰보기 (§7.2-bis 비강제 진입점) ── */}
          {!showEditList && !showAddForm && medications.length > 0 && (
            <View style={styles.effectCard}>
              <View style={styles.effectCardHeader}>
                <Ionicons name="time-outline" size={26} color={Colors.primary} />
                <Text style={styles.effectCardTitle}>약효 확인 시간</Text>
              </View>
              <Text style={styles.effectCardDesc}>
                등록하신 약에 맞춰 컨디션 확인 시간을 맞춰드릴 수 있어요.{'\n'}
                바꿀지는 직접 정하시면 돼요.
              </Text>
              <Text style={styles.effectCardNote}>
                ⓘ 확정 처방은 아니에요. 주치의와 상의해 조정하세요.
              </Text>
              <TouchableOpacity
                style={styles.effectPrimaryBtn}
                onPress={() => proposeReRecommend(medications, { manual: true })}
                activeOpacity={0.85}
              >
                <Ionicons name="time-outline" size={22} color={Colors.white} />
                <Text style={styles.effectPrimaryBtnText}>약효 확인 시간 맞춰보기</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.effectMfdsBtn}
                onPress={() => openMfdsDetail(findLevodopaSeq(medications))}
                activeOpacity={0.85}
              >
                <Ionicons name="document-text-outline" size={22} color={Colors.primary} />
                <Text style={styles.effectMfdsBtnText}>식약처 약 정보 직접 보기</Text>
              </TouchableOpacity>
            </View>
          )}

          {/* ── 버튼 2개: 약 직접 등록 / 약 전체 수정 ── */}
          <View style={styles.dualBtnRow}>
            <TouchableOpacity
              style={styles.addRegisterBtn}
              onPress={() => {
                setShowAddForm(v => !v);
                setShowEditList(false);
                setEditingId(null);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.addRegisterBtnText}>
                {showAddForm ? '직접 등록 닫기' : '약 직접 등록'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.allEditBtn}
              onPress={() => {
                setShowEditList(v => !v);
                setShowAddForm(false);
                setEditingId(null);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.allEditBtnText}>
                {showEditList ? '전체 수정 닫기' : '약 전체 수정'}
              </Text>
            </TouchableOpacity>
          </View>

          {/* ── 약 직접 등록 폼 ── */}
          {showAddForm && (
            <View style={styles.allEditArea}>
              <Text style={styles.allEditSectionTitle}>약 직접 등록</Text>
              <View style={styles.addFormCard}>
                <TextInput
                  style={styles.medInput}
                  value={addName}
                  onChangeText={(v) => { setAddName(v); setAddDrugInfo(undefined); }}
                  placeholder="약 이름 입력 (예: 마도파)"
                  placeholderTextColor={Colors.textHint}
                  returnKeyType="done"
                />

                <TouchableOpacity
                  style={styles.mfdsBtn}
                  onPress={handleFetchMfdsForAdd}
                  activeOpacity={0.85}
                  disabled={isMfdsLoading}
                >
                  {isMfdsLoading ? (
                    <ActivityIndicator size="small" color={Colors.white} />
                  ) : (
                    <Text style={styles.mfdsBtnText}>식약처 정보 불러오기</Text>
                  )}
                </TouchableOpacity>

                {addDrugInfo !== undefined && (
                  <View style={[styles.mfdsResult, addDrugInfo ? styles.mfdsResultOk : styles.mfdsResultFail]}>
                    <Text style={[styles.mfdsResultText, addDrugInfo ? styles.mfdsResultTextOk : styles.mfdsResultTextFail]}>
                      {addDrugInfo
                        ? `확인됨${addDrugInfo.entpName ? ` (${addDrugInfo.entpName})` : ''}`
                        : '식약처 정보 없음'}
                    </Text>
                  </View>
                )}

                <TextInput
                  style={styles.medInput}
                  value={addDosage}
                  onChangeText={setAddDosage}
                  placeholder="복용량 (예) 1정, 0.5정, 500mg)"
                  placeholderTextColor={Colors.textHint}
                  returnKeyType="done"
                />

                <Text style={styles.inputLabel}>복용 시간대</Text>
                <TimeSlotsWithTime
                  selectedTimes={addTimes}
                  schedules={addSchedules}
                  onToggle={toggleAddTime}
                  onTimeChange={(slot, time) => setAddSchedules(prev => ({ ...prev, [slot]: time }))}
                />

                <TouchableOpacity
                  style={[styles.addSubmitBtn, (!addName.trim() || addTimes.length === 0) && styles.addSubmitBtnDisabled]}
                  onPress={handleAddSubmit}
                  activeOpacity={0.85}
                  disabled={!addName.trim() || addTimes.length === 0}
                >
                  <Text style={(!addName.trim() || addTimes.length === 0) ? styles.addSubmitBtnTextDisabled : styles.addSubmitBtnText}>+ 추가하기</Text>
                </TouchableOpacity>
              </View>

            </View>
          )}

          {/* ── 약 전체 수정 영역 (약 목록 수정/삭제) ── */}
          {showEditList && (
            <View style={styles.allEditArea}>
              <Text style={styles.allEditSectionTitle}>등록된 약 수정 / 삭제</Text>
              {medications.length === 0 && (
                <Text style={styles.emptyDesc}>등록된 약이 없어요</Text>
              )}
              {medications.map(med => {
                const isEditing = editingId === med.id;

                if (isEditing) {
                  return (
                    <View key={med.id} style={styles.medCardEditing}>
                      <TextInput
                        style={styles.medInput}
                        value={editName}
                        onChangeText={(v) => { setEditName(v); setEditDrugInfo(undefined); }}
                        placeholder="약 이름"
                        placeholderTextColor={Colors.textHint}
                        returnKeyType="done"
                        autoFocus
                      />

                      <TouchableOpacity
                        style={styles.mfdsBtn}
                        onPress={handleFetchMfdsForEdit}
                        activeOpacity={0.85}
                        disabled={isEditMfdsLoading}
                      >
                        {isEditMfdsLoading ? (
                          <ActivityIndicator size="small" color={Colors.white} />
                        ) : (
                          <Text style={styles.mfdsBtnText}>식약처 정보 불러오기</Text>
                        )}
                      </TouchableOpacity>

                      {editDrugInfo !== undefined && (
                        <View style={[styles.mfdsResult, editDrugInfo ? styles.mfdsResultOk : styles.mfdsResultFail]}>
                          <Text style={[styles.mfdsResultText, editDrugInfo ? styles.mfdsResultTextOk : styles.mfdsResultTextFail]}>
                            {editDrugInfo
                              ? `확인됨${editDrugInfo.entpName ? ` (${editDrugInfo.entpName})` : ''}`
                              : '식약처 정보 없음'}
                          </Text>
                        </View>
                      )}

                      <TextInput
                        style={styles.medInput}
                        value={editDosage}
                        onChangeText={setEditDosage}
                        placeholder="복용량 (예) 1정, 0.5정, 500mg)"
                        placeholderTextColor={Colors.textHint}
                        returnKeyType="done"
                      />

                      <Text style={styles.inputLabel}>복용 시간대</Text>
                      <TimeSlotsWithTime
                        selectedTimes={editTimes}
                        schedules={editSchedules}
                        onToggle={toggleEditTime}
                        onTimeChange={(slot, time) => setEditSchedules(prev => ({ ...prev, [slot]: time }))}
                      />

                      <View style={styles.editActionRow}>
                        <TouchableOpacity style={styles.editCancelBtn} onPress={handleEditCancel} activeOpacity={0.85}>
                          <Text style={styles.editCancelBtnText}>취소</Text>
                        </TouchableOpacity>
                        <TouchableOpacity style={styles.editSaveBtn} onPress={handleEditSave} activeOpacity={0.85}>
                          <Text style={styles.editSaveBtnText}>저장</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                }

                return (
                  <View key={med.id} style={styles.medCard}>
                    {/* 약 이름 + 복용량 */}
                    <TouchableOpacity onPress={() => setSelectedDrug(med)} activeOpacity={0.7}>
                      <Text style={styles.medName}>
                        {med.name}{med.dosage ? `  ${med.dosage}` : ''}
                      </Text>
                    </TouchableOpacity>

                    {/* 복용 시간대 세로 배치 (dose_slots 조인 우선, 없으면 legacy) */}
                    {medDisplaySlotKeys(med).length > 0 && (
                      <View style={styles.medSlotList}>
                        {medDisplaySlotKeys(med).map(t => {
                          const slot = TIME_SLOTS.find(s => s.key === t);
                          if (!slot) return null;
                          const time = medDisplaySlotTime(med, t);
                          return (
                            <Text key={t} style={styles.medSlotRow}>
                              {slotTitle(slot.label, slot.key, time)}
                            </Text>
                          );
                        })}
                      </View>
                    )}

                    {med.drugInfo === null && (
                      <Text style={styles.noInfoBadge}>식약처 정보 없음 · 이름 확인 필요</Text>
                    )}

                    {/* 수정/삭제 버튼 — 카드 하단 우측 */}
                    <View style={styles.medCardBtnRow}>
                      <TouchableOpacity style={styles.medEditBtn} onPress={() => handleEditStart(med)} activeOpacity={0.7}>
                        <Text style={styles.medEditBtnText}>수정</Text>
                      </TouchableOpacity>
                      <TouchableOpacity style={styles.medDeleteBtn} onPress={() => handleDelete(med)} activeOpacity={0.7}>
                        <Text style={styles.medDeleteBtnText}>삭제</Text>
                      </TouchableOpacity>
                    </View>
                  </View>
                );
              })}
            </View>
          )}

          {/* ── 약관리 과거 기록 보기 ── */}
          <MedicationHistoryTimeline patientId={targetPatientId} />

          <View style={{ height: 80 }} />
        </ScrollView>
      </KeyboardAvoidingView>

      {/* OCR 로딩 오버레이 */}
      {isOcrLoading && (
        <View style={styles.ocrOverlay}>
          <View style={styles.ocrCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.ocrText}>처방전 분석 중...</Text>
            <Text style={styles.ocrSubText}>잠시만 기다려주세요</Text>
          </View>
        </View>
      )}

      {/* 약 상세 모달 */}
      <DrugInfoModal drug={selectedDrug} onClose={() => setSelectedDrug(null)} />

      {/* 시간대 수정 바텀시트 */}
      <SlotEditBottomSheet
        visible={slotEditTarget !== null}
        slot={slotEditTarget}
        medications={medications}
        onClose={() => setSlotEditTarget(null)}
        onSave={handleSlotEditSave}
      />

      {/* OCR 결과 확인 바텀시트 */}
      <Modal
        visible={ocrResultVisible}
        transparent
        animationType="slide"
        onRequestClose={() => setOcrResultVisible(false)}
      >
        <View style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.45)' }}>
          <View style={{
            backgroundColor: '#fff',
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            paddingHorizontal: 20,
            paddingTop: 20,
            paddingBottom: 32,
            maxHeight: '80%',
          }}>
            <Text style={{ fontSize: 18, fontWeight: '700', color: '#222', marginBottom: 4 }}>
              처방전 인식 결과
            </Text>
            <Text style={{ fontSize: 14, color: '#888', marginBottom: 16 }}>
              추가할 약을 선택해주세요
            </Text>
            <ScrollView>
              {ocrEnrichedMeds.map((med, idx) => (
                <TouchableOpacity
                  key={med.id}
                  onPress={() => setOcrEnrichedMeds(prev =>
                    prev.map((m, i) => i === idx ? { ...m, checked: !m.checked } : m)
                  )}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    paddingVertical: 12,
                    borderBottomWidth: 1,
                    borderBottomColor: '#f0f0f0',
                  }}
                >
                  {/* 체크박스 */}
                  <View style={{
                    width: 24, height: 24, borderRadius: 6,
                    borderWidth: 2,
                    borderColor: med.checked ? '#FF6B35' : '#ccc',
                    backgroundColor: med.checked ? '#FF6B35' : '#fff',
                    alignItems: 'center', justifyContent: 'center',
                    marginRight: 12,
                  }}>
                    {med.checked && <Ionicons name="checkmark" size={14} color="#fff" />}
                  </View>

                  {/* 약 이미지 */}
                  {med.drugInfo?.itemImage ? (
                    <Image
                      source={{ uri: med.drugInfo.itemImage }}
                      style={{ width: 48, height: 28, borderRadius: 4, marginRight: 12, backgroundColor: '#f5f5f5' }}
                      resizeMode="contain"
                    />
                  ) : (
                    <View style={{
                      width: 48, height: 28, borderRadius: 4, marginRight: 12,
                      backgroundColor: '#f5f5f5', alignItems: 'center', justifyContent: 'center'
                    }}>
                      <Text style={{ fontSize: 18 }}>💊</Text>
                    </View>
                  )}

                  {/* 약 이름 + 뱃지 */}
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 16, fontWeight: '600', color: '#222' }}>{med.name}</Text>
                    <View style={{ flexDirection: 'row', marginTop: 4 }}>
                      {med.drugInfo ? (
                        <View style={{
                          paddingHorizontal: 8, paddingVertical: 2,
                          backgroundColor: '#E8F5E9', borderRadius: 10,
                        }}>
                          <Text style={{ fontSize: 12, color: '#2E7D32', fontWeight: '600' }}>✅ 확인됨</Text>
                        </View>
                      ) : (
                        <View style={{
                          paddingHorizontal: 8, paddingVertical: 2,
                          backgroundColor: '#FFF3E0', borderRadius: 10,
                        }}>
                          <Text style={{ fontSize: 12, color: '#E65100', fontWeight: '600' }}>⚠️ 이름만 인식</Text>
                        </View>
                      )}
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <TouchableOpacity
              onPress={handleOcrConfirm}
              style={{
                marginTop: 20,
                backgroundColor: '#FF6B35',
                borderRadius: 12,
                paddingVertical: 16,
                alignItems: 'center',
              }}
            >
              <Text style={{ color: '#fff', fontSize: 17, fontWeight: '700' }}>
                선택한 약 추가하기 ({ocrEnrichedMeds.filter(m => m.checked).length}개)
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

// ─── 약관리 과거 기록 보기 타임라인 ──────────────────────────────────────────────

const MED_SLOT_ORDER: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
const MED_SLOT_LABELS: Record<TimeSlot, string> = {
  morning: '아침약',
  lunch: '점심약',
  dinner: '저녁약',
  bedtime: '취침약',
};

const CHANGE_TYPE_LABEL: Record<string, string> = {
  added: '추가',
  updated: '변경',
  deleted: '삭제',
};

const CHANGE_TYPE_COLOR: Record<string, string> = {
  added: '#1565C0',
  updated: '#E65100',
  deleted: '#B71C1C',
};

const CHANGE_TYPE_BG: Record<string, string> = {
  added: '#E3F2FD',
  updated: '#FFF3E0',
  deleted: '#FFEBEE',
};

function medHistoryDateTimeLabel(isoString: string): string {
  const d = new Date(isoString);
  const kst = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  const m = kst.getMonth() + 1;
  const day = kst.getDate();
  const h = kst.getHours();
  const min = kst.getMinutes();
  const dayNames = ['일', '월', '화', '수', '목', '금', '토'];
  return `${m}.${day}(${dayNames[kst.getDay()]}) ${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

const MH_PAGE_SIZE = 20;

interface HistoryRow {
  id: string;
  changed_at: string;
  changed_medication_id: string | null;
  change_type: string;
  snapshot: MedSnapshot[];
}

function MedicationHistoryTimeline({ patientId }: { patientId: string | null }) {
  const [expanded, setExpanded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [initialLoaded, setInitialLoaded] = useState(false);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [displayCount, setDisplayCount] = useState(MH_PAGE_SIZE);

  const fetchHistory = useCallback(async () => {
    if (!patientId) return;
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('medication_history')
        .select('id, changed_at, changed_medication_id, change_type, snapshot')
        .eq('patient_id', patientId)
        .order('changed_at', { ascending: false })
        .limit(200);

      if (error) throw error;
      setRows((data ?? []) as HistoryRow[]);
    } catch (err) {
      console.error('[MedicationHistoryTimeline] 오류:', err);
    } finally {
      setLoading(false);
    }
  }, [patientId]);

  const handleExpand = useCallback(async () => {
    setExpanded(true);
    if (initialLoaded) return;
    await fetchHistory();
    setInitialLoaded(true);
  }, [initialLoaded, fetchHistory]);

  const visibleRows = rows.slice(0, displayCount);
  const hasMore = rows.length > displayCount;

  if (!expanded) {
    return (
      <View style={mhStyles.toggleWrap}>
        <TouchableOpacity style={mhStyles.toggleButton} onPress={handleExpand} activeOpacity={0.8}>
          <Text style={mhStyles.toggleButtonText}>과거 기록 보기</Text>
          <Text style={mhStyles.toggleArrow}>▼</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={mhStyles.container}>
      <TouchableOpacity style={mhStyles.toggleButton} onPress={() => setExpanded(false)} activeOpacity={0.8}>
        <Text style={mhStyles.toggleButtonText}>과거 기록 접기</Text>
        <Text style={mhStyles.toggleArrow}>▲</Text>
      </TouchableOpacity>

      {loading ? (
        <View style={mhStyles.loadingWrap}>
          <ActivityIndicator size="large" color={Colors.primary} />
          <Text style={mhStyles.loadingText}>기록을 불러오는 중...</Text>
        </View>
      ) : rows.length === 0 ? (
        <View style={mhStyles.emptyWrap}>
          <Text style={mhStyles.emptyText}>아직 기록이 없어요</Text>
          <Text style={mhStyles.emptySubText}>약을 추가·수정·삭제하면 여기에 기록돼요</Text>
        </View>
      ) : (
        <View style={mhStyles.timeline}>
          {visibleRows.map((row, idx) => {
            const isLast = idx === visibleRows.length - 1;
            const changeLabel = CHANGE_TYPE_LABEL[row.change_type] ?? row.change_type;
            const changeColor = CHANGE_TYPE_COLOR[row.change_type] ?? '#555';
            const changeBg = CHANGE_TYPE_BG[row.change_type] ?? '#F5F5F5';

            // snapshot에서 약 목록 그룹핑 (시간대별)
            const slotMap: Partial<Record<TimeSlot, MedSnapshot[]>> = {};
            (row.snapshot ?? []).forEach(med => {
              (med.meal_times ?? []).forEach(slot => {
                if (!slotMap[slot]) slotMap[slot] = [];
                slotMap[slot]!.push(med);
              });
            });

            return (
              <View key={row.id} style={mhStyles.dayRow}>
                {/* 가운데: 세로줄 + 원 */}
                <View style={mhStyles.lineCol}>
                  <View style={[mhStyles.lineTop, idx === 0 && mhStyles.lineInvisible]} />
                  <View style={mhStyles.dotFilled} />
                  <View style={[mhStyles.lineBottom, isLast && mhStyles.lineInvisible]} />
                </View>

                {/* 오른쪽: 날짜 + 변경 약 목록 */}
                <View style={mhStyles.contentCol}>
                  {/* 날짜·시간 + 변경 유형 뱃지 */}
                  <View style={mhStyles.headerRow}>
                    <Text style={mhStyles.dateLabel}>{medHistoryDateTimeLabel(row.changed_at)}</Text>
                    <View style={[mhStyles.changeBadge, { backgroundColor: changeBg }]}>
                      <Text style={[mhStyles.changeBadgeText, { color: changeColor }]}>{changeLabel}</Text>
                    </View>
                  </View>

                  {/* 시간대별 약 목록 */}
                  {MED_SLOT_ORDER.map(slot => {
                    const meds = slotMap[slot];
                    if (!meds || meds.length === 0) return null;
                    return (
                      <View key={slot} style={mhStyles.slotGroup}>
                        <Text style={mhStyles.slotLabel}>{MED_SLOT_LABELS[slot]}</Text>
                        {meds.map(med => {
                          const isChanged = med.id === row.changed_medication_id;
                          return (
                            <View key={med.id} style={mhStyles.medRow}>
                              {isChanged && (
                                <View style={[mhStyles.changeBadgeSmall, { backgroundColor: changeBg }]}>
                                  <Text style={[mhStyles.changeBadgeSmallText, { color: changeColor }]}>{changeLabel}</Text>
                                </View>
                              )}
                              <Text style={[
                                mhStyles.medName,
                                isChanged && mhStyles.medNameHighlight,
                              ]}>
                                {med.name}{med.dosage ? `  ${med.dosage}` : ''}
                              </Text>
                            </View>
                          );
                        })}
                      </View>
                    );
                  })}

                  {/* 삭제된 경우 삭제된 약도 별도 표시 */}
                  {row.change_type === 'deleted' && row.changed_medication_id && (
                    (() => {
                      // snapshot에 없는 경우(삭제 후 목록) → 삭제된 약 표시
                      const inSnapshot = (row.snapshot ?? []).some(m => m.id === row.changed_medication_id);
                      if (inSnapshot) return null;
                      return (
                        <View style={mhStyles.deletedMedRow}>
                          <View style={[mhStyles.changeBadgeSmall, { backgroundColor: CHANGE_TYPE_BG['deleted'] }]}>
                            <Text style={[mhStyles.changeBadgeSmallText, { color: CHANGE_TYPE_COLOR['deleted'] }]}>삭제</Text>
                          </View>
                          <Text style={[mhStyles.medName, { color: CHANGE_TYPE_COLOR['deleted'] }]}>이 약이 삭제되었어요</Text>
                        </View>
                      );
                    })()
                  )}

                  {row.snapshot?.length === 0 && (
                    <Text style={mhStyles.emptyDay}>등록된 약 없음</Text>
                  )}
                </View>
              </View>
            );
          })}

          {hasMore && (
            <TouchableOpacity
              style={mhStyles.moreButton}
              onPress={() => setDisplayCount(c => c + MH_PAGE_SIZE)}
              activeOpacity={0.8}
            >
              <Text style={mhStyles.moreButtonText}>더보기</Text>
            </TouchableOpacity>
          )}
        </View>
      )}
    </View>
  );
}

const MH_LINE_TOP_H = 12;
const MH_FIRST_ROW_PT = 10;

const mhStyles = StyleSheet.create({
  toggleWrap: { paddingBottom: 32 },
  toggleButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 8,
    marginBottom: 8,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  toggleButtonText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  toggleArrow: { fontSize: 14, color: Colors.textHint },

  container: { paddingBottom: 40 },

  loadingWrap: { alignItems: 'center', paddingVertical: 32, gap: 12 },
  loadingText: { fontSize: 17, color: Colors.textSub },

  emptyWrap: { alignItems: 'center', paddingVertical: 32, gap: 8 },
  emptyText: { fontSize: 18, color: Colors.textHint },
  emptySubText: { fontSize: 15, color: Colors.textHint, textAlign: 'center' },

  timeline: { paddingTop: 8 },

  dayRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    minHeight: 48,
    marginBottom: 4,
  },

  lineCol: {
    width: 24,
    alignItems: 'center',
    flexDirection: 'column',
    marginTop: MH_FIRST_ROW_PT,
  },
  lineTop: {
    width: 2,
    height: MH_LINE_TOP_H,
    backgroundColor: '#E0E0E0',
  },
  lineBottom: {
    width: 2,
    flex: 1,
    minHeight: 20,
    backgroundColor: '#E0E0E0',
  },
  lineInvisible: { backgroundColor: 'transparent' },
  dotFilled: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
  },

  contentCol: {
    flex: 1,
    paddingLeft: 12,
    paddingTop: MH_FIRST_ROW_PT,
    paddingBottom: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
    marginBottom: 4,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
    flexWrap: 'wrap',
  },
  dateLabel: {
    fontSize: 14,
    color: '#888888',
    fontWeight: '500',
  },
  changeBadge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 20,
  },
  changeBadgeText: {
    fontSize: 13,
    fontWeight: '700',
  },

  slotGroup: {
    marginBottom: 8,
  },
  slotLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 4,
  },
  medRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },
  medName: {
    fontSize: 16,
    color: Colors.text,
    flexShrink: 1,
  },
  medNameHighlight: {
    fontWeight: '700',
    color: Colors.text,
  },
  changeBadgeSmall: {
    paddingHorizontal: 7,
    paddingVertical: 2,
    borderRadius: 10,
  },
  changeBadgeSmallText: {
    fontSize: 12,
    fontWeight: '700',
  },
  deletedMedRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 3,
  },

  emptyDay: {
    fontSize: 15,
    color: '#CCCCCC',
    lineHeight: 22,
  },

  moreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    marginTop: 8,
    marginBottom: 8,
    backgroundColor: Colors.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: Colors.border,
    elevation: 1,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 3,
  },
  moreButtonText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
});

// ─── 스타일 ───────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.white },
  scroll: { flex: 1, backgroundColor: Colors.background },
  scrollContent: { padding: 20, paddingBottom: 60 },

  // 처방전 버튼
  prescriptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    borderWidth: 2,
    borderColor: Colors.primary,
    paddingHorizontal: 20,
    paddingVertical: 20,
    marginBottom: 16,
  },
  prescriptionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prescriptionIconEmoji: { fontSize: 28 },
  prescriptionTextGroup: { flex: 1, marginHorizontal: 16 },
  prescriptionTitle: { fontSize: 20, fontWeight: '700', color: Colors.primary },
  prescriptionSub: { fontSize: 15, color: Colors.textSub, marginTop: 4 },

  // 섹션형 약 리스트
  sectionListContainer: { marginBottom: 16 },
  sectionCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 14,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeaderEmoji: { fontSize: 24 },
  sectionHeaderLabel: { fontSize: 20, fontWeight: '700', color: Colors.text },
  sectionHeaderTime: { fontSize: 18, fontWeight: '600', color: Colors.textSub, marginLeft: 4 },
  slotEditBtn: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 10,
    backgroundColor: 'rgba(0,0,0,0.06)',
    minHeight: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  slotEditBtnText: { fontSize: 16, fontWeight: '700', color: Colors.text },
  medItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: Colors.white,
  },
  medItemBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  medItemImg: { width: 40, height: 40, borderRadius: 6, backgroundColor: '#F5F5F5' },
  medItemEmoji: { fontSize: 28, width: 40, textAlign: 'center' },
  medItemTextGroup: { flex: 1 },
  medItemName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  medItemDosage: { fontSize: 18, color: Colors.textSub, marginTop: 2 },

  // 약효 확인 시간 진입 카드 (§7.2-bis)
  effectCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    paddingHorizontal: 18,
    paddingVertical: 18,
    marginBottom: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  effectCardHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 8 },
  effectCardTitle: { fontSize: 20, fontWeight: '700', color: Colors.text },
  effectCardDesc: { fontSize: 18, lineHeight: 26, color: Colors.text },
  effectCardNote: { fontSize: 15, lineHeight: 22, color: Colors.textSub, marginTop: 10, marginBottom: 14 },
  effectPrimaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    paddingHorizontal: 16,
  },
  effectPrimaryBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  effectMfdsBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 56,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    paddingHorizontal: 16,
    marginTop: 10,
  },
  effectMfdsBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  // 버튼 2개 행
  dualBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 40,
  },
  // 약 직접 등록 버튼 (outline)
  addRegisterBtn: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addRegisterBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  // 약 전체 수정 버튼 (filled)
  allEditBtn: {
    flex: 1,
    height: 56,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  allEditBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // 전체 수정 영역
  allEditArea: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
  },
  allEditSectionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
    marginTop: 8,
  },

  // 직접 추가 폼
  addFormCard: {
    backgroundColor: '#F8F8F8',
    borderRadius: 12,
    padding: 16,
    marginBottom: 20,
  },
  medInput: {
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    color: Colors.text,
    marginBottom: 12,
    backgroundColor: Colors.white,
  },

  // 식약처 버튼 및 결과
  mfdsBtn: {
    height: 52,
    borderRadius: 12,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  mfdsBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  mfdsResult: {
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    marginBottom: 12,
  },
  mfdsResultOk: { backgroundColor: '#E8F5E9' },
  mfdsResultFail: { backgroundColor: '#FFF3E0' },
  mfdsResultText: { fontSize: 16, fontWeight: '600' },
  mfdsResultTextOk: { color: '#2E7D32' },
  mfdsResultTextFail: { color: '#E65100' },

  inputLabel: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  addSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  addSubmitBtnDisabled: { backgroundColor: Colors.border },
  addSubmitBtnText: { fontSize: 20, fontWeight: '700', color: Colors.white },
  addSubmitBtnTextDisabled: { fontSize: 20, fontWeight: '700', color: '#666666' },

  // 빈 상태
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
    marginBottom: 16,
  },
  emptyTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  emptyDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },

  // 약 카드 (전체 수정 영역 내)
  medCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: Colors.border,
    padding: 16,
    marginBottom: 10,
    minHeight: 130,
  },
  medCardEditing: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    padding: 16,
    marginBottom: 10,
  },
  medTopRow: { flexDirection: 'row', alignItems: 'flex-start' },
  medThumbnail: { width: 56, height: 56, borderRadius: 8, backgroundColor: '#F5F5F5' },
  medIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medIconEmoji: { fontSize: 24 },
  medInfoGroup: { flex: 1, marginLeft: 14 },
  medNameRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  medNameTouchable: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', flex: 1 },
  medName: { fontSize: 20, fontWeight: '700', color: Colors.text },
  medInfoIndicator: { fontSize: 18 },
  medIconBtns: { flexDirection: 'row', gap: 4, marginLeft: 4 },
  medEditBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#F0F0F0',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medEditBtnText: { fontSize: 16, fontWeight: '700', color: '#555' },
  medDeleteBtn: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFF0F0',
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medDeleteBtnText: { fontSize: 16, fontWeight: '700', color: '#F44336' },
  medScheduleSmall: { fontSize: 16, color: Colors.textSub, marginTop: 6 },
  medSlotList: { marginTop: 10, marginBottom: 4, gap: 4 },
  medSlotRow: { fontSize: 18, color: Colors.textSub, lineHeight: 28 },
  medCardBtnRow: { flexDirection: 'row', justifyContent: 'flex-end', gap: 8, marginTop: 12 },
  noInfoBadge: { fontSize: 16, color: Colors.danger, marginTop: 4 },

  // 인라인 수정 액션
  editActionRow: { flexDirection: 'row', gap: 10, marginTop: 8 },
  editCancelBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editCancelBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  editSaveBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editSaveBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },

  // OCR 오버레이
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  ocrCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 32,
    alignItems: 'center',
    gap: 16,
    minWidth: 200,
  },
  ocrText: { fontSize: 20, fontWeight: '700', color: Colors.text },
  ocrSubText: { fontSize: 18, color: Colors.textSub },
});
