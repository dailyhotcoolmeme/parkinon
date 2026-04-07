import React, { useState, useEffect, useCallback } from 'react';
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

const TIME_SLOTS: { key: TimeSlot; emoji: string; label: string; defaultTime: string }[] = [
  { key: 'morning', emoji: '🌅', label: '아침', defaultTime: '08:00' },
  { key: 'lunch', emoji: '☀️', label: '점심', defaultTime: '12:00' },
  { key: 'dinner', emoji: '🌇', label: '저녁', defaultTime: '18:00' },
  { key: 'bedtime', emoji: '🌙', label: '취침', defaultTime: '22:00' },
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

  useEffect(() => {
    if (visible) {
      const parsed = parseTime(initialTime);
      setHour(parsed.hour);
      setMinute(parsed.minute);
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
            {/* 시 선택 */}
            <View style={tpStyles.pickerCol}>
              <Text style={tpStyles.colLabel}>시</Text>
              <ScrollView style={tpStyles.scroll} showsVerticalScrollIndicator={false}>
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
            {/* 분 선택 */}
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
                <Text style={tsStyles.slotEmoji}>{t.emoji}</Text>
                <Text style={[tsStyles.slotLabel, sel && tsStyles.slotLabelSelected]}>{t.label}</Text>
              </TouchableOpacity>
              {sel && (
                <TouchableOpacity
                  style={tsStyles.timeChip}
                  onPress={() => setPickerSlot(t.key)}
                  activeOpacity={0.8}
                >
                  <Text style={tsStyles.timeChipText}>{time}</Text>
                  <Ionicons name="pencil-outline" size={13} color={Colors.primary} />
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
  container: { flexDirection: 'row', gap: 8, marginBottom: 16, flexWrap: 'wrap' },
  slotWrapper: { flex: 1, minWidth: 72, alignItems: 'center', gap: 6 },
  slotBtn: {
    width: '100%',
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.white,
  },
  slotBtnSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  slotEmoji: { fontSize: 20 },
  slotLabel: { fontSize: 18, fontWeight: '600', color: Colors.textSub, marginTop: 4 },
  slotLabelSelected: { color: Colors.white },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#E8F5E9',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  timeChipText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
});

// ─── DrugInfoModal ─────────────────────────────────────────────────────────────

function DrugInfoModal({ drug, onClose }: { drug: Medication | null; onClose: () => void }) {
  if (!drug) return null;
  const info = drug.drugInfo;

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <TouchableOpacity style={modalStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={modalStyles.sheet} activeOpacity={1} onPress={() => {}}>
          <View style={modalStyles.dragHandle} />
          <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={modalStyles.scrollContent}>
            <View style={modalStyles.imageContainer}>
              {info?.itemImage ? (
                <Image source={{ uri: info.itemImage }} style={modalStyles.drugImage} resizeMode="contain" />
              ) : (
                <View style={modalStyles.imagePlaceholder}>
                  <Text style={modalStyles.imagePlaceholderEmoji}>💊</Text>
                </View>
              )}
            </View>
            <Text style={modalStyles.drugName}>{drug.name}</Text>
            {info?.entpName && <Text style={modalStyles.companyName}>{info.entpName}</Text>}
            {!info && (
              <View style={modalStyles.noInfoContainer}>
                <Text style={modalStyles.noInfoEmoji}>💊</Text>
                <Text style={modalStyles.noInfoText}>식약처 정보를 불러올 수 없어요</Text>
                <Text style={modalStyles.noInfoSubText}>약 이름이 정확한지 확인해주세요</Text>
              </View>
            )}
            {info?.chart && (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionHeader}>💊 성상</Text>
                <Text style={modalStyles.sectionContent}>{info.chart}</Text>
              </View>
            )}
            {(info?.className || info?.etcOtcName) && (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionHeader}>🏷️ 분류</Text>
                <Text style={modalStyles.sectionContent}>
                  {[info.className, info.etcOtcName].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}
            {(info?.printFront || info?.printBack) && (
              <View style={modalStyles.section}>
                <Text style={modalStyles.sectionHeader}>🔍 식별</Text>
                <Text style={modalStyles.sectionContent}>
                  {info.printFront ? `앞: ${info.printFront}` : ''}
                  {info.printFront && info.printBack ? '\n' : ''}
                  {info.printBack ? `뒤: ${info.printBack}` : ''}
                </Text>
              </View>
            )}
            <TouchableOpacity style={modalStyles.closeBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={modalStyles.closeBtnText}>닫기</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
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
  imagePlaceholderEmoji: { fontSize: 48 },
  drugName: { fontSize: 24, fontWeight: '700', color: Colors.text, textAlign: 'center', marginBottom: 6 },
  companyName: { fontSize: 16, color: Colors.textSub, textAlign: 'center', marginBottom: 20 },
  noInfoContainer: { alignItems: 'center', paddingVertical: 24, gap: 10 },
  noInfoEmoji: { fontSize: 56 },
  noInfoText: { fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  noInfoSubText: { fontSize: 16, color: Colors.textSub, textAlign: 'center', lineHeight: 26 },
  section: { marginBottom: 20 },
  sectionHeader: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  sectionContent: { fontSize: 16, color: Colors.textSub, lineHeight: 26 },
  closeBtn: { backgroundColor: Colors.primary, borderRadius: 12, minHeight: 56, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  closeBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────

export function MedicationManageScreen() {
  const { user } = useAuth();
  const { getPatientForCaregiver } = useFamilyLink();
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Medication | null>(null);
  // 보호자인 경우 연동된 환자 id, 환자인 경우 본인 id
  const [targetPatientId, setTargetPatientId] = useState<string | null>(null);

  // 직접 추가 폼
  const [showAddForm, setShowAddForm] = useState(false);
  const [addName, setAddName] = useState('');
  const [addDosage, setAddDosage] = useState('');
  const [addTimes, setAddTimes] = useState<TimeSlot[]>([]);
  const [addSchedules, setAddSchedules] = useState<MealSchedules>({});
  const [addDrugInfo, setAddDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isMfdsLoading, setIsMfdsLoading] = useState(false);

  // 인라인 수정 모드
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDosage, setEditDosage] = useState('');
  const [editTimes, setEditTimes] = useState<TimeSlot[]>([]);
  const [editSchedules, setEditSchedules] = useState<MealSchedules>({});
  const [editDrugInfo, setEditDrugInfo] = useState<DrugInfo | null | undefined>(undefined);
  const [isEditMfdsLoading, setIsEditMfdsLoading] = useState(false);

  // 대상 환자 id 결정 (보호자는 연동된 환자, 환자는 본인)
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

  // 화면 포커스 시 목록 재조회 (다른 화면에서 돌아왔을 때도 최신 상태 유지)
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

      // DB에 저장
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
          // DB에서 실제 ID로 교체
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
          `⚠️ ${noInfoCount}개는 식약처 정보를 찾지 못했어요.\n약 이름이 정확한지 확인하고 수정해주세요.`,
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

  // ── 식약처 정보 수동 조회 ──────────────────────────────────────────────────

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

    // 선택된 시간대에 스케줄 기본값 채우기
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
    setShowAddForm(false);
  };

  const handleEditSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (editTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const savedId = editingId;
    if (!savedId) return;

    // 선택된 시간대에 스케줄 기본값 채우기
    const finalSchedules: MealSchedules = {};
    editTimes.forEach(slot => {
      finalSchedules[slot] = editSchedules[slot] ?? TIME_SLOTS.find(s => s.key === slot)?.defaultTime ?? '08:00';
    });

    // 낙관적 UI 업데이트
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
              <Text style={styles.prescriptionIconEmoji}>📷</Text>
            </View>
            <View style={styles.prescriptionTextGroup}>
              <Text style={styles.prescriptionTitle}>처방전으로 등록하기</Text>
              <Text style={styles.prescriptionSub}>사진 한 장으로 자동 입력돼요</Text>
            </View>
            <Ionicons name="chevron-forward" size={24} color={Colors.primary} />
          </TouchableOpacity>

          {/* ── 직접 추가 버튼 ── */}
          <TouchableOpacity
            style={styles.addToggleBtn}
            onPress={() => {
              setShowAddForm(v => !v);
              setEditingId(null);
            }}
            activeOpacity={0.8}
          >
            <Ionicons name={showAddForm ? 'close-circle-outline' : 'add-circle-outline'} size={24} color={Colors.primary} />
            <Text style={styles.addToggleBtnText}>
              {showAddForm ? '입력 취소' : '약 직접 추가하기'}
            </Text>
          </TouchableOpacity>

          {/* ── 직접 추가 폼 ── */}
          {showAddForm && (
            <View style={styles.addFormCard}>
              {/* 약 이름 */}
              <TextInput
                style={styles.medInput}
                value={addName}
                onChangeText={(v) => { setAddName(v); setAddDrugInfo(undefined); }}
                placeholder="약 이름 입력 (예: 시네메트)"
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
              />

              {/* 식약처 정보 불러오기 버튼 */}
              <TouchableOpacity
                style={styles.mfdsBtn}
                onPress={handleFetchMfdsForAdd}
                activeOpacity={0.85}
                disabled={isMfdsLoading}
              >
                {isMfdsLoading ? (
                  <ActivityIndicator size="small" color={Colors.white} />
                ) : (
                  <Text style={styles.mfdsBtnText}>🔍 식약처 정보 불러오기</Text>
                )}
              </TouchableOpacity>

              {/* 식약처 결과 표시 */}
              {addDrugInfo !== undefined && (
                <View style={[styles.mfdsResult, addDrugInfo ? styles.mfdsResultOk : styles.mfdsResultFail]}>
                  <Text style={[styles.mfdsResultText, addDrugInfo ? styles.mfdsResultTextOk : styles.mfdsResultTextFail]}>
                    {addDrugInfo
                      ? `✅ 확인됨${addDrugInfo.entpName ? ` (${addDrugInfo.entpName})` : ''}`
                      : '⚠️ 식약처 정보 없음'}
                  </Text>
                </View>
              )}

              {/* 복용량 */}
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
          )}

          {/* ── 섹션 헤더 ── */}
          <Text style={styles.sectionHeader}>
            {'💊 등록된 약 '}
            <Text style={styles.sectionHeaderCount}>({medications.length})</Text>
          </Text>

          {/* ── 빈 상태 ── */}
          {medications.length === 0 && (
            <View style={styles.emptyCard}>
              <Ionicons name="medkit-outline" size={56} color={Colors.textHint} />
              <Text style={styles.emptyTitle}>등록된 약이 없어요</Text>
              <Text style={styles.emptyDesc}>{'처방전 등록 또는 위 버튼으로\n약을 추가해보세요'}</Text>
            </View>
          )}

          {/* ── 약 카드 목록 ── */}
          {medications.map(med => {
            const isEditing = editingId === med.id;

            if (isEditing) {
              return (
                <View key={med.id} style={styles.medCardEditing}>
                  {/* 약 이름 수정 */}
                  <TextInput
                    style={styles.medInput}
                    value={editName}
                    onChangeText={(v) => { setEditName(v); setEditDrugInfo(undefined); }}
                    placeholder="약 이름"
                    placeholderTextColor={Colors.textHint}
                    returnKeyType="done"
                    autoFocus
                  />

                  {/* 식약처 정보 불러오기 버튼 */}
                  <TouchableOpacity
                    style={styles.mfdsBtn}
                    onPress={handleFetchMfdsForEdit}
                    activeOpacity={0.85}
                    disabled={isEditMfdsLoading}
                  >
                    {isEditMfdsLoading ? (
                      <ActivityIndicator size="small" color={Colors.white} />
                    ) : (
                      <Text style={styles.mfdsBtnText}>🔍 식약처 정보 불러오기</Text>
                    )}
                  </TouchableOpacity>

                  {/* 식약처 결과 표시 */}
                  {editDrugInfo !== undefined && (
                    <View style={[styles.mfdsResult, editDrugInfo ? styles.mfdsResultOk : styles.mfdsResultFail]}>
                      <Text style={[styles.mfdsResultText, editDrugInfo ? styles.mfdsResultTextOk : styles.mfdsResultTextFail]}>
                        {editDrugInfo
                          ? `✅ 확인됨${editDrugInfo.entpName ? ` (${editDrugInfo.entpName})` : ''}`
                          : '⚠️ 식약처 정보 없음'}
                      </Text>
                    </View>
                  )}

                  {/* 복용량 수정 */}
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
                <View style={styles.medTopRow}>
                  {med.drugInfo?.itemImage ? (
                    <Image source={{ uri: med.drugInfo.itemImage }} style={styles.medThumbnail} resizeMode="cover" />
                  ) : (
                    <View style={styles.medIconCircle}>
                      <Text style={styles.medIconEmoji}>💊</Text>
                    </View>
                  )}
                  <View style={styles.medInfoGroup}>
                    <TouchableOpacity onPress={() => setSelectedDrug(med)} activeOpacity={0.7} style={styles.medNameRow}>
                      <Text style={styles.medName}>{med.name}</Text>
                      <Text style={styles.medInfoIndicator}> ℹ️</Text>
                    </TouchableOpacity>
                    {med.dosage ? (
                      <Text style={styles.medDosage}>{med.dosage}</Text>
                    ) : null}
                    <Text style={styles.medSchedule}>
                      {med.times.map(t => TIME_SLOTS.find(s => s.key === t)?.label).join(' · ')}
                    </Text>
                    {med.drugInfo === null && (
                      <Text style={styles.noInfoBadge}>⚠️ 식약처 정보 없음 · 이름 확인 필요</Text>
                    )}
                  </View>
                </View>
                <View style={styles.medBtnRow}>
                  <TouchableOpacity style={styles.editBtn} onPress={() => handleEditStart(med)} activeOpacity={0.7}>
                    <Text style={styles.editBtnText}>✏️ 수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(med)} activeOpacity={0.7}>
                    <Text style={styles.deleteBtnText}>🗑️ 삭제</Text>
                  </TouchableOpacity>
                </View>
              </View>
            );
          })}
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
    marginBottom: 12,
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

  // 직접 추가 토글 버튼
  addToggleBtn: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginBottom: 20,
  },
  addToggleBtnText: { fontSize: 20, fontWeight: '600', color: Colors.primary },

  // 직접 추가 폼
  addFormCard: {
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
  medInput: {
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 20,
    color: Colors.text,
    marginBottom: 12,
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

  // 섹션 헤더
  sectionHeader: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 14, marginTop: 8 },
  sectionHeaderCount: { fontSize: 20, fontWeight: '700', color: Colors.text },

  // 빈 상태
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  emptyTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  emptyDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },

  // 약 카드
  medCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    padding: 20,
    marginBottom: 12,
  },
  medCardEditing: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    padding: 20,
    marginBottom: 12,
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
  medIconEmoji: { fontSize: 26 },
  medInfoGroup: { flex: 1, marginLeft: 16 },
  medNameRow: { flexDirection: 'row', alignItems: 'center' },
  medName: { fontSize: 22, fontWeight: '700', color: Colors.text },
  medInfoIndicator: { fontSize: 18 },
  medDosage: { fontSize: 18, color: Colors.textSub, marginTop: 3, fontWeight: '500' },
  medSchedule: { fontSize: 18, color: Colors.textSub, marginTop: 4 },
  noInfoBadge: { fontSize: 18, color: Colors.danger, marginTop: 4 },

  medBtnRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  editBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  deleteBtn: {
    flex: 1,
    height: 56,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 18, fontWeight: '700', color: Colors.danger },

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
