import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  PanResponder,
  Animated,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFamilyLink } from '../../hooks/useFamilyLink';

// ─── 타입 ────────────────────────────────────────────────────────────────────

type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'bedtime';

const TIME_SLOTS: { key: TimeSlot; label: string; defaultTime: string; bgColor: string }[] = [
  { key: 'morning', label: '아침약', defaultTime: '08:00', bgColor: '#FFF8E1' },
  { key: 'lunch',   label: '점심약', defaultTime: '12:00', bgColor: '#E8F5E9' },
  { key: 'dinner',  label: '저녁약', defaultTime: '18:00', bgColor: '#E3F2FD' },
  { key: 'bedtime', label: '취침약', defaultTime: '22:00', bgColor: '#EDE7F6' },
];

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
}

interface Medication {
  id: string;
  name: string;
  dosage?: string | null;
  times: TimeSlot[];
  schedules?: MealSchedules;
  drugInfo?: DrugInfo | null;
}

// ─── API 함수 ─────────────────────────────────────────────────────────────────

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';
const MFDS_KEY = process.env.EXPO_PUBLIC_MFDS_KEY ?? '';
const MFDS_URL = 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03';

async function callClaudeOCR(
  base64Image: string,
  mediaType: string,
): Promise<{ medications: { name: string; times: string[] }[] }> {
  const response = await fetch(CLAUDE_API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': CLAUDE_API_KEY ?? '',
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: mediaType, data: base64Image },
            },
            {
              type: 'text',
              text: `이 사진에서 약 이름과 복용 시간대를 추출해주세요.

규칙:
- 사진에 명확하게 보이는 약 이름만 추출하세요. 확실하지 않으면 추출하지 마세요.
- 약 이름은 사진에 적힌 그대로 정확히 읽어주세요. 임의로 변경하거나 추측하지 마세요.
- 처방전이면: 약품명 컬럼에서 읽으세요
- 약봉투/약봉지이면: 봉투에 인쇄된 약품명을 읽으세요
- 복용 시간대가 명확히 표시된 경우만 포함하세요. 불명확하면 빈 배열로 두세요.

반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"medications":[{"name":"약 이름","times":["morning","lunch","dinner","bedtime"]}]}
복용 시간대: morning(아침)/lunch(점심)/dinner(저녁)/bedtime(취침)
개인정보(이름, 주민번호 등)는 무시하세요.
약이 보이지 않거나 읽기 어려우면 {"medications":[]} 를 반환하세요.`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) throw new Error(`API 오류: ${response.status}`);
  const data = await response.json();
  const text: string = data.content[0].text;
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as { medications: { name: string; times: string[] }[] };
}

async function searchMfdsInfo(drugName: string): Promise<DrugInfo | null> {
  try {
    const url = `${MFDS_URL}?serviceKey=${encodeURIComponent(MFDS_KEY)}&item_name=${encodeURIComponent(drugName)}&type=json&numOfRows=5&pageNo=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const rawItems = data?.body?.items?.item ?? data?.body?.items;
    if (!rawItems) return null;
    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    if (list.length === 0) return null;
    const item = list[0];
    const returnedName: string = item.ITEM_NAME ?? '';
    const searchUpper = drugName.replace(/\s/g, '').toUpperCase();
    const returnedUpper = returnedName.replace(/\s/g, '').toUpperCase();
    if (
      returnedName &&
      !returnedUpper.includes(searchUpper.slice(0, 3)) &&
      !searchUpper.includes(returnedUpper.slice(0, 3))
    ) {
      return null;
    }
    return {
      itemName: returnedName || drugName,
      entpName: item.ENTP_NAME ?? undefined,
      itemImage: item.ITEM_IMAGE ?? undefined,
      chart: item.CHART ?? undefined,
      drugShape: item.DRUG_SHAPE ?? undefined,
      colorClass: item.COLOR_CLASS1 ?? undefined,
      className: item.CLASS_NAME ?? undefined,
      etcOtcName: item.ETC_OTC_NAME ?? undefined,
      printFront: item.PRINT_FRONT ?? undefined,
      printBack: item.PRINT_BACK ?? undefined,
    };
  } catch {
    return null;
  }
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
                  <Text style={tsStyles.timeEditText}>수정</Text>
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
    justifyContent: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
    width: '100%',
  },
  timeChipText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  timeEditText: { fontSize: 16, fontWeight: '600', color: Colors.primary },
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
    fetch(
      `https://apis.data.go.kr/1471000/DrbEasyDrugInfoService/getDrbEasyDrugList?serviceKey=${encodeURIComponent(MFDS_KEY)}&item_name=${encodeURIComponent(drug.name)}&type=json&numOfRows=3&pageNo=1`
    )
      .then(r => r.json())
      .then(data => {
        const rawItems = data?.body?.items?.item ?? data?.body?.items;
        const item = Array.isArray(rawItems) ? rawItems[0] : rawItems;
        if (item) {
          setEasyInfo({
            efficacy: item.EE_DOC_DATA ? stripHtml(item.EE_DOC_DATA) : undefined,
            dosage: item.UD_DOC_DATA ? stripHtml(item.UD_DOC_DATA) : undefined,
            caution: item.NB_DOC_DATA ? stripHtml(item.NB_DOC_DATA) : undefined,
          });
        }
      })
      .catch(() => {})
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
          style={[modalStyles.sheet, { transform: [{ translateY }] }]}
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
          style={[seBsStyles.sheet, { transform: [{ translateY }] }]}
          {...panResponder.panHandlers}
        >
          <TouchableOpacity activeOpacity={1} onPress={() => {}}>
            <View style={seBsStyles.dragHandle} />

            {/* 헤더 */}
            <View style={[seBsStyles.header, { backgroundColor: slot.bgColor }]}>
              <Text style={seBsStyles.headerTitle}>{slot.label} 수정</Text>
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
                        {checked && <Text style={seBsStyles.checkmark}>✓</Text>}
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
                            {added && <Text style={seBsStyles.checkmark}>✓</Text>}
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

              {/* 저장 버튼 */}
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
            </ScrollView>
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
    maxHeight: '85%',
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
  scroll: { maxHeight: 500 },
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
  checkmark: { fontSize: 18, color: Colors.white, fontWeight: '700' },
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
  const { getPatientForCaregiver } = useFamilyLink();
  const [medications, setMedications] = useState<Medication[]>([]);
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
      setMedications(
        (data ?? []).map((row: any) => ({
          id: row.id,
          dbId: row.id,
          name: row.name,
          dosage: row.dosage ?? null,
          times: (row.meal_times ?? []) as TimeSlot[],
          schedules: (row.meal_schedules ?? {}) as MealSchedules,
          drugInfo: row.drug_image_url ? { itemName: row.name, itemImage: row.drug_image_url } : undefined,
        }))
      );
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
        if (status !== 'granted') { Alert.alert('권한 필요', '카메라 접근 권한이 필요해요.'); return; }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') { Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.'); return; }
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.7 });

      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (!asset.base64) { Alert.alert('오류', '이미지를 읽을 수 없어요.'); return; }

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
        times: med.times.filter((t): t is TimeSlot => validSlots.includes(t as TimeSlot)),
        schedules: {},
      }));

      const enriched = await Promise.all(
        newMeds.map(async med => ({ ...med, drugInfo: (await searchMfdsInfo(med.name)) ?? null }))
      );

      if (enriched.length > 0 && user && targetPatientId) {
        try {
          const { data: inserted, error: insertError } = await supabase
            .from('medications')
            .insert(
              enriched.map(med => ({
                patient_id: targetPatientId,
                name: med.name,
                dosage: null,
                meal_times: med.times,
                meal_schedules: {},
                scheduled_times: [] as string[],
                drug_code: null,
                drug_image_url: med.drugInfo?.itemImage ?? null,
                is_active: true,
              }))
            )
            .select();
          if (insertError) throw insertError;
          const dbMeds: Medication[] = (inserted ?? []).map((row: any, i: number) => ({
            id: row.id,
            name: row.name,
            dosage: null,
            times: (row.meal_times ?? []) as TimeSlot[],
            schedules: (row.meal_schedules ?? {}) as MealSchedules,
            drugInfo: enriched[i]?.drugInfo ?? null,
          }));
          setMedications(prev => [...prev, ...dbMeds]);
        } catch (e) {
          console.error('[MedicationManageScreen] OCR 약 저장 오류:', e);
          setMedications(prev => [...prev, ...enriched]);
        }
      } else {
        setMedications(prev => [...prev, ...enriched]);
      }

      const noInfoCount = enriched.filter(m => m.drugInfo === null).length;
      if (enriched.length === 0) {
        Alert.alert('약을 찾지 못했어요', '사진이 선명한지 확인 후 다시 시도하거나, 직접 입력해주세요.');
      } else if (noInfoCount > 0) {
        Alert.alert(
          `약 ${enriched.length}개 인식됨`,
          `${noInfoCount}개는 식약처 정보를 찾지 못했어요.\n약 이름이 정확한지 확인하고 수정해주세요.`,
        );
      } else {
        Alert.alert('', `약 ${enriched.length}개를 찾았어요. 내용을 확인해주세요.`);
      }
    } catch {
      Alert.alert('', '분석에 실패했어요. 다시 시도해주세요.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleOcrPress = () => {
    Alert.alert('처방전 사진 등록', '사진을 어디서 가져올까요?', [
      { text: '카메라로 찍기', onPress: () => pickImageAndRunOCR(true) },
      { text: '갤러리에서 선택', onPress: () => pickImageAndRunOCR(false) },
      { text: '취소', style: 'cancel' },
    ]);
  };

  // ── 식약처 정보 조회 ──────────────────────────────────────────────────

  const handleFetchMfdsForAdd = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 먼저 입력해주세요.'); return; }
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
    if (!trimmed) { Alert.alert('', '약 이름을 먼저 입력해주세요.'); return; }
    setIsEditMfdsLoading(true);
    try {
      const info = await searchMfdsInfo(trimmed);
      setEditDrugInfo(info);
    } finally {
      setIsEditMfdsLoading(false);
    }
  };

  // ── 추가 ────────────────────────────────────────────────────────────────

  const handleAddSubmit = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (addTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
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
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setMedications(prev => [...prev, {
        id: data.id,
        name: data.name,
        dosage: data.dosage ?? null,
        times: (data.meal_times ?? []) as TimeSlot[],
        schedules: (data.meal_schedules ?? {}) as MealSchedules,
        drugInfo: addDrugInfo ?? null,
      }]);
      setAddName('');
      setAddDosage('');
      setAddTimes([]);
      setAddSchedules({});
      setAddDrugInfo(undefined);
      setShowAddForm(false);
    } catch (e) {
      console.error('[MedicationManageScreen] 약 추가 오류:', e);
      Alert.alert('', '약 추가에 실패했어요. 다시 시도해주세요.');
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
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (editTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const savedId = editingId;
    if (!savedId) return;

    const finalSchedules: MealSchedules = {};
    editTimes.forEach(slot => {
      finalSchedules[slot] = editSchedules[slot] ?? TIME_SLOTS.find(s => s.key === slot)?.defaultTime ?? '08:00';
    });

    setMedications(prev => prev.map(m =>
      m.id === savedId
        ? { ...m, name: trimmed, dosage: editDosage.trim() || null, times: editTimes, schedules: finalSchedules, drugInfo: editDrugInfo }
        : m
    ));
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
        })
        .eq('id', savedId);
      if (error) throw error;
    } catch (e) {
      console.error('[MedicationManageScreen] 약 수정 오류:', e);
      Alert.alert('', '약 수정에 실패했어요.');
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

  const handleDelete = (med: Medication) => {
    Alert.alert('약 삭제', `${med.name}을(를) 삭제할까요?\n삭제해도 복용 기록은 유지돼요.`, [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: async () => {
          setMedications(prev => prev.filter(m => m.id !== med.id));
          try {
            const { error } = await supabase
              .from('medications')
              .update({ is_active: false })
              .eq('id', med.id);
            if (error) throw error;
          } catch (e) {
            console.error('[MedicationManageScreen] 약 삭제 오류:', e);
            Alert.alert('', '삭제에 실패했어요.');
            loadMedications();
          }
        },
      },
    ]);
  };

  // ── 시간대 수정 저장 ────────────────────────────────────────────────────

  const handleSlotEditSave = async (updatedMeds: Medication[], _newTime: string) => {
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
    medications.some(m => m.times.includes(slot.key))
  );

  // ── 렌더 ────────────────────────────────────────────────────────────────

  if (isLoading) {
    return (
      <SafeAreaView style={styles.safeArea} edges={['top']}>
        <TopBar title="약 관리" showBack />
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="약 관리" showBack />
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
                const slotMeds = medications.filter(m => m.times.includes(slot.key));
                const slotTime = slotMeds[0]?.schedules?.[slot.key] ?? slot.defaultTime;

                return (
                  <View key={slot.key} style={styles.sectionCard}>
                    {/* 섹션 헤더 */}
                    <View style={[styles.sectionHeader, { backgroundColor: slot.bgColor }]}>
                      <View style={styles.sectionHeaderLeft}>
                        <Text style={styles.sectionHeaderLabel}>{slot.label}</Text>
                        <Text style={styles.sectionHeaderTime}>{slotTime}</Text>
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
                  placeholder="약 이름 입력 (예: 시네메트)"
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

                    {/* 복용 시간대 세로 배치 */}
                    {med.times.length > 0 && (
                      <View style={styles.medSlotList}>
                        {med.times.map(t => {
                          const slot = TIME_SLOTS.find(s => s.key === t);
                          if (!slot) return null;
                          const time = med.schedules?.[t] ?? slot.defaultTime;
                          return (
                            <Text key={t} style={styles.medSlotRow}>
                              {slot.label}{'  '}{time}
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
    </SafeAreaView>
  );
}

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

  // 버튼 2개 행
  dualBtnRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
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
