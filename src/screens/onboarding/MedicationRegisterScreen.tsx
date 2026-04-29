import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system';
import { supabase } from '../../lib/supabase';

type Nav = StackNavigationProp<OnboardingStackParamList, 'MedicationRegister'>;

type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'bedtime';

type MealSchedules = {
  morning?: string;
  lunch?: string;
  dinner?: string;
  bedtime?: string;
};

// 각 시간대 기본 시간
const DEFAULT_TIMES: Record<TimeSlot, string> = {
  morning: '08:00',
  lunch: '12:00',
  dinner: '18:00',
  bedtime: '22:00',
};

const TIME_SLOTS: { key: TimeSlot; label: string }[] = [
  { key: 'morning', label: '아침' },
  { key: 'lunch', label: '점심' },
  { key: 'dinner', label: '저녁' },
  { key: 'bedtime', label: '취침' },
];

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
  dosage: string;
  times: TimeSlot[];
  meal_schedules: MealSchedules;
  drugInfo?: DrugInfo | null;
}

type Mode = 'home' | 'manual';

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL ?? '';
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? '';

const MFDS_KEY = process.env.EXPO_PUBLIC_MFDS_KEY ?? '';
const MFDS_URL = 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03';

async function callClaudeOCR(base64Image: string, mediaType: string): Promise<{ medications: { name: string; times: string[] }[] }> {
  // image_type은 'jpeg' 또는 'png'만 허용 (Edge Function 스펙)
  const rawType = mediaType.replace('image/', '');
  const imageType: 'jpeg' | 'png' = rawType === 'png' ? 'png' : 'jpeg';

  const response = await fetch(`${SUPABASE_URL}/functions/v1/ocr-prescription`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({ image_base64: base64Image, image_type: imageType }),
  });

  if (!response.ok) {
    throw new Error(`OCR 오류: ${response.status}`);
  }

  // Edge Function 응답: { medications: [{ name, dosage, meal_times }] }
  // 클라이언트 내부 형식: { medications: [{ name, times }] } 로 변환
  const data = await response.json();
  const medications: { name: string; times: string[] }[] = (data.medications ?? []).map(
    (med: { name: string; dosage?: string; meal_times?: string[] }) => ({
      name: med.name,
      times: med.meal_times ?? [],
    })
  );

  return { medications };
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

// ─────────────────────────────────────────────
// 시간 선택 모달
// ─────────────────────────────────────────────
interface TimePickerModalProps {
  visible: boolean;
  slotLabel: string;
  initialTime: string; // "HH:MM"
  onConfirm: (time: string) => void;
  onClose: () => void;
}

function TimePickerModal({ visible, slotLabel, initialTime, onConfirm, onClose }: TimePickerModalProps) {
  const [hour, setHour] = useState(() => parseInt(initialTime.split(':')[0], 10));
  const [minute, setMinute] = useState(() => {
    const m = parseInt(initialTime.split(':')[1], 10);
    return Math.round(m / 10) * 10 % 60;
  });
  const hourScrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    if (visible) {
      const h = parseInt(initialTime.split(':')[0], 10);
      const m = parseInt(initialTime.split(':')[1], 10);
      setHour(h);
      setMinute(Math.round(m / 10) * 10 % 60);
      // 현재 시(hour)로 스크롤 위치 이동 (chipVertical minHeight 56 + marginBottom 6 = 62px)
      setTimeout(() => {
        hourScrollRef.current?.scrollTo({ y: h * 62, animated: false });
      }, 50);
    }
  }, [visible, initialTime]);

  const hours = Array.from({ length: 24 }, (_, i) => i);
  const minutes = [0, 10, 20, 30, 40, 50];

  const pad = (n: number) => n.toString().padStart(2, '0');

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <TouchableOpacity style={tpStyles.overlay} activeOpacity={1} onPress={onClose}>
        <TouchableOpacity style={tpStyles.card} activeOpacity={1} onPress={() => {}}>
          <Text style={tpStyles.title}>{slotLabel} 시간 설정</Text>

          {/* 시간 미리보기 */}
          <Text style={tpStyles.preview}>{pad(hour)}:{pad(minute)}</Text>

          {/* 시 선택 */}
          <Text style={tpStyles.sectionLabel}>시</Text>
          <ScrollView ref={hourScrollRef} style={tpStyles.scrollCol} showsVerticalScrollIndicator={false}>
            {hours.map((h) => (
              <TouchableOpacity
                key={h}
                style={[tpStyles.chip, tpStyles.chipVertical, hour === h && tpStyles.chipSelected]}
                onPress={() => setHour(h)}
                activeOpacity={0.8}
              >
                <Text style={[tpStyles.chipText, hour === h && tpStyles.chipTextSelected]}>
                  {pad(h)}
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>

          {/* 분 선택 */}
          <Text style={tpStyles.sectionLabel}>분 (10분 단위)</Text>
          <View style={tpStyles.chipRow}>
            {minutes.map((m) => (
              <TouchableOpacity
                key={m}
                style={[tpStyles.chip, minute === m && tpStyles.chipSelected]}
                onPress={() => setMinute(m)}
                activeOpacity={0.8}
              >
                <Text style={[tpStyles.chipText, minute === m && tpStyles.chipTextSelected]}>
                  {pad(m)}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

          {/* 버튼 */}
          <View style={tpStyles.btnRow}>
            <TouchableOpacity style={tpStyles.cancelBtn} onPress={onClose} activeOpacity={0.85}>
              <Text style={tpStyles.cancelBtnText}>취소</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={tpStyles.confirmBtn}
              onPress={() => onConfirm(`${pad(hour)}:${pad(minute)}`)}
              activeOpacity={0.85}
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
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  card: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 24,
    width: '100%',
    gap: 12,
  },
  title: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  preview: {
    fontSize: 40,
    fontWeight: '700',
    color: Colors.primary,
    textAlign: 'center',
    letterSpacing: 2,
  },
  sectionLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
  },
  scrollRow: {
    flexGrow: 0,
  },
  scrollCol: {
    height: 200,
    flexGrow: 0,
  },
  chipRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  chip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    minWidth: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  chipVertical: {
    minHeight: 56,
    marginBottom: 6,
  },
  chipSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  chipText: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
  },
  chipTextSelected: {
    color: Colors.dark,
  },
  btnRow: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 4,
  },
  cancelBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cancelBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
  },
  confirmBtn: {
    flex: 1,
    minHeight: 56,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
});

// ─────────────────────────────────────────────
// DrugInfoModal 컴포넌트
// ─────────────────────────────────────────────
interface DrugInfoModalProps {
  drug: Medication | null;
  onClose: () => void;
}

function DrugInfoModal({ drug, onClose }: DrugInfoModalProps) {
  if (!drug) return null;

  const info = drug.drugInfo;

  return (
    <Modal
      visible={true}
      transparent={true}
      animationType="slide"
      onRequestClose={onClose}
    >
      <TouchableOpacity
        style={drugModalStyles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        <TouchableOpacity
          style={drugModalStyles.sheet}
          activeOpacity={1}
          onPress={() => {}}
        >
          <View style={drugModalStyles.dragHandle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={drugModalStyles.scrollContent}
          >
            <View style={drugModalStyles.imageContainer}>
              {info?.itemImage ? (
                <Image
                  source={{ uri: info.itemImage }}
                  style={drugModalStyles.drugImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={drugModalStyles.imagePlaceholder}>
                </View>
              )}
            </View>

            {/* 약 이름 + 복용량 */}
            <Text style={drugModalStyles.drugName}>{drug.name}</Text>
            {!!drug.dosage && (
              <Text style={drugModalStyles.drugDosage}>{drug.dosage}</Text>
            )}

            {info?.entpName && (
              <Text style={drugModalStyles.companyName}>{info.entpName}</Text>
            )}

            {!info && (
              <View style={drugModalStyles.noInfoContainer}>
                <Text style={drugModalStyles.noInfoText}>약 정보를 불러오는 중이에요</Text>
                <Text style={drugModalStyles.noInfoSubText}>
                  식약처 낱알식별 정보를 가져올 수 없어요
                </Text>
              </View>
            )}

            {info?.chart && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>성상</Text>
                <Text style={drugModalStyles.sectionContent}>{info.chart}</Text>
              </View>
            )}

            {(info?.className || info?.etcOtcName) && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>분류</Text>
                <Text style={drugModalStyles.sectionContent}>
                  {[info.className, info.etcOtcName].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}

            {(info?.printFront || info?.printBack) && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>식별</Text>
                <Text style={drugModalStyles.sectionContent}>
                  {info.printFront ? `앞: ${info.printFront}` : ''}
                  {info.printFront && info.printBack ? '\n' : ''}
                  {info.printBack ? `뒤: ${info.printBack}` : ''}
                </Text>
              </View>
            )}

            <TouchableOpacity
              style={drugModalStyles.closeBtn}
              onPress={onClose}
              activeOpacity={0.85}
            >
              <Text style={drugModalStyles.closeBtnText}>닫기</Text>
            </TouchableOpacity>
          </ScrollView>
        </TouchableOpacity>
      </TouchableOpacity>
    </Modal>
  );
}

const drugModalStyles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    maxHeight: '80%',
    paddingBottom: 32,
  },
  dragHandle: {
    width: 40,
    height: 5,
    backgroundColor: '#DDDDDD',
    borderRadius: 3,
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 8,
  },
  scrollContent: {
    paddingHorizontal: 24,
    paddingBottom: 8,
  },
  imageContainer: {
    alignItems: 'center',
    marginVertical: 16,
  },
  drugImage: {
    width: 160,
    height: 100,
    resizeMode: 'contain',
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  imagePlaceholder: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  drugName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  drugDosage: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
    textAlign: 'center',
    marginBottom: 4,
  },
  companyName: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 20,
  },
  noInfoContainer: {
    alignItems: 'center',
    paddingVertical: 24,
    gap: 10,
  },
  noInfoText: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  noInfoSubText: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 26,
  },
  section: {
    marginBottom: 20,
  },
  sectionHeader: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
  },
  sectionContent: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 26,
  },
  closeBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  closeBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
});

// ─────────────────────────────────────────────
// 시간대 선택 + 시간 설정 서브 컴포넌트
// ─────────────────────────────────────────────
interface TimeSlotsEditorProps {
  selectedTimes: TimeSlot[];
  mealSchedules: MealSchedules;
  onToggleTime: (t: TimeSlot) => void;
  onSetScheduleTime: (slot: TimeSlot, time: string) => void;
}

function TimeSlotsEditor({ selectedTimes, mealSchedules, onToggleTime, onSetScheduleTime }: TimeSlotsEditorProps) {
  const [pickerVisible, setPickerVisible] = useState(false);
  const [pickerSlot, setPickerSlot] = useState<TimeSlot>('morning');

  const openPicker = (slot: TimeSlot) => {
    setPickerSlot(slot);
    setPickerVisible(true);
  };

  return (
    <>
      <View style={tseStyles.container}>
        {TIME_SLOTS.map((t) => {
          const selected = selectedTimes.includes(t.key);
          const time = mealSchedules[t.key] ?? DEFAULT_TIMES[t.key];
          return (
            <View key={t.key} style={tseStyles.row}>
              {/* 시간대 선택 버튼 */}
              <TouchableOpacity
                style={[tseStyles.slotBtn, selected && tseStyles.slotBtnSelected]}
                onPress={() => onToggleTime(t.key)}
                activeOpacity={0.85}
              >
                <Text style={[tseStyles.slotText, selected && tseStyles.slotTextSelected]}>
                  {t.label}
                </Text>
              </TouchableOpacity>

              {/* 선택된 경우 시간 버튼 표시 */}
              {selected && (
                <TouchableOpacity
                  style={tseStyles.timeChip}
                  onPress={() => openPicker(t.key)}
                  activeOpacity={0.8}
                >
                  <Text style={tseStyles.timeChipText}>{time}</Text>
                  <View style={tseStyles.timeChipEditBtn}>
                    <Text style={tseStyles.timeChipEdit}>수정</Text>
                  </View>
                </TouchableOpacity>
              )}
            </View>
          );
        })}
      </View>

      <TimePickerModal
        visible={pickerVisible}
        slotLabel={TIME_SLOTS.find((t) => t.key === pickerSlot)?.label ?? ''}
        initialTime={mealSchedules[pickerSlot] ?? DEFAULT_TIMES[pickerSlot]}
        onConfirm={(time) => {
          onSetScheduleTime(pickerSlot, time);
          setPickerVisible(false);
        }}
        onClose={() => setPickerVisible(false)}
      />
    </>
  );
}

const tseStyles = StyleSheet.create({
  container: {
    gap: 10,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  slotBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 8,
    minHeight: 56,
    minWidth: 110,
  },
  slotBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  slotText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
  },
  slotTextSelected: {
    color: Colors.dark,
  },
  timeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
    minHeight: 56,
  },
  timeChipText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
    flex: 1,
    textAlign: 'center',
  },
  timeChipEditBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: Colors.primary,
    backgroundColor: Colors.white,
  },
  timeChipEdit: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
  },
});

// ─────────────────────────────────────────────
// 메인 화면 컴포넌트
// ─────────────────────────────────────────────
export function MedicationRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { forceCompleteOnboarding } = useAuth();
  const [mode, setMode] = useState<Mode>('home');

  // "나중에 등록하기" — DB onboarding_done 업데이트 후 메인으로
  // supabase-js PostgREST는 새 아키텍처에서 hang → 직접 fetch 사용
  const handleCompleteOnboarding = async () => {
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const accessToken = sessionData?.session?.access_token;
      if (!userId || !accessToken) {
        Alert.alert('오류', '세션이 만료되었어요. 다시 로그인해 주세요.');
        return;
      }

      const baseHeaders = {
        'apikey': process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // AsyncStorage에서 프로필 + 역할 정보 읽기
      const storageValues = await AsyncStorage.multiGet([
        'onboarding_role',
        'onboarding_invite_code_generated',
        'onboarding_group_id',
        'onboarding_name',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_relation',
        'onboarding_living',
      ]).then((pairs) => pairs.map(([, v]) => v));
      const [roleVal, inviteCodeVal, joinGroupIdVal, nameVal, birthYearVal, genderVal, relationVal, livingVal] = storageValues;

      // onboarding_done 업데이트 + 프로필 정보 포함
      const patchBody: Record<string, any> = {
        onboarding_done: true,
        meal_schedules: {
          morning: '08:00',
          lunch: '12:00',
          dinner: '18:00',
          bedtime: '22:00',
        },
      };
      if (nameVal) patchBody.name = nameVal;
      if (birthYearVal) patchBody.birth_year = parseInt(birthYearVal, 10);
      if (genderVal) patchBody.gender = genderVal;
      if (relationVal) patchBody.caregiver_relation = relationVal;
      if (livingVal) patchBody.residence_type = livingVal;

      const patchRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(patchBody),
      });
      if (!patchRes.ok) {
        const errText = await patchRes.text();
        console.error('[MedicationRegisterScreen] onboarding_done 업데이트 실패:', patchRes.status, errText);
        Alert.alert('오류', '온보딩 완료 처리에 실패했어요. 잠시 후 다시 시도해 주세요.');
        return;
      }

      // 보호자가 초대코드로 그룹에 참여한 경우 patient_group_members INSERT (나중에 등록하기 경로)
      // FamilyInviteScreen을 거치지 않으므로 여기서 직접 처리
      if (joinGroupIdVal) {
        try {
          const memberInsertRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
            method: 'POST',
            headers: { ...baseHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
            body: JSON.stringify({ group_id: joinGroupIdVal, user_id: userId, role: roleVal ?? 'caregiver' }),
          });
          if (!memberInsertRes.ok) {
            const errText = await memberInsertRes.text();
            console.warn('[MedicationRegisterScreen] patient_group_members INSERT 실패 (계속 진행):', errText);
          }
          await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
            method: 'PATCH',
            headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify({ patient_group_id: joinGroupIdVal }),
          });
        } catch (memberErr) {
          console.warn('[MedicationRegisterScreen] patient_group_members 처리 예외 (계속 진행):', memberErr);
        }
      }

      // 환자인 경우 patient_groups가 없으면 생성 (나중에 등록하기 경로)

      if (roleVal === 'patient' && !joinGroupIdVal && inviteCodeVal) {
        const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
        const groupRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_groups`, {
          method: 'POST',
          headers: { ...baseHeaders, 'Prefer': 'return=representation' },
          body: JSON.stringify({
            invite_code: inviteCodeVal,
            invite_code_expires_at: expiresAt,
          }),
        });
        if (groupRes.ok) {
          const groupData = await groupRes.json();
          const newGroupId = Array.isArray(groupData) ? groupData[0]?.id : groupData?.id;
          if (newGroupId) {
            await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
              method: 'PATCH',
              headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
              body: JSON.stringify({ patient_group_id: newGroupId }),
            });
            await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
              method: 'POST',
              headers: { ...baseHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
              body: JSON.stringify({ group_id: newGroupId, user_id: userId, role: 'patient' }),
            });
          }
        } else {
          const errText = await groupRes.text();
          console.warn('[MedicationRegisterScreen] patient_groups 생성 오류 (계속 진행):', errText);
        }
      }

      // DB 업데이트 성공 후에만 로컬 상태 완료 처리
      forceCompleteOnboarding();
    } catch (e) {
      console.error('[MedicationRegisterScreen] onboarding_done 업데이트 예외:', e);
      Alert.alert('오류', '온보딩 완료 처리 중 문제가 생겼어요. 잠시 후 다시 시도해 주세요.');
    }
  };
  const [medName, setMedName] = useState('');
  const [medDosage, setMedDosage] = useState('');
  const [selectedTimes, setSelectedTimes] = useState<TimeSlot[]>([]);
  const [mealSchedules, setMealSchedules] = useState<MealSchedules>({});
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Medication | null>(null);

  // 식약처 수동 조회 상태
  const [mfdsLoading, setMfdsLoading] = useState(false);
  const [mfdsResult, setMfdsResult] = useState<'found' | 'not_found' | null>(null);
  const [mfdsCompany, setMfdsCompany] = useState('');
  const [pendingDrugInfo, setPendingDrugInfo] = useState<DrugInfo | null | undefined>(undefined);

  // 수정 모드 state
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDosage, setEditDosage] = useState('');
  const [editTimes, setEditTimes] = useState<TimeSlot[]>([]);
  const [editMealSchedules, setEditMealSchedules] = useState<MealSchedules>({});

  // 수동 식약처 조회
  const handleMfdsSearch = async () => {
    const trimmed = medName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 먼저 입력해주세요.'); return; }
    setMfdsLoading(true);
    setMfdsResult(null);
    try {
      const info = await searchMfdsInfo(trimmed);
      if (info) {
        setMfdsResult('found');
        setMfdsCompany(info.entpName ?? '');
        setPendingDrugInfo(info);
      } else {
        setMfdsResult('not_found');
        setPendingDrugInfo(null);
      }
    } catch {
      setMfdsResult('not_found');
      setPendingDrugInfo(null);
    } finally {
      setMfdsLoading(false);
    }
  };

  const toggleTime = (t: TimeSlot) => {
    setSelectedTimes((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      // 새로 선택 시 기본 시간 자동 설정
      if (!prev.includes(t)) {
        setMealSchedules((s) => ({ ...s, [t]: s[t] ?? DEFAULT_TIMES[t] }));
      }
      return next;
    });
  };

  const setScheduleTime = (slot: TimeSlot, time: string) => {
    setMealSchedules((s) => ({ ...s, [slot]: time }));
  };

  const toggleEditTime = (t: TimeSlot) => {
    setEditTimes((prev) => {
      const next = prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t];
      if (!prev.includes(t)) {
        setEditMealSchedules((s) => ({ ...s, [t]: s[t] ?? DEFAULT_TIMES[t] }));
      }
      return next;
    });
  };

  const setEditScheduleTime = (slot: TimeSlot, time: string) => {
    setEditMealSchedules((s) => ({ ...s, [slot]: time }));
  };

  const pickImageAndRunOCR = async (useCamera: boolean) => {
    try {
      if (useCamera) {
        const { status } = await ImagePicker.requestCameraPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('권한 필요', '카메라 접근 권한이 필요해요.');
          return;
        }
      } else {
        const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (status !== 'granted') {
          Alert.alert('권한 필요', '갤러리 접근 권한이 필요해요.');
          return;
        }
      }

      const result = useCamera
        ? await ImagePicker.launchCameraAsync({
            mediaTypes: ['images'],
            base64: true,
            quality: 0.7,
          })
        : await ImagePicker.launchImageLibraryAsync({
            mediaTypes: ['images'],
            base64: true,
            quality: 0.7,
          });

      if (result.canceled || !result.assets || result.assets.length === 0) {
        return;
      }

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert('오류', '이미지를 읽을 수 없어요. 다시 시도해주세요.');
        return;
      }

      const uri = asset.uri.toLowerCase();
      let mediaType = 'image/jpeg';
      if (uri.includes('.png')) mediaType = 'image/png';
      else if (uri.includes('.gif')) mediaType = 'image/gif';
      else if (uri.includes('.webp')) mediaType = 'image/webp';

      setIsOcrLoading(true);

      const parsed = await callClaudeOCR(asset.base64, mediaType);

      // OCR 완료 후 원본 이미지 즉시 삭제 (개인정보 보호)
      if (asset.uri && asset.uri.startsWith('file://')) {
        try {
          await FileSystem.deleteAsync(asset.uri, { idempotent: true });
        } catch {
          // 삭제 실패해도 계속 진행
        }
      }

      const validTimeSlots: TimeSlot[] = ['morning', 'lunch', 'dinner', 'bedtime'];
      const newMedications: Medication[] = parsed.medications.map((med, index) => {
        const times = med.times.filter((t): t is TimeSlot => validTimeSlots.includes(t as TimeSlot));
        const schedules: MealSchedules = {};
        times.forEach((t) => { schedules[t] = DEFAULT_TIMES[t]; });
        return {
          id: (Date.now() + index).toString(),
          name: med.name,
          dosage: '',
          times,
          meal_schedules: schedules,
        };
      });

      // OCR 후 식약처 정보 병렬 조회
      const enriched = await Promise.all(
        newMedications.map(async (med) => {
          const drugInfo = await searchMfdsInfo(med.name);
          return { ...med, drugInfo: drugInfo ?? null };
        })
      );
      setMedications(enriched);
      setMode('manual');

      const noInfoCount = enriched.filter((m) => m.drugInfo === null).length;
      if (enriched.length === 0) {
        Alert.alert('약을 찾지 못했어요', '사진이 선명한지 확인 후 다시 시도하거나, 직접 입력해주세요.');
      } else if (noInfoCount > 0) {
        Alert.alert(
          `약 ${enriched.length}개 인식됨`,
          `${noInfoCount}개는 식약처에서 정보를 찾지 못했어요.\n약 이름이 정확한지 꼭 확인하고 수정해주세요.`
        );
      } else {
        Alert.alert('', `약 ${enriched.length}개를 찾았어요. 정보를 확인해주세요.`);
      }
    } catch (error) {
      Alert.alert('', '분석에 실패했어요. 다시 시도해주세요.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleOcrPress = () => {
    // 처방전 촬영 전 주의사항 안내 → 확인 후 카메라/갤러리 선택
    Alert.alert(
      '처방전 촬영 안내',
      '입력된 약 정보는 자동 인식 결과입니다.\n반드시 확인하고 오류가 있으면 직접 수정해주세요.\n\n처방전 사진은 분석 후 즉시 삭제됩니다.',
      [
        {
          text: '확인',
          onPress: () => {
            Alert.alert(
              '처방전 사진 등록',
              '사진을 어디서 가져올까요?',
              [
                { text: '카메라로 찍기', onPress: () => pickImageAndRunOCR(true) },
                { text: '갤러리에서 선택', onPress: () => pickImageAndRunOCR(false) },
                { text: '취소', style: 'cancel' },
              ]
            );
          },
        },
      ]
    );
  };

  const handleAddMed = () => {
    const trimmed = medName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (selectedTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const newId = Date.now().toString();

    // 선택된 시간대만 meal_schedules에 포함
    const schedules: MealSchedules = {};
    selectedTimes.forEach((t) => {
      schedules[t] = mealSchedules[t] ?? DEFAULT_TIMES[t];
    });

    const drugInfoToSave = pendingDrugInfo;

    setMedications((prev) => [
      ...prev,
      {
        id: newId,
        name: trimmed,
        dosage: medDosage.trim(),
        times: selectedTimes,
        meal_schedules: schedules,
        drugInfo: drugInfoToSave,
      },
    ]);

    // 입력 초기화
    setMedName('');
    setMedDosage('');
    setSelectedTimes([]);
    setMealSchedules({});
    setMfdsResult(null);
    setMfdsCompany('');
    setPendingDrugInfo(undefined);

    // 식약처 정보가 아직 조회 안 된 경우 백그라운드 조회
    if (drugInfoToSave === undefined) {
      searchMfdsInfo(trimmed).then((drugInfo) => {
        setMedications((prev) => prev.map((m) =>
          m.id === newId ? { ...m, drugInfo: drugInfo ?? null } : m
        ));
      });
    }
  };

  const handleDeleteMed = (id: string) => {
    setMedications((prev) => prev.filter((m) => m.id !== id));
  };

  const handleEditStart = (med: Medication) => {
    setEditingMedId(med.id);
    setEditName(med.name);
    setEditDosage(med.dosage ?? '');
    setEditTimes([...med.times]);
    setEditMealSchedules({ ...med.meal_schedules });
  };

  const handleEditSave = () => {
    const trimmed = editName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (editTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const savedId = editingMedId;

    const schedules: MealSchedules = {};
    editTimes.forEach((t) => {
      schedules[t] = editMealSchedules[t] ?? DEFAULT_TIMES[t];
    });

    setMedications((prev) =>
      prev.map((m) =>
        m.id === savedId
          ? { ...m, name: trimmed, dosage: editDosage.trim(), times: editTimes, meal_schedules: schedules, drugInfo: undefined }
          : m
      )
    );
    setEditingMedId(null);
    setEditName('');
    setEditDosage('');
    setEditTimes([]);
    setEditMealSchedules({});

    // 백그라운드 식약처 재조회
    searchMfdsInfo(trimmed).then((drugInfo) => {
      setMedications((prev) =>
        prev.map((m) => m.id === savedId ? { ...m, drugInfo: drugInfo ?? null } : m)
      );
    });
  };

  const handleEditCancel = () => {
    setEditingMedId(null);
    setEditName('');
    setEditDosage('');
    setEditTimes([]);
    setEditMealSchedules({});
  };

  const handleNext = async () => {
    if (medications.length > 0) {
      await AsyncStorage.setItem('onboarding_medications', JSON.stringify(medications));
    }
    navigation.navigate('NotificationSetup');
  };

  if (mode === 'manual') {
    return (
      <SafeAreaView style={styles.container}>
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          {/* 헤더 */}
          <View style={styles.header}>
            <TouchableOpacity style={styles.backBtn} onPress={() => setMode('home')} activeOpacity={0.7}>
              <Text style={styles.backIcon}>←</Text>
              <Text style={styles.backText}>뒤로</Text>
            </TouchableOpacity>
          </View>

          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.title}>약을 등록해드릴게요</Text>
            <Text style={styles.subtitle}>
              약 이름을 입력하고 복용 시간대를 선택해주세요
            </Text>

            {/* 약 입력 영역 */}
            <View style={styles.inputCard}>
              {/* 약 이름 */}
              <TextInput
                style={styles.medInput}
                value={medName}
                onChangeText={(v) => {
                  setMedName(v);
                  // 이름 변경 시 식약처 결과 초기화
                  setMfdsResult(null);
                  setMfdsCompany('');
                  setPendingDrugInfo(undefined);
                }}
                placeholder="약 이름 입력 (예: 시네메트)"
                placeholderTextColor={Colors.textHint}
                returnKeyType="next"
              />

              {/* 복용량 */}
              <TextInput
                style={styles.dosageInput}
                value={medDosage}
                onChangeText={setMedDosage}
                placeholder="예) 1정, 0.5정"
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
              />

              {/* 식약처 정보 불러오기 버튼 */}
              <TouchableOpacity
                style={[styles.mfdsBtn, mfdsLoading && styles.mfdsBtnLoading]}
                onPress={handleMfdsSearch}
                activeOpacity={0.85}
                disabled={mfdsLoading}
              >
                {mfdsLoading ? (
                  <ActivityIndicator size="small" color={Colors.primary} />
                ) : (
                  <Text style={styles.mfdsBtnText}>식약처 정보 불러오기</Text>
                )}
              </TouchableOpacity>

              {/* 식약처 조회 결과 */}
              {mfdsResult === 'found' && (
                <Text style={styles.mfdsFound}>식약처 정보 확인됨{mfdsCompany ? ` (${mfdsCompany})` : ''}</Text>
              )}
              {mfdsResult === 'not_found' && (
                <Text style={styles.mfdsNotFound}>식약처 정보 없음</Text>
              )}

              <Text style={styles.inputLabel}>복용 시간대</Text>
              <TimeSlotsEditor
                selectedTimes={selectedTimes}
                mealSchedules={mealSchedules}
                onToggleTime={toggleTime}
                onSetScheduleTime={setScheduleTime}
              />

              <TouchableOpacity
                style={[styles.addBtn, (!medName.trim() || selectedTimes.length === 0) && styles.addBtnDisabled]}
                onPress={handleAddMed}
                activeOpacity={0.85}
              >
                <Text style={[styles.addBtnText, (!medName.trim() || selectedTimes.length === 0) && styles.addBtnTextDisabled]}>+ 추가</Text>
              </TouchableOpacity>
            </View>

            {/* 등록된 약 리스트 */}
            {medications.length > 0 && (
              <View style={styles.medList}>
                <Text style={styles.medListTitle}>등록된 약 ({medications.length}개)</Text>
                {medications.map((med) => {
                  const isEditing = editingMedId === med.id;

                  if (isEditing) {
                    return (
                      <View key={med.id} style={styles.medItemEditing}>
                        <TextInput
                          style={styles.editNameInput}
                          value={editName}
                          onChangeText={setEditName}
                          placeholder="약 이름"
                          placeholderTextColor={Colors.textHint}
                          returnKeyType="next"
                          autoFocus
                        />
                        <TextInput
                          style={styles.editDosageInput}
                          value={editDosage}
                          onChangeText={setEditDosage}
                          placeholder="예) 1정, 0.5정"
                          placeholderTextColor={Colors.textHint}
                          returnKeyType="done"
                        />
                        <Text style={styles.inputLabel}>복용 시간대</Text>
                        <TimeSlotsEditor
                          selectedTimes={editTimes}
                          mealSchedules={editMealSchedules}
                          onToggleTime={toggleEditTime}
                          onSetScheduleTime={setEditScheduleTime}
                        />
                        <View style={styles.editActionRow}>
                          <TouchableOpacity
                            style={styles.editCancelBtn}
                            onPress={handleEditCancel}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.editCancelBtnText}>취소</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={styles.editSaveBtn}
                            onPress={handleEditSave}
                            activeOpacity={0.85}
                          >
                            <Text style={styles.editSaveBtnText}>저장</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    );
                  }

                  // 일반 표시 모드
                  return (
                    <View key={med.id} style={styles.medItem}>
                      {/* 왼쪽: 약 이미지 또는 이모지 */}
                      {med.drugInfo?.itemImage ? (
                        <Image
                          source={{ uri: med.drugInfo.itemImage }}
                          style={styles.medThumbnail}
                          resizeMode="cover"
                        />
                      ) : (
                        <View style={styles.medThumbnailPlaceholder}>
                                </View>
                      )}

                      {/* 중앙: 약 이름(탭→모달) + 복용량 + 복용시간 + 식약처 상태 */}
                      <View style={styles.medItemInfo}>
                        <TouchableOpacity
                          onPress={() => setSelectedDrug(med)}
                          activeOpacity={0.7}
                          style={styles.medNameRow}
                        >
                          <Text style={styles.medName}>{med.name}</Text>
                          <Text style={styles.medInfoIndicator}>정보</Text>
                        </TouchableOpacity>
                        {!!med.dosage && (
                          <Text style={styles.medDosage}>{med.dosage}</Text>
                        )}
                        <Text style={styles.medTimes}>
                          {med.times.map((t) => {
                            const slot = TIME_SLOTS.find((s) => s.key === t);
                            const time = med.meal_schedules[t];
                            return `${slot?.label ?? t}${time ? ` ${time}` : ''}`;
                          }).join(' · ')}
                        </Text>
                        {med.drugInfo === null && (
                          <Text style={styles.medNoInfoBadge}>식약처 정보 없음 · 이름 확인 필요</Text>
                        )}
                      </View>

                      {/* 오른쪽: 수정/삭제 버튼 (수직) */}
                      <View style={styles.medItemActions}>
                        <TouchableOpacity
                          style={styles.editBtn}
                          onPress={() => handleEditStart(med)}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <Text style={styles.editBtnText}>수정</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={styles.deleteBtn}
                          onPress={() => handleDeleteMed(med.id)}
                          hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
                        >
                          <Text style={styles.deleteBtnText}>삭제</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })}
              </View>
            )}
          </ScrollView>

          <View style={styles.bottomArea}>
            <PrimaryButton
              title={medications.length > 0 ? `다음으로 (${medications.length}개 등록)` : '다음으로'}
              onPress={handleNext}
              disabled={medications.length === 0}
            />
            <Text style={{ fontSize: 18, color: Colors.textSub, textAlign: 'center', marginBottom: 12 }}>약은 나중에 등록하셔도 되요</Text>
            <TouchableOpacity style={styles.closeBtn} onPress={handleCompleteOnboarding}>
              <Text style={styles.closeBtnText}>나중에 등록하기</Text>
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>

        {/* 약 상세 정보 모달 */}
        <DrugInfoModal drug={selectedDrug} onClose={() => setSelectedDrug(null)} />
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>약을 등록해드릴게요</Text>
        <Text style={styles.subtitle}>
          처방전 사진을 찍으면{'\n'}자동으로 입력해드려요
        </Text>

        <View style={styles.homeCards}>
          <TouchableOpacity
            style={styles.homeCard}
            onPress={handleOcrPress}
            activeOpacity={0.85}
          >
            <View>
              <Text style={styles.homeCardLabel}>처방전 사진으로 등록하기</Text>
              <Text style={styles.homeCardDesc}>사진 한 장으로 자동 입력돼요</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.homeCard}
            onPress={() => setMode('manual')}
            activeOpacity={0.85}
          >
            <View>
              <Text style={styles.homeCardLabel}>직접 입력하기</Text>
              <Text style={styles.homeCardDesc}>약 이름과 복용 시간을 직접 입력해요</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bottomArea}>
        <Text style={{ fontSize: 18, color: Colors.textSub, textAlign: 'center', marginBottom: 12 }}>약은 나중에 등록하셔도 되요</Text>
        <TouchableOpacity style={styles.closeBtn} onPress={handleCompleteOnboarding}>
          <Text style={styles.closeBtnText}>나중에 등록하기</Text>
        </TouchableOpacity>
      </View>

      {/* OCR 로딩 오버레이 */}
      {isOcrLoading && (
        <View style={styles.ocrOverlay}>
          <View style={styles.ocrOverlayCard}>
            <ActivityIndicator size="large" color={Colors.primary} />
            <Text style={styles.ocrOverlayText}>처방전 분석 중...</Text>
            <Text style={styles.ocrOverlaySubText}>잠시만 기다려주세요</Text>
          </View>
        </View>
      )}

      <DrugInfoModal drug={selectedDrug} onClose={() => setSelectedDrug(null)} />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  backIcon: {
    fontSize: 22,
    color: Colors.text,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
  },
  content: {
    flex: 1,
    paddingHorizontal: 24,
    justifyContent: 'center',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    marginBottom: 36,
    lineHeight: 28,
    textAlign: 'center',
  },
  homeCards: {
    gap: 16,
  },
  homeCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 24,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 18,
    minHeight: 80,
  },
  homeCardLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  homeCardDesc: {
    fontSize: 18,
    color: Colors.textSub,
  },
  inputCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    gap: 14,
  },
  medInput: {
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: Colors.text,
    backgroundColor: Colors.white,
    minHeight: 56,
  },
  dosageInput: {
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: Colors.text,
    backgroundColor: Colors.white,
    minHeight: 56,
  },
  mfdsBtn: {
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
    backgroundColor: Colors.white,
  },
  mfdsBtnLoading: {
    borderColor: Colors.border,
  },
  mfdsBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
  mfdsFound: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.dark,
    paddingHorizontal: 4,
  },
  mfdsNotFound: {
    fontSize: 16,
    fontWeight: '600',
    color: '#E65100',
    paddingHorizontal: 4,
  },
  inputLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginTop: 4,
  },
  addBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 10,
    paddingVertical: 14,
    alignItems: 'center',
    minHeight: 56,
    justifyContent: 'center',
  },
  addBtnDisabled: {
    backgroundColor: Colors.border,
  },
  addBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  addBtnTextDisabled: {
    color: '#666666',
  },
  medList: {
    gap: 10,
  },
  medListTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  medItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    gap: 12,
  },
  medItemEditing: {
    backgroundColor: Colors.white,
    borderRadius: 12,
    padding: 16,
    borderWidth: 2,
    borderColor: Colors.primary,
    gap: 12,
  },
  medThumbnail: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#F5F5F5',
  },
  medThumbnailPlaceholder: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
  },
  medItemInfo: {
    flex: 1,
  },
  medNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  medName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  medInfoIndicator: {
    fontSize: 16,
  },
  medDosage: {
    fontSize: 15,
    fontWeight: '600',
    color: Colors.primary,
    marginBottom: 2,
  },
  medTimes: {
    fontSize: 14,
    color: Colors.textSub,
  },
  medNoInfoBadge: {
    fontSize: 12,
    color: '#E65100',
    marginTop: 3,
    fontWeight: '600',
  },
  medItemActions: {
    flexDirection: 'column',
    gap: 6,
    alignItems: 'center',
  },
  editBtn: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E3F2FD',
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 56,
    gap: 2,
  },
  editBtnIcon: {
    fontSize: 16,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1976D2',
  },
  deleteBtn: {
    flexDirection: 'column',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFEBEE',
    minHeight: 56,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 56,
    gap: 2,
  },
  deleteBtnIcon: {
    fontSize: 16,
  },
  deleteBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: Colors.danger,
  },
  editNameInput: {
    borderWidth: 2,
    borderColor: Colors.primary,
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: Colors.text,
    backgroundColor: Colors.white,
    minHeight: 56,
  },
  editDosageInput: {
    borderWidth: 2,
    borderColor: Colors.border,
    borderRadius: 10,
    padding: 14,
    fontSize: 18,
    color: Colors.text,
    backgroundColor: Colors.white,
    minHeight: 56,
  },
  editActionRow: {
    flexDirection: 'row',
    gap: 10,
  },
  editCancelBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  editCancelBtnText: {
    fontSize: 18,
    fontWeight: '600',
    color: Colors.textSub,
  },
  editSaveBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
  },
  editSaveBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.white,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  closeBtn: {
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
  ocrOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.6)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 100,
  },
  ocrOverlayCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    paddingVertical: 40,
    paddingHorizontal: 48,
    alignItems: 'center',
    gap: 16,
    minWidth: 240,
  },
  ocrOverlayText: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
  },
  ocrOverlaySubText: {
    fontSize: 18,
    color: Colors.textSub,
    textAlign: 'center',
  },
});
