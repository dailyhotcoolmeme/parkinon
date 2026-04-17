import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Image,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import * as ImagePicker from 'expo-image-picker';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system/legacy';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { uploadPhoto } from '../../lib/r2Upload';

type NavProp = StackNavigationProp<MenuStackParamList>;
type RouteType = RouteProp<{ MedicalRecordWrite: { recordId?: string } }, 'MedicalRecordWrite'>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

// ─── 날짜/시간 피커 ──────────────────────────────────────────────────────────
const ITEM_H = 58;
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;
const CUR_DAY = NOW.getDate();
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];

const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => CUR_YEAR - 9 + i); // 과거 9년~올해
const PICKER_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const PICKER_HOURS = Array.from({ length: 24 }, (_, i) => i);
const PICKER_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getDayOfWeek(y: number, m: number, d: number) { return DAYS_KR[new Date(y, m - 1, d).getDay()]; }

function PickerCol({
  data, selected, onSelect, suffix, padLen = 0, getLabel, fontSize = 20,
}: {
  data: number[]; selected: number; onSelect: (v: number) => void;
  suffix: string; padLen?: number; getLabel?: (v: number) => string; fontSize?: number;
}) {
  const ref = useRef<FlatList<number>>(null);
  const selectedIndex = Math.max(0, data.indexOf(selected));

  useEffect(() => {
    if (ref.current) ref.current.scrollToOffset({ offset: selectedIndex * ITEM_H, animated: false });
  }, [selected, selectedIndex]);

  return (
    <View style={{ flex: 1 }}>
      <FlatList<number>
        ref={ref}
        data={data}
        keyExtractor={(item) => String(item)}
        initialScrollIndex={selectedIndex}
        getItemLayout={(_, index) => ({ length: ITEM_H, offset: ITEM_H * index, index })}
        showsVerticalScrollIndicator={false}
        onScrollToIndexFailed={() => {}}
        onLayout={() => {
          if (ref.current) ref.current.scrollToOffset({ offset: selectedIndex * ITEM_H, animated: false });
        }}
        renderItem={({ item }) => {
          const isSelected = item === selected;
          const label = getLabel
            ? getLabel(item)
            : padLen > 0 ? String(item).padStart(padLen, '0') + suffix : String(item) + suffix;
          return (
            <TouchableOpacity
              style={[colStyles.item, isSelected && colStyles.itemActive]}
              onPress={() => onSelect(item)}
              activeOpacity={0.7}
            >
              <Text style={[colStyles.itemText, { fontSize }, isSelected && colStyles.itemTextActive]}>
                {label}
              </Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
}

function DatePickerModal({
  visible, year, month, day,
  onYearChange, onMonthChange, onDayChange, onConfirm, onClose,
}: {
  visible: boolean; year: number; month: number; day: number;
  onYearChange: (v: number) => void; onMonthChange: (v: number) => void;
  onDayChange: (v: number) => void; onConfirm: () => void; onClose: () => void;
}) {
  // 오늘 이후 날짜 선택 불가
  const availableMonths = year === CUR_YEAR
    ? PICKER_MONTHS.filter(m => m <= CUR_MONTH)
    : PICKER_MONTHS;
  const maxDayInMonth = year === CUR_YEAR && month === CUR_MONTH
    ? Math.min(getDaysInMonth(year, month), CUR_DAY)
    : getDaysInMonth(year, month);
  const days = Array.from({ length: maxDayInMonth }, (_, i) => i + 1);

  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={mpStyles.container}>
        <TouchableOpacity style={mpStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={mpStyles.sheet}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>날짜 선택</Text>
          <View style={mpStyles.colsRow}>
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>년도</Text>
              <PickerCol data={PICKER_YEARS} selected={year} onSelect={onYearChange} suffix="년" fontSize={19} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 3 }}>
              <Text style={mpStyles.colHeader}>월</Text>
              <PickerCol data={availableMonths} selected={month} onSelect={onMonthChange} suffix="월" fontSize={19} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>일</Text>
              <PickerCol
                data={days} selected={day} onSelect={onDayChange} suffix="일" fontSize={18}
                getLabel={(d) => `${d}일 (${getDayOfWeek(year, month, d)})`}
              />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>선택 완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

function TimePickerModal({
  visible, hour, minute,
  onHourChange, onMinuteChange, onConfirm, onClose,
}: {
  visible: boolean; hour: number; minute: number;
  onHourChange: (v: number) => void; onMinuteChange: (v: number) => void;
  onConfirm: () => void; onClose: () => void;
}) {
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={mpStyles.container}>
        <TouchableOpacity style={mpStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={mpStyles.sheet}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>시간 선택</Text>
          <View style={mpStyles.colsRow}>
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>시</Text>
              <PickerCol data={PICKER_HOURS} selected={hour} onSelect={onHourChange} suffix="시" padLen={2} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>분</Text>
              <PickerCol data={PICKER_MINUTES} selected={minute} onSelect={onMinuteChange} suffix="분" padLen={2} />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>선택 완료</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ─── OCR ─────────────────────────────────────────────────────────────────────
interface OcrMed { name: string; dosage?: string; }
interface PrevMed { name: string; dosage?: string; }

async function callClaudeOCR(base64Image: string, mediaType: string): Promise<{ medications: OcrMed[] }> {
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
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64Image } },
          {
            type: 'text',
            text: `이 처방전 사진에서 약 이름과 용량을 추출해주세요.
규칙:
- 사진에 명확하게 보이는 약 이름만 추출하세요.
- 약 이름은 사진에 적힌 그대로 정확히 읽어주세요.
- 처방전이면: 약품명 컬럼에서 읽으세요.
- 용량(mg, mcg, 정 등)이 명확히 표시된 경우 dosage에 포함하세요.
- 개인정보(이름, 주민번호 등)는 무시하세요.
반드시 아래 JSON 형식으로만 응답하세요 (다른 텍스트 없이):
{"medications":[{"name":"약 이름","dosage":"용량 또는 빈 문자열"}]}
약이 보이지 않거나 읽기 어려우면 {"medications":[]} 를 반환하세요.`,
          },
        ],
      }],
    }),
  });
  if (!response.ok) throw new Error(`API 오류: ${response.status}`);
  const data = await response.json();
  const text: string = data.content[0].text;
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  return JSON.parse(cleaned) as { medications: OcrMed[] };
}

function computeChangeType(
  medName: string, medDosage: string | undefined, prevMeds: PrevMed[],
): 'added' | 'changed' | 'unchanged' {
  const prev = prevMeds.find(
    p => p.name.replace(/\s/g, '').toLowerCase() === medName.replace(/\s/g, '').toLowerCase()
  );
  if (!prev) return 'added';
  if (medDosage && prev.dosage && medDosage !== prev.dosage) return 'changed';
  return 'unchanged';
}

// ─── 메인 컴포넌트 ─────────────────────────────────────────────────────────────
export function MedicalRecordWriteScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteType>();
  const recordId = (route.params as any)?.recordId as string | undefined;
  const { user } = useAuth();

  // 날짜/시간 상태 (기본: 오늘 오전 9시)
  const [selYear, setSelYear] = useState(NOW.getFullYear());
  const [selMonth, setSelMonth] = useState(NOW.getMonth() + 1);
  const [selDay, setSelDay] = useState(NOW.getDate());
  const [selHour, setSelHour] = useState(9);
  const [selMinute, setSelMinute] = useState(0);

  const [tmpYear, setTmpYear] = useState(selYear);
  const [tmpMonth, setTmpMonth] = useState(selMonth);
  const [tmpDay, setTmpDay] = useState(selDay);
  const [tmpHour, setTmpHour] = useState(selHour);
  const [tmpMinute, setTmpMinute] = useState(selMinute);

  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);

  const [hospitalName, setHospitalName] = useState('');
  const [doctorName, setDoctorName] = useState('');
  const [consultationNotes, setConsultationNotes] = useState('');
  const [prescriptionImageUri, setPrescriptionImageUri] = useState<string | null>(null);
  const [ocrMeds, setOcrMeds] = useState<OcrMed[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);
  const [isFirstRecord, setIsFirstRecord] = useState(false);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? SUPABASE_ANON_KEY;
  };

  // 월/연도 바뀌면 일·월 클램프 (미래 날짜 방지)
  useEffect(() => {
    const effectiveMaxMonth = tmpYear === CUR_YEAR ? CUR_MONTH : 12;
    const clampedMonth = Math.min(tmpMonth, effectiveMaxMonth);
    if (clampedMonth !== tmpMonth) { setTmpMonth(clampedMonth); return; }

    const maxDay = getDaysInMonth(tmpYear, tmpMonth);
    const effectiveMaxDay = tmpYear === CUR_YEAR && tmpMonth === CUR_MONTH
      ? Math.min(maxDay, CUR_DAY) : maxDay;
    if (tmpDay > effectiveMaxDay) setTmpDay(effectiveMaxDay);
  }, [tmpYear, tmpMonth]);

  // 신규: 이전 진료 기록에서 병원/의사 자동완성
  useEffect(() => {
    if (recordId || !user) return;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?patient_id=eq.${user.id}&order=visit_date.desc&limit=1`,
          { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
        );
        if (res.ok) {
          const data = await res.json();
          if (data.length > 0) {
            if (data[0].hospital_name) setHospitalName(data[0].hospital_name);
            if (data[0].doctor_name) setDoctorName(data[0].doctor_name);
          } else {
            setIsFirstRecord(true);
          }
        }
      } catch {}
    })();
  }, [user, recordId]);

  // 수정 모드: 기존 데이터 로드
  useEffect(() => {
    if (!recordId || !user) return;
    (async () => {
      setIsLoadingEdit(true);
      try {
        const token = await getToken();
        const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}&select=*,medical_record_medications(*)`,
          { headers },
        );
        if (!res.ok) throw new Error('데이터 로드 실패');
        const data = await res.json();
        if (data.length > 0) {
          const rec = data[0];
          const d = new Date(rec.visit_date);
          setSelYear(d.getFullYear());
          setSelMonth(d.getMonth() + 1);
          setSelDay(d.getDate());
          setSelHour(d.getHours());
          setSelMinute(Math.round(d.getMinutes() / 5) * 5 % 60);
          setHospitalName(rec.hospital_name ?? '');
          setDoctorName(rec.doctor_name ?? '');
          setConsultationNotes(rec.consultation_notes ?? '');
          if (rec.prescription_image_url) setPrescriptionImageUri(rec.prescription_image_url);
          if (rec.medical_record_medications?.length > 0) {
            setOcrMeds(rec.medical_record_medications.map((m: any) => ({
              name: m.medication_name,
              dosage: m.dosage ?? '',
            })));
          }
        }
      } catch (e: any) {
        Alert.alert('오류', e.message ?? '데이터를 불러오지 못했어요.');
      } finally {
        setIsLoadingEdit(false);
      }
    })();
  }, [recordId, user]);

  const openDatePicker = () => {
    setTmpYear(selYear); setTmpMonth(selMonth); setTmpDay(selDay);
    setShowDatePicker(true);
  };
  const openTimePicker = () => {
    setTmpHour(selHour); setTmpMinute(selMinute);
    setShowTimePicker(true);
  };
  const confirmDate = () => {
    const maxDay = getDaysInMonth(tmpYear, tmpMonth);
    setSelYear(tmpYear); setSelMonth(tmpMonth); setSelDay(Math.min(tmpDay, maxDay));
    setShowDatePicker(false);
  };
  const confirmTime = () => {
    setSelHour(tmpHour); setSelMinute(tmpMinute);
    setShowTimePicker(false);
  };

  const dow = getDayOfWeek(selYear, selMonth, selDay);
  const displayDate = `${selYear}년 ${selMonth}월 ${selDay}일 (${dow})`;
  const displayTime = `${String(selHour).padStart(2, '0')}시 ${String(selMinute).padStart(2, '0')}분`;

  // 처방전 이미지 선택 → OCR
  const pickAndOcr = async (fromCamera: boolean) => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert('권한 필요', '카메라 권한이 필요해요.'); return; }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') { Alert.alert('권한 필요', '사진 라이브러리 권한이 필요해요.'); return; }
        result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      }
      if (result.canceled || !result.assets?.[0]) return;
      const asset = result.assets[0];

      // 사진 압축: quality 0.7, maxWidth 1280px
      const compressed = await ImageManipulator.manipulateAsync(
        asset.uri,
        [{ resize: { width: 1280 } }],
        { compress: 0.7, format: ImageManipulator.SaveFormat.JPEG }
      );
      const compressedUri = compressed.uri;

      setPrescriptionImageUri(compressedUri);
      setIsOcrLoading(true);
      const base64 = await FileSystem.readAsStringAsync(compressedUri, { encoding: FileSystem.EncodingType.Base64 });
      const ocrResult = await callClaudeOCR(base64, 'image/jpeg');
      setOcrMeds(ocrResult.medications);
      if (ocrResult.medications.length === 0) Alert.alert('알림', '처방전에서 약 이름을 찾지 못했어요.\n직접 확인해 주세요.');
    } catch (e: any) {
      Alert.alert('오류', e.message ?? 'OCR 처리 중 오류가 발생했어요.');
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;

    const visitDateISO = new Date(selYear, selMonth - 1, selDay, selHour, selMinute).toISOString();

    setIsSaving(true);
    try {
      const token = await getToken();
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        Prefer: 'return=representation',
      };

      // 처방전 이미지 R2 업로드
      let prescriptionUrl: string | null = null;
      if (prescriptionImageUri && !prescriptionImageUri.startsWith('http')) {
        const uploadResult = await uploadPhoto(prescriptionImageUri, user.id);
        prescriptionUrl = uploadResult.url;
      } else if (prescriptionImageUri?.startsWith('http')) {
        prescriptionUrl = prescriptionImageUri;
      }

      let savedRecordId: string;

      if (recordId) {
        // UPDATE
        const updateRes = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}`,
          {
            method: 'PATCH', headers,
            body: JSON.stringify({
              visit_date: visitDateISO,
              hospital_name: hospitalName.trim() || null,
              doctor_name: doctorName.trim() || null,
              consultation_notes: consultationNotes.trim() || null,
              prescription_image_url: prescriptionUrl,
            }),
          },
        );
        if (!updateRes.ok) throw new Error('진료 기록 수정에 실패했어요.');
        savedRecordId = recordId;

        // 기존 medications 삭제 후 재삽입
        await fetch(
          `${SUPABASE_URL}/rest/v1/medical_record_medications?medical_record_id=eq.${recordId}`,
          { method: 'DELETE', headers },
        );
      } else {
        // INSERT
        const insertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records`,
          {
            method: 'POST', headers,
            body: JSON.stringify({
              patient_id: user.id,
              visit_date: visitDateISO,
              hospital_name: hospitalName.trim() || null,
              doctor_name: doctorName.trim() || null,
              consultation_notes: consultationNotes.trim() || null,
              prescription_image_url: prescriptionUrl,
            }),
          },
        );
        if (!insertRes.ok) throw new Error('진료 기록 저장에 실패했어요.');
        const inserted = await insertRes.json();
        savedRecordId = Array.isArray(inserted) ? inserted[0].id : inserted.id;
      }

      // 직전 기록의 처방약 조회 (change_type 비교용)
      const prevRes = await fetch(
        `${SUPABASE_URL}/rest/v1/medical_records?patient_id=eq.${user.id}&visit_date=lt.${visitDateISO}&order=visit_date.desc&limit=1&select=id`,
        { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
      );
      let prevMeds: PrevMed[] = [];
      if (prevRes.ok) {
        const prevRecs = await prevRes.json();
        if (prevRecs.length > 0) {
          const prevMedRes = await fetch(
            `${SUPABASE_URL}/rest/v1/medical_record_medications?medical_record_id=eq.${prevRecs[0].id}`,
            { headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` } },
          );
          if (prevMedRes.ok) {
            const prevMedData = await prevMedRes.json();
            prevMeds = prevMedData.map((m: any) => ({ name: m.medication_name, dosage: m.dosage ?? '' }));
          }
        }
      }

      const currentNames = ocrMeds.map(m => m.name.replace(/\s/g, '').toLowerCase());
      const removedMeds = prevMeds.filter(p => !currentNames.includes(p.name.replace(/\s/g, '').toLowerCase()));

      const medsToInsert = [
        ...ocrMeds.map(m => ({
          medical_record_id: savedRecordId,
          medication_name: m.name,
          dosage: m.dosage || null,
          change_type: computeChangeType(m.name, m.dosage, prevMeds),
        })),
        ...removedMeds.map(p => ({
          medical_record_id: savedRecordId,
          medication_name: p.name,
          dosage: p.dosage || null,
          change_type: 'removed',
        })),
      ];

      if (medsToInsert.length > 0) {
        const medInsertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_record_medications`,
          { method: 'POST', headers, body: JSON.stringify(medsToInsert) },
        );
        if (!medInsertRes.ok) console.warn('처방약 저장 실패:', await medInsertRes.text());
      }

      Alert.alert('저장 완료', '진료 기록이 저장되었어요.', [
        { text: '확인', onPress: () => navigation.goBack() },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장에 실패했어요.');
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingEdit) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar title={recordId ? '진료 기록 수정' : '진료 기록 추가'} showBack />
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title={recordId ? '진료 기록 수정' : '진료 기록 추가'} showBack />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">

          {/* 진료 날짜 */}
          <Text style={styles.label}>진료 날짜</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openDatePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>📅  {displayDate}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 진료 시간 */}
          <Text style={styles.label}>진료 시간</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openTimePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>🕐  {displayTime}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 처음 등록 안내 */}
          {isFirstRecord && (
            <View style={styles.hintCard}>
              <Text style={styles.hintText}>
                💡 병원명과 의사명을 한 번만 입력하면{'\n'}다음부터는 자동으로 불러와요
              </Text>
            </View>
          )}

          {/* 병원명 */}
          <Text style={styles.label}>병원명</Text>
          <TextInput
            style={styles.input}
            placeholder="예) 한강성심병원"
            placeholderTextColor={Colors.textHint}
            value={hospitalName}
            onChangeText={setHospitalName}
            maxLength={50}
          />

          {/* 의사명 */}
          <Text style={styles.label}>의사명</Text>
          <TextInput
            style={styles.input}
            placeholder="예) 김민준"
            placeholderTextColor={Colors.textHint}
            value={doctorName}
            onChangeText={setDoctorName}
            maxLength={30}
          />

          {/* 상담 내용 */}
          <Text style={styles.label}>상담 내용</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder="상담 내용을 입력하세요 (최대 500자)"
            placeholderTextColor={Colors.textHint}
            value={consultationNotes}
            onChangeText={t => setConsultationNotes(t.slice(0, 500))}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{consultationNotes.length}/500</Text>

          {/* 처방전 등록 */}
          <Text style={[styles.label, { marginTop: 8 }]}>처방전 등록</Text>
          <View style={styles.prescriptionBtnRow}>
            <TouchableOpacity
              style={styles.prescriptionBtn}
              onPress={() => pickAndOcr(true)}
              activeOpacity={0.8}
              disabled={isOcrLoading}
            >
              <Ionicons name="camera-outline" size={22} color={Colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.prescriptionBtnText}>카메라로 촬영</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.prescriptionBtn}
              onPress={() => pickAndOcr(false)}
              activeOpacity={0.8}
              disabled={isOcrLoading}
            >
              <Ionicons name="images-outline" size={22} color={Colors.primary} style={{ marginRight: 6 }} />
              <Text style={styles.prescriptionBtnText}>갤러리 선택</Text>
            </TouchableOpacity>
          </View>

          {prescriptionImageUri ? (
            <Image source={{ uri: prescriptionImageUri }} style={styles.prescriptionPreview} resizeMode="contain" />
          ) : null}

          {isOcrLoading ? (
            <View style={styles.ocrLoading}>
              <ActivityIndicator size="large" color={Colors.primary} />
              <Text style={styles.ocrLoadingText}>처방전 분석 중...</Text>
            </View>
          ) : null}

          {ocrMeds.length > 0 ? (
            <View style={styles.ocrResult}>
              <Text style={styles.ocrResultTitle}>인식된 처방약 목록</Text>
              {ocrMeds.map((m, i) => (
                <View key={i} style={styles.ocrMedRow}>
                  <Text style={styles.ocrMedName}>{m.name}</Text>
                  {m.dosage ? <Text style={styles.ocrMedDosage}>{m.dosage}</Text> : null}
                </View>
              ))}
            </View>
          ) : null}

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={isSaving}
          >
            {isSaving
              ? <ActivityIndicator size="small" color={Colors.white} />
              : <Text style={styles.saveBtnText}>저장하기</Text>
            }
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <DatePickerModal
        visible={showDatePicker}
        year={tmpYear} month={tmpMonth} day={tmpDay}
        onYearChange={setTmpYear} onMonthChange={setTmpMonth} onDayChange={setTmpDay}
        onConfirm={confirmDate} onClose={() => setShowDatePicker(false)}
      />
      <TimePickerModal
        visible={showTimePicker}
        hour={tmpHour} minute={tmpMinute}
        onHourChange={setTmpHour} onMinuteChange={setTmpMinute}
        onConfirm={confirmTime} onClose={() => setShowTimePicker(false)}
      />
    </SafeAreaView>
  );
}

// ─── 스타일 ──────────────────────────────────────────────────────────────────
const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scroll: { padding: 20, paddingBottom: 40 },
  label: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 8, marginTop: 20 },
  pickerBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1.5,
    borderColor: Colors.primary, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56,
  },
  pickerBtnText: { fontSize: 18, color: Colors.text, fontWeight: '600' },
  pickerArrow: { fontSize: 14, color: Colors.textSub },
  hintCard: {
    backgroundColor: '#FFF8E1', borderRadius: 10, borderWidth: 1,
    borderColor: '#FFE082', padding: 14, marginTop: 16,
  },
  hintText: { fontSize: 16, color: '#7B5800', lineHeight: 24 },
  input: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 1.5,
    borderColor: Colors.border, paddingHorizontal: 16, paddingVertical: 14,
    fontSize: 18, color: Colors.text, minHeight: 56,
  },
  multilineInput: { minHeight: 120, paddingTop: 14 },
  charCount: { fontSize: 14, color: Colors.textHint, textAlign: 'right', marginTop: 4 },
  prescriptionBtnRow: { flexDirection: 'row', gap: 12 },
  prescriptionBtn: {
    flex: 1, backgroundColor: Colors.white, borderWidth: 1.5,
    borderColor: Colors.primary, borderRadius: 12, minHeight: 56,
    alignItems: 'center', justifyContent: 'center',
    flexDirection: 'row',
  },
  prescriptionBtnText: { fontSize: 17, fontWeight: '700', color: Colors.primary },
  prescriptionPreview: { width: '100%', height: 200, borderRadius: 12, marginTop: 16, backgroundColor: Colors.border },
  ocrLoading: { alignItems: 'center', paddingVertical: 20 },
  ocrLoadingText: { fontSize: 17, color: Colors.textSub, marginTop: 10 },
  ocrResult: { backgroundColor: Colors.light, borderRadius: 12, padding: 16, marginTop: 16 },
  ocrResultTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 10 },
  ocrMedRow: {
    flexDirection: 'row', justifyContent: 'space-between',
    paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  ocrMedName: { fontSize: 17, color: Colors.text, flex: 1 },
  ocrMedDosage: { fontSize: 16, color: Colors.textSub },
  saveBtn: {
    backgroundColor: Colors.primary, borderRadius: 14, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 32,
  },
  saveBtnDisabled: { backgroundColor: Colors.textHint },
  saveBtnText: { fontSize: 19, fontWeight: '700', color: Colors.white },
});

const colStyles = StyleSheet.create({
  item: {
    height: ITEM_H, justifyContent: 'center', alignItems: 'center',
    borderRadius: 8, marginHorizontal: 3, marginVertical: 1,
  },
  itemActive: { backgroundColor: Colors.light },
  itemText: { color: Colors.text },
  itemTextActive: { color: Colors.primary, fontWeight: '700' },
});

const mpStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white, borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 16, paddingBottom: 40,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 16 },
  title: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 8, textAlign: 'center' },
  colHeader: {
    fontSize: 15, fontWeight: '600', color: Colors.textSub, textAlign: 'center',
    paddingBottom: 6, borderBottomWidth: 1, borderBottomColor: Colors.border, marginBottom: 4,
  },
  colsRow: { flexDirection: 'row', height: 290 },
  colDivider: { width: 1, backgroundColor: Colors.border, marginVertical: 8 },
  confirmBtn: {
    backgroundColor: Colors.primary, borderRadius: 12, minHeight: 56,
    alignItems: 'center', justifyContent: 'center', marginTop: 20,
  },
  confirmText: { fontSize: 18, fontWeight: '700', color: Colors.white },
});
