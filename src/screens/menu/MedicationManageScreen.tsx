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
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { supabase } from '../../lib/supabase';
import { useAuth } from '../../context/AuthContext';
import { useFamilyLink } from '../../hooks/useFamilyLink';

// ─── 타입 ────────────────────────────────────────────────────────────────────

type TimeSlot = 'morning' | 'lunch' | 'dinner' | 'bedtime';

const TIME_SLOTS: { key: TimeSlot; emoji: string; label: string }[] = [
  { key: 'morning', emoji: '🌅', label: '아침' },
  { key: 'lunch', emoji: '☀️', label: '점심' },
  { key: 'dinner', emoji: '🌇', label: '저녁' },
  { key: 'bedtime', emoji: '🌙', label: '취침' },
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
  times: TimeSlot[];
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
  const [addTimes, setAddTimes] = useState<TimeSlot[]>([]);

  // 인라인 수정 모드
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTimes, setEditTimes] = useState<TimeSlot[]>([]);

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
          times: (row.meal_times ?? []) as TimeSlot[],
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
                meal_times: med.times as any,
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
            times: (row.meal_times ?? []) as TimeSlot[],
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

  // ── 추가 ────────────────────────────────────────────────────────────────

  const handleAddSubmit = async () => {
    const trimmed = addName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (addTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    if (!user || !targetPatientId) return;

    const drugInfo = await searchMfdsInfo(trimmed);
    try {
      const { data, error } = await supabase
        .from('medications')
        .insert({
          patient_id: targetPatientId,
          name: trimmed,
          dosage: null,
          meal_times: addTimes as any,
          scheduled_times: [] as string[],
          drug_code: null,
          drug_image_url: drugInfo?.itemImage ?? null,
          is_active: true,
        })
        .select()
        .single();
      if (error) throw error;
      setMedications(prev => [...prev, {
        id: data.id,
        name: data.name,
        times: (data.meal_times ?? []) as TimeSlot[],
        drugInfo: drugInfo ?? null,
      }]);
      setAddName('');
      setAddTimes([]);
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
    setEditTimes([...med.times]);
    setShowAddForm(false);
  };

  const handleEditSave = async () => {
    const trimmed = editName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (editTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const savedId = editingId;
    if (!savedId) return;

    // 낙관적 UI 업데이트
    setMedications(prev => prev.map(m =>
      m.id === savedId ? { ...m, name: trimmed, times: editTimes, drugInfo: undefined } : m
    ));
    setEditingId(null);

    try {
      const drugInfo = await searchMfdsInfo(trimmed);
      const { error } = await supabase
        .from('medications')
        .update({
          name: trimmed,
          meal_times: editTimes as any,
          drug_image_url: drugInfo?.itemImage ?? null,
        })
        .eq('id', savedId);
      if (error) throw error;
      setMedications(prev => prev.map(m => m.id === savedId ? { ...m, drugInfo: drugInfo ?? null } : m));
    } catch (e) {
      console.error('[MedicationManageScreen] 약 수정 오류:', e);
      Alert.alert('', '약 수정에 실패했어요.');
      loadMedications();
    }
  };

  const handleEditCancel = () => {
    setEditingId(null);
    setEditName('');
    setEditTimes([]);
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

  const toggleAddTime = (t: TimeSlot) =>
    setAddTimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

  const toggleEditTime = (t: TimeSlot) =>
    setEditTimes(prev => prev.includes(t) ? prev.filter(x => x !== t) : [...prev, t]);

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
              <TextInput
                style={styles.medInput}
                value={addName}
                onChangeText={setAddName}
                placeholder="약 이름 입력 (예: 시네메트)"
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
              />
              <Text style={styles.inputLabel}>복용 시간대</Text>
              <View style={styles.timeRow}>
                {TIME_SLOTS.map(t => {
                  const sel = addTimes.includes(t.key);
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.timeBtn, sel && styles.timeBtnSelected]}
                      onPress={() => toggleAddTime(t.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.timeEmoji}>{t.emoji}</Text>
                      <Text style={[styles.timeText, sel && styles.timeTextSelected]}>{t.label}</Text>
                    </TouchableOpacity>
                  );
                })}
              </View>
              <TouchableOpacity
                style={[styles.addSubmitBtn, (!addName.trim() || addTimes.length === 0) && styles.addSubmitBtnDisabled]}
                onPress={handleAddSubmit}
                activeOpacity={0.85}
                disabled={!addName.trim() || addTimes.length === 0}
              >
                <Text style={styles.addSubmitBtnText}>+ 추가하기</Text>
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
                  <TextInput
                    style={styles.medInput}
                    value={editName}
                    onChangeText={setEditName}
                    placeholder="약 이름"
                    placeholderTextColor={Colors.textHint}
                    returnKeyType="done"
                    autoFocus
                  />
                  <Text style={styles.inputLabel}>복용 시간대</Text>
                  <View style={styles.timeRow}>
                    {TIME_SLOTS.map(t => {
                      const sel = editTimes.includes(t.key);
                      return (
                        <TouchableOpacity
                          key={t.key}
                          style={[styles.timeBtn, sel && styles.timeBtnSelected]}
                          onPress={() => toggleEditTime(t.key)}
                          activeOpacity={0.85}
                        >
                          <Text style={styles.timeEmoji}>{t.emoji}</Text>
                          <Text style={[styles.timeText, sel && styles.timeTextSelected]}>{t.label}</Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
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
                    <Text style={styles.editBtnText}>수정</Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteBtn} onPress={() => handleDelete(med)} activeOpacity={0.7}>
                    <Text style={styles.deleteBtnText}>삭제</Text>
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
    marginBottom: 16,
  },
  inputLabel: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 12 },
  timeRow: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  timeBtn: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    alignItems: 'center',
    backgroundColor: Colors.white,
  },
  timeBtnSelected: { backgroundColor: Colors.primary, borderColor: Colors.primary },
  timeEmoji: { fontSize: 20 },
  timeText: { fontSize: 16, fontWeight: '600', color: Colors.textSub, marginTop: 4 },
  timeTextSelected: { color: Colors.white },
  addSubmitBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  addSubmitBtnDisabled: { backgroundColor: Colors.border },
  addSubmitBtnText: { fontSize: 20, fontWeight: '700', color: Colors.white },

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
  emptyDesc: { fontSize: 16, color: Colors.textHint, textAlign: 'center', marginTop: 8, lineHeight: 24 },

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
  medSchedule: { fontSize: 17, color: Colors.textSub, marginTop: 4 },
  noInfoBadge: { fontSize: 14, color: Colors.danger, marginTop: 4 },

  medBtnRow: { flexDirection: 'row', marginTop: 16, gap: 10 },
  editBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  deleteBtn: {
    flex: 1,
    height: 52,
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
  ocrSubText: { fontSize: 17, color: Colors.textSub },
});
