import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Keyboard,
  Platform,
  Image,
  Modal,
  FlatList,
  Switch,
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
import { BrandProgressOverlay } from '../../components/common/BrandProgressOverlay';
import { HangingText } from '../../components/common/HangingText';
import { useAuth } from '../../context/AuthContext';
import { usePatientId } from '../../hooks/usePatientId';
import { supabase } from '../../lib/supabase';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import i18n from '../../i18n';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { weekdayShort } from '../../utils/dateLabels';
import { useTranslation } from 'react-i18next';


type NavProp = StackNavigationProp<MenuStackParamList>;
type RouteType = RouteProp<{ MedicalRecordWrite: { recordId?: string } }, 'MedicalRecordWrite'>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

// ─── 날짜/시간 피커 ──────────────────────────────────────────────────────────
const ITEM_H = 58;
const NOW = new Date();
const CUR_YEAR = NOW.getFullYear();
const CUR_MONTH = NOW.getMonth() + 1;
const CUR_DAY = NOW.getDate();
const DAYS_KR = ['일', '월', '화', '수', '목', '금', '토'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

const PICKER_YEARS = Array.from({ length: 10 }, (_, i) => CUR_YEAR - 9 + i); // 과거 9년~올해
const PICKER_MONTHS = Array.from({ length: 12 }, (_, i) => i + 1);
const PICKER_HOURS = Array.from({ length: 24 }, (_, i) => i);
const PICKER_MINUTES = Array.from({ length: 12 }, (_, i) => i * 5);

function getDaysInMonth(y: number, m: number) { return new Date(y, m, 0).getDate(); }
function getDayOfWeek(y: number, m: number, d: number) { return (isOverseasLocale() ? DAYS_EN : DAYS_KR)[new Date(y, m - 1, d).getDay()]; }

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
  const { t } = useTranslation();
  const sheetBottomPad = useBottomSheetPadding(40, 20);
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
        <View style={[mpStyles.sheet, { paddingBottom: sheetBottomPad }]}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>{t('medRecordWrite.dateSelectTitle')}</Text>
          <View style={mpStyles.colsRow}>
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>{t('medRecordWrite.yearHeader')}</Text>
              <PickerCol data={PICKER_YEARS} selected={year} onSelect={onYearChange} suffix={isOverseasLocale() ? '' : '년'} fontSize={19} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 3 }}>
              <Text style={mpStyles.colHeader}>{t('medRecordWrite.monthHeader')}</Text>
              <PickerCol data={availableMonths} selected={month} onSelect={onMonthChange} suffix={isOverseasLocale() ? '' : '월'} fontSize={19} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 5 }}>
              <Text style={mpStyles.colHeader}>{t('medRecordWrite.dayHeader')}</Text>
              <PickerCol
                data={days} selected={day} onSelect={onDayChange} suffix={isOverseasLocale() ? '' : '일'} fontSize={18}
                getLabel={(d) => isOverseasLocale() ? `${d} (${getDayOfWeek(year, month, d)})` : `${d}일 (${getDayOfWeek(year, month, d)})`}
              />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>{t('medRecordWrite.selectDone')}</Text>
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
  const { t } = useTranslation();
  const sheetBottomPad = useBottomSheetPadding(40, 20);
  return (
    <Modal visible={visible} transparent animationType="slide">
      <View style={mpStyles.container}>
        <TouchableOpacity style={mpStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={[mpStyles.sheet, { paddingBottom: sheetBottomPad }]}>
          <View style={mpStyles.handle} />
          <Text style={mpStyles.title}>{t('medRecordWrite.timeSelectTitle')}</Text>
          <View style={mpStyles.colsRow}>
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>{t('medRecordWrite.hourHeader')}</Text>
              <PickerCol data={PICKER_HOURS} selected={hour} onSelect={onHourChange} suffix={isOverseasLocale() ? '' : '시'} padLen={2} />
            </View>
            <View style={mpStyles.colDivider} />
            <View style={{ flex: 1 }}>
              <Text style={mpStyles.colHeader}>{t('medRecordWrite.minuteHeader')}</Text>
              <PickerCol data={PICKER_MINUTES} selected={minute} onSelect={onMinuteChange} suffix={isOverseasLocale() ? '' : '분'} padLen={2} />
            </View>
          </View>
          <TouchableOpacity style={mpStyles.confirmBtn} onPress={onConfirm} activeOpacity={0.8}>
            <Text style={mpStyles.confirmText}>{t('medRecordWrite.selectDone')}</Text>
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
  // image_type: 'jpeg' | 'png'
  const rawType = mediaType.replace('image/', '');
  const imageType: 'jpeg' | 'png' = rawType === 'png' ? 'png' : 'jpeg';

  // claude-medical-record Edge Function 호출 (CLAUDE_API_KEY는 서버 secret)
  const { data: { session } } = await supabase.auth.getSession();
  const accessToken = session?.access_token ?? SUPABASE_ANON_KEY;

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
      mode: 'medical_record',
    }),
  });
  if (!response.ok) throw new Error(`OCR error: ${response.status}`);
  const data = await response.json();
  return { medications: (data.medications ?? []) as OcrMed[] };
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
  const { t } = useTranslation();
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteType>();
  const recordId = (route.params as any)?.recordId as string | undefined;
  const { user } = useAuth();
  const { patientId, loading: pidLoading } = usePatientId();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();

  // 저장 버튼이 안드 3버튼/홈 인디케이터에 가리지 않도록 (글로벌 규칙)
  const bottomPad = useBottomSheetPadding(40);
  // 상담 내용 multiline 포커스/입력 시 커서가 키보드 위에 보이게 끌어올리기 위한 ScrollView ref
  const scrollViewRef = useRef<ScrollView>(null);
  // 안드로이드 edge-to-edge(Expo SDK 54+)에서는 키보드가 inset으로 들어와
  // 흐름 안 입력칸이 가려질 수 있다 → 키보드 높이만큼 하단 스페이서를 주고 scrollToEnd 로 입력칸을 키보드 위로 올린다.
  // (iOS는 ScrollView automaticallyAdjustKeyboardInsets 가 처리하므로 안드만)
  const [kbHeight, setKbHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const showSub = Keyboard.addListener('keyboardDidShow', (e) => {
      setKbHeight(e.endCoordinates?.height ?? 0);
    });
    const hideSub = Keyboard.addListener('keyboardDidHide', () => setKbHeight(0));
    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // 미연동 보호자: 보호자인데 환자 해석이 끝났고 연동 환자 없음.
  // patientId ?? user.id 폴백이 보호자 본인 id로 저장돼 유령 기록이 생기므로
  // 작성 화면 진입을 막고 가족 연동을 안내한다(환자 본인 경로는 영향 없음).
  const caregiverUnlinked = user?.role === 'caregiver' && !pidLoading && patientId == null;

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
  const [prescriptionChanged, setPrescriptionChanged] = useState(false);
  const [prescriptionImageUri, setPrescriptionImageUri] = useState<string | null>(null);
  const [ocrMeds, setOcrMeds] = useState<OcrMed[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isLoadingEdit, setIsLoadingEdit] = useState(false);
  const [isFirstRecord, setIsFirstRecord] = useState(false);
  // 1회 로드 가드: user 참조 변동(컨텍스트 갱신)으로 effect 가 재실행돼 폼이 재조회/덮어쓰기
  //  되는 것을 막는다. 자동완성은 첫 진입 1회만, 수정 로드는 recordId 당 1회만.
  const didAutoFillRef = useRef(false);
  const loadedEditIdRef = useRef<string | null>(null);

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
    if (didAutoFillRef.current) return; // 첫 진입 1회만
    didAutoFillRef.current = true;
    (async () => {
      try {
        const token = await getToken();
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?patient_id=eq.${patientId ?? user.id}&order=visit_date.desc&limit=1`,
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
    if (loadedEditIdRef.current === recordId) return; // 같은 기록은 1회만 로드(편집 중 덮어쓰기 방지)
    loadedEditIdRef.current = recordId;
    (async () => {
      setIsLoadingEdit(true);
      try {
        const token = await getToken();
        const headers = { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${token}` };
        const res = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}&select=id,visit_date,hospital_name,doctor_name,consultation_notes,prescription_changed,prescription_image_url,medical_record_medications(medication_name,dosage)`,
          { headers },
        );
        if (!res.ok) throw new Error(t('medRecordWrite.loadFailMsg'));
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
          setPrescriptionChanged(!!rec.prescription_changed);
          if (rec.prescription_image_url) setPrescriptionImageUri(rec.prescription_image_url);
          if (rec.medical_record_medications?.length > 0) {
            setOcrMeds(rec.medical_record_medications.map((m: any) => ({
              name: m.medication_name,
              dosage: m.dosage ?? '',
            })));
          }
        }
      } catch (e: any) {
        dialog.alert({ title: t('medRecordWrite.errorTitle'), message: e.message ?? t('medRecordWrite.loadFailAlertMsg') });
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
  const displayDate = isOverseasLocale()
    ? `${selYear}-${selMonth}-${selDay} (${dow})`
    : `${selYear}년 ${selMonth}월 ${selDay}일 (${dow})`;
  const displayTime = isOverseasLocale()
    ? `${String(selHour).padStart(2, '0')}:${String(selMinute).padStart(2, '0')}`
    : `${String(selHour).padStart(2, '0')}시 ${String(selMinute).padStart(2, '0')}분`;

  // 처방전 이미지 선택 → OCR
  const pickAndOcr = async (fromCamera: boolean) => {
    try {
      let result: ImagePicker.ImagePickerResult;
      if (fromCamera) {
        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (perm.status !== 'granted') { dialog.alert({ title: t('medRecordWrite.permRequiredTitle'), message: t('medRecordWrite.cameraPermMsg') }); return; }
        result = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Images, quality: 0.7 });
      } else {
        const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (perm.status !== 'granted') { dialog.alert({ title: t('medRecordWrite.permRequiredTitle'), message: t('medRecordWrite.galleryPermMsg') }); return; }
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
      if (ocrResult.medications.length === 0) dialog.alert({ title: t('medRecordWrite.noticeTitle'), message: t('medRecordWrite.ocrNoMedsMsg') });
    } catch (e: any) {
      dialog.alert({ title: t('medRecordWrite.errorTitle'), message: e.message ?? t('medRecordWrite.ocrErrorMsg') });
    } finally {
      setIsOcrLoading(false);
    }
  };

  const handleSave = async () => {
    if (!user) return;
    // 미연동 보호자는 저장 직전 차단(폴백 본인 id 저장으로 유령 기록 생기는 것 방지).
    if (caregiverUnlinked) {
      await dialog.alert({ title: t('medRecordWrite.linkRequiredTitle'), message: t('medRecordWrite.linkRequiredMsg') });
      return;
    }

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

      // 진료 기록 기본 필드만 저장. 처방약은 '약 관리'에서 관리(처방전 사진 미보관 — 개인정보 보호).
      const recordBody = {
        visit_date: visitDateISO,
        hospital_name: hospitalName.trim() || null,
        doctor_name: doctorName.trim() || null,
        consultation_notes: consultationNotes.trim() || null,
        prescription_changed: prescriptionChanged,
      };

      if (recordId) {
        const updateRes = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}`,
          { method: 'PATCH', headers, body: JSON.stringify(recordBody) },
        );
        if (!updateRes.ok) throw new Error(t('medRecordWrite.updateFailMsg'));
      } else {
        const insertRes = await fetch(
          `${SUPABASE_URL}/rest/v1/medical_records`,
          { method: 'POST', headers, body: JSON.stringify({ patient_id: patientId ?? user.id, ...recordBody }) },
        );
        if (!insertRes.ok) throw new Error(t('medRecordWrite.insertFailMsg'));
      }

      await dialog.alert({ title: t('medRecordWrite.saveDoneTitle'), message: t('medRecordWrite.saveDoneMsg') });
      navigation.goBack();
    } catch (e: any) {
      dialog.alert({ title: t('medRecordWrite.errorTitle'), message: e.message ?? t('medRecordWrite.saveFailMsg') });
    } finally {
      setIsSaving(false);
    }
  };

  if (isLoadingEdit) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        <TopBar
          title={recordId ? t('medRecordWrite.headerEdit') : t('medRecordWrite.headerNew')}
          showBack
          showBell
          bellBadge={unreadCount}
          onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
        />
        <View style={styles.center}><ActivityIndicator size="large" color={Colors.primary} /></View>
      </SafeAreaView>
    );
  }

  if (caregiverUnlinked) {
    return (
      <SafeAreaView style={styles.container} edges={['top']}>
        <TopBar title={recordId ? t('medRecordWrite.headerEdit') : t('medRecordWrite.headerNew')} showBack />
        <View style={styles.unlinkedWrap}>
          <Ionicons name="people-outline" size={56} color={Colors.textHint} />
          <Text style={styles.unlinkedTitle}>{t('medRecordWrite.unlinkedTitle')}</Text>
          <Text style={styles.unlinkedDesc}>{t('medRecordWrite.unlinkedDesc')}</Text>
          <TouchableOpacity
            style={styles.linkFamilyBtn}
            onPress={() => navigation.navigate('FamilyLink')}
            activeOpacity={0.85}
          >
            <Ionicons name="person-add-outline" size={22} color={Colors.white} />
            <Text style={styles.linkFamilyBtnText}>{t('medRecordWrite.linkFamilyBtn')}</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <TopBar title={recordId ? t('medRecordWrite.headerEdit') : t('medRecordWrite.headerNew')} showBack />
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView
          ref={scrollViewRef}
          contentContainerStyle={[styles.scroll, { paddingBottom: bottomPad }]}
          keyboardShouldPersistTaps="handled"
          // iOS는 키보드 높이만큼 자동으로 하단 인셋을 잡아 입력칸이 가려지지 않게 함 (RN 0.70+)
          automaticallyAdjustKeyboardInsets={Platform.OS === 'ios'}
        >

          {/* 진료 날짜 */}
          <Text style={styles.label}>{t('medRecordWrite.visitDateLabel')}</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openDatePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>📅  {displayDate}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 진료 시간 */}
          <Text style={styles.label}>{t('medRecordWrite.visitTimeLabel')}</Text>
          <TouchableOpacity style={styles.pickerBtn} onPress={openTimePicker} activeOpacity={0.8}>
            <Text style={styles.pickerBtnText}>🕐  {displayTime}</Text>
            <Text style={styles.pickerArrow}>▼</Text>
          </TouchableOpacity>

          {/* 처음 등록 안내 */}
          {isFirstRecord && (
            <View style={styles.hintCard}>
              <HangingText text={t('medRecordWrite.autoFillHint')} style={styles.hintText} />
            </View>
          )}

          {/* 병원명 */}
          <Text style={styles.label}>{t('medRecordWrite.hospitalLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('medRecordWrite.hospitalPlaceholder')}
            placeholderTextColor={Colors.textHint}
            value={hospitalName}
            onChangeText={setHospitalName}
            maxLength={50}
          />

          {/* 의사명 */}
          <Text style={styles.label}>{t('medRecordWrite.doctorLabel')}</Text>
          <TextInput
            style={styles.input}
            placeholder={t('medRecordWrite.doctorPlaceholder')}
            placeholderTextColor={Colors.textHint}
            value={doctorName}
            onChangeText={setDoctorName}
            maxLength={30}
          />

          {/* 상담 내용 */}
          <Text style={styles.label}>{t('medRecordWrite.notesLabel')}</Text>
          <TextInput
            style={[styles.input, styles.multilineInput]}
            placeholder={t('medRecordWrite.notesPlaceholder')}
            placeholderTextColor={Colors.textHint}
            value={consultationNotes}
            onChangeText={t => setConsultationNotes(t.slice(0, 500))}
            onFocus={() => {
              // 키보드 애니메이션이 끝난 뒤 입력칸을 키보드 바로 위로 끌어올림 (특히 안드 — automaticallyAdjustKeyboardInsets 미지원)
              setTimeout(() => scrollViewRef.current?.scrollToEnd({ animated: true }), 250);
            }}
            onContentSizeChange={() => {
              // 줄이 늘어나 커서가 키보드에 가릴 위험 — 입력 중에도 맨 아래로 따라가게 함 (안드)
              if (Platform.OS === 'android' && kbHeight > 0) {
                scrollViewRef.current?.scrollToEnd({ animated: true });
              }
            }}
            multiline
            numberOfLines={5}
            textAlignVertical="top"
          />
          <Text style={styles.charCount}>{consultationNotes.length}/500</Text>

          {/* 처방 변경 — 사용자가 직접 변경 여부 등록. 실제 약은 약 관리에서. (처방전 사진 미보관) */}
          <Text style={[styles.label, { marginTop: 8 }]}>{t('medRecordWrite.prescChangeLabel')}</Text>
          <View style={styles.prescChangeRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.prescChangeTitle}>{t('medRecordWrite.prescChangeTitle')}</Text>
              <Text style={styles.prescChangeSub}>{t('medRecordWrite.prescChangeSub')}</Text>
            </View>
            <Switch
              value={prescriptionChanged}
              onValueChange={setPrescriptionChanged}
              trackColor={{ false: Colors.border, true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
          {prescriptionChanged ? (
            <TouchableOpacity
              style={styles.medManageLink}
              onPress={() => navigation.navigate('MedicationManage', { mode: 'meds' } as any)}
              activeOpacity={0.8}
            >
              <Ionicons name="medical-outline" size={24} color={Colors.primary} style={{ marginRight: 10 }} />
              <View style={{ flex: 1 }}>
                <Text style={styles.medManageLinkTitle}>{t('medRecordWrite.medManageLinkTitle')}</Text>
                <Text style={styles.medManageLinkSub}>{t('medRecordWrite.medManageLinkSub')}</Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={Colors.primary} />
            </TouchableOpacity>
          ) : null}

          {/* 저장 버튼 */}
          <TouchableOpacity
            style={[styles.saveBtn, isSaving && styles.saveBtnDisabled]}
            onPress={handleSave}
            activeOpacity={0.8}
            disabled={isSaving}
          >
            <Text style={styles.saveBtnText}>{t('medRecordWrite.saveBtn')}</Text>
          </TouchableOpacity>

          {/* 안드: 키보드 높이만큼 하단 스페이서 — 긴 상담 내용 입력 시 커서가 키보드 위로 보이게 (iOS는 automaticallyAdjustKeyboardInsets) */}
          {Platform.OS === 'android' && kbHeight > 0 ? <View style={{ height: kbHeight }} /> : null}
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
      <BrandProgressOverlay
        visible={isSaving}
        title={i18n.t('loading.saving')}
        minVisibleMs={500}
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
  // 약 관리 연결 링크
  medManageLink: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderWidth: 1.5, borderColor: Colors.primary,
    borderRadius: 12, paddingHorizontal: 16, paddingVertical: 14, minHeight: 56,
  },
  medManageLinkTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  medManageLinkSub: { fontSize: 14, color: Colors.textSub, marginTop: 2 },
  prescChangeRow: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: Colors.white, borderRadius: 12,
    paddingHorizontal: 16, paddingVertical: 14, marginBottom: 10,
  },
  prescChangeTitle: { fontSize: 17, fontWeight: '700', color: Colors.text },
  prescChangeSub: { fontSize: 14, color: Colors.textSub, marginTop: 2 },
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

  // 미연동 보호자 안내(가족 연동 유도) — 기준 화면(기록 보기)과 동일
  unlinkedWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32 },
  unlinkedTitle: { fontSize: 20, color: Colors.textSub, marginTop: 16, fontWeight: '600' },
  unlinkedDesc: { fontSize: 18, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 26 },
  linkFamilyBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8,
    minHeight: 56, paddingHorizontal: 24, borderRadius: 12,
    backgroundColor: Colors.primary, marginTop: 24,
  },
  linkFamilyBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
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
