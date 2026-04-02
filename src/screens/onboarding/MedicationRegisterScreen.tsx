import React, { useState } from 'react';
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

type Nav = StackNavigationProp<OnboardingStackParamList, 'MedicationRegister'>;

type TimeSlot = 'morning' | 'noon' | 'evening' | 'bedtime';

const TIME_SLOTS: { key: TimeSlot; emoji: string; label: string }[] = [
  { key: 'morning', emoji: '🌅', label: '아침' },
  { key: 'noon', emoji: '☀️', label: '점심' },
  { key: 'evening', emoji: '🌇', label: '저녁' },
  { key: 'bedtime', emoji: '🌙', label: '취침' },
];

interface DrugInfo {
  itemName: string;
  entpName?: string;       // 제조사
  itemImage?: string;      // 이미지 URL
  chart?: string;          // 성상 (예: "흰색의 장방형 필름코팅정")
  drugShape?: string;      // 모양 (예: "장방형")
  colorClass?: string;     // 색깔
  className?: string;      // 분류 (예: "항파킨슨제")
  etcOtcName?: string;    // 전문의약품/일반의약품
  printFront?: string;     // 앞면 인쇄
  printBack?: string;      // 뒷면 인쇄
}

interface Medication {
  id: string;
  name: string;
  times: TimeSlot[];
  drugInfo?: DrugInfo | null; // undefined=미조회, null=조회했으나 없음, DrugInfo=조회 성공
}

type Mode = 'home' | 'manual';

const CLAUDE_API_KEY = process.env.EXPO_PUBLIC_CLAUDE_API_KEY;
const CLAUDE_API_URL = 'https://api.anthropic.com/v1/messages';

const MFDS_KEY = process.env.EXPO_PUBLIC_MFDS_KEY ?? '';
const MFDS_URL = 'https://apis.data.go.kr/1471000/MdcinGrnIdntfcInfoService03/getMdcinGrnIdntfcInfoList03';

async function callClaudeOCR(base64Image: string, mediaType: string): Promise<{ medications: { name: string; times: string[] }[] }> {
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
              source: {
                type: 'base64',
                media_type: mediaType,
                data: base64Image,
              },
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
{"medications":[{"name":"약 이름","times":["morning","noon","evening","bedtime"]}]}
복용 시간대: morning(아침)/noon(점심)/evening(저녁)/bedtime(취침)
개인정보(이름, 주민번호 등)는 무시하세요.
약이 보이지 않거나 읽기 어려우면 {"medications":[]} 를 반환하세요.`,
            },
          ],
        },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`API 오류: ${response.status}`);
  }

  const data = await response.json();
  const text: string = data.content[0].text;

  // JSON 파싱 시도 (마크다운 코드블록 제거 후)
  const cleaned = text.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
  const parsed = JSON.parse(cleaned);
  return parsed as { medications: { name: string; times: string[] }[] };
}

async function searchMfdsInfo(drugName: string): Promise<DrugInfo | null> {
  try {
    const url = `${MFDS_URL}?serviceKey=${encodeURIComponent(MFDS_KEY)}&item_name=${encodeURIComponent(drugName)}&type=json&numOfRows=5&pageNo=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();

    // 한국 공공데이터 JSON: data.body.items.item (단건이면 객체, 복수면 배열)
    const rawItems = data?.body?.items?.item ?? data?.body?.items;
    if (!rawItems) return null;

    const list = Array.isArray(rawItems) ? rawItems : [rawItems];
    if (list.length === 0) return null;

    const item = list[0];
    // 반환된 약품명이 검색어와 너무 다르면 잘못된 매칭으로 판단해 null 반환
    const returnedName: string = item.ITEM_NAME ?? '';
    const searchUpper = drugName.replace(/\s/g, '').toUpperCase();
    const returnedUpper = returnedName.replace(/\s/g, '').toUpperCase();
    if (
      returnedName &&
      !returnedUpper.includes(searchUpper.slice(0, 3)) &&
      !searchUpper.includes(returnedUpper.slice(0, 3))
    ) {
      // 이름이 전혀 다른 경우 → 잘못된 매칭 가능성 높음
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
      {/* 딤 오버레이 - 탭하면 닫힘 */}
      <TouchableOpacity
        style={drugModalStyles.overlay}
        activeOpacity={1}
        onPress={onClose}
      >
        {/* 바텀시트 - 탭해도 닫히지 않음 */}
        <TouchableOpacity
          style={drugModalStyles.sheet}
          activeOpacity={1}
          onPress={() => {}}
        >
          {/* 드래그 핸들 */}
          <View style={drugModalStyles.dragHandle} />

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={drugModalStyles.scrollContent}
          >
            {/* 약 이미지 영역 */}
            <View style={drugModalStyles.imageContainer}>
              {info?.itemImage ? (
                <Image
                  source={{ uri: info.itemImage }}
                  style={drugModalStyles.drugImage}
                  resizeMode="contain"
                />
              ) : (
                <View style={drugModalStyles.imagePlaceholder}>
                  <Text style={drugModalStyles.imagePlaceholderEmoji}>💊</Text>
                </View>
              )}
            </View>

            {/* 약 이름 */}
            <Text style={drugModalStyles.drugName}>{drug.name}</Text>

            {/* 제조사 */}
            {info?.entpName && (
              <Text style={drugModalStyles.companyName}>{info.entpName}</Text>
            )}

            {/* 약 정보가 없는 경우 플레이스홀더 */}
            {!info && (
              <View style={drugModalStyles.noInfoContainer}>
                <Text style={drugModalStyles.noInfoEmoji}>💊</Text>
                <Text style={drugModalStyles.noInfoText}>약 정보를 불러오는 중이에요</Text>
                <Text style={drugModalStyles.noInfoSubText}>
                  식약처 낱알식별 정보를 가져올 수 없어요
                </Text>
              </View>
            )}

            {/* 성상 */}
            {info?.chart && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>💊 성상</Text>
                <Text style={drugModalStyles.sectionContent}>{info.chart}</Text>
              </View>
            )}

            {/* 분류 + 전문/일반 */}
            {(info?.className || info?.etcOtcName) && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>🏷️ 분류</Text>
                <Text style={drugModalStyles.sectionContent}>
                  {[info.className, info.etcOtcName].filter(Boolean).join(' · ')}
                </Text>
              </View>
            )}

            {/* 앞/뒷면 인쇄 식별 */}
            {(info?.printFront || info?.printBack) && (
              <View style={drugModalStyles.section}>
                <Text style={drugModalStyles.sectionHeader}>🔍 식별</Text>
                <Text style={drugModalStyles.sectionContent}>
                  {info.printFront ? `앞: ${info.printFront}` : ''}
                  {info.printFront && info.printBack ? '\n' : ''}
                  {info.printBack ? `뒤: ${info.printBack}` : ''}
                </Text>
              </View>
            )}

            {/* 닫기 버튼 */}
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
  imagePlaceholderEmoji: {
    fontSize: 48,
  },
  drugName: {
    fontSize: 24,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 6,
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
  noInfoEmoji: {
    fontSize: 56,
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
// 메인 화면 컴포넌트
// ─────────────────────────────────────────────
export function MedicationRegisterScreen() {
  const navigation = useNavigation<Nav>();
  const { signOut } = useAuth();
  const [mode, setMode] = useState<Mode>('home');
  const [medName, setMedName] = useState('');
  const [selectedTimes, setSelectedTimes] = useState<TimeSlot[]>([]);
  const [medications, setMedications] = useState<Medication[]>([]);
  const [isOcrLoading, setIsOcrLoading] = useState(false);
  const [selectedDrug, setSelectedDrug] = useState<Medication | null>(null);

  // 수정 모드 state
  const [editingMedId, setEditingMedId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editTimes, setEditTimes] = useState<TimeSlot[]>([]);

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

      // 미디어 타입 결정
      const uri = asset.uri.toLowerCase();
      let mediaType = 'image/jpeg';
      if (uri.includes('.png')) mediaType = 'image/png';
      else if (uri.includes('.gif')) mediaType = 'image/gif';
      else if (uri.includes('.webp')) mediaType = 'image/webp';

      setIsOcrLoading(true);

      const parsed = await callClaudeOCR(asset.base64, mediaType);

      const validTimeSlots: TimeSlot[] = ['morning', 'noon', 'evening', 'bedtime'];
      const newMedications: Medication[] = parsed.medications.map((med, index) => ({
        id: (Date.now() + index).toString(),
        name: med.name,
        times: med.times.filter((t): t is TimeSlot => validTimeSlots.includes(t as TimeSlot)),
      }));

      // OCR 후 식약처 정보 병렬 조회 (null = 정보 없음)
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
          `⚠️ ${noInfoCount}개는 식약처에서 정보를 찾지 못했어요.\n약 이름이 정확한지 꼭 확인하고 수정해주세요. 잘못된 약 이름은 삭제 후 직접 입력해주세요.`
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
    Alert.alert(
      '처방전 사진 등록',
      '사진을 어디서 가져올까요?',
      [
        {
          text: '카메라로 찍기',
          onPress: () => pickImageAndRunOCR(true),
        },
        {
          text: '갤러리에서 선택',
          onPress: () => pickImageAndRunOCR(false),
        },
        {
          text: '취소',
          style: 'cancel',
        },
      ]
    );
  };

  const toggleTime = (t: TimeSlot) => {
    setSelectedTimes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const toggleEditTime = (t: TimeSlot) => {
    setEditTimes((prev) =>
      prev.includes(t) ? prev.filter((x) => x !== t) : [...prev, t]
    );
  };

  const handleAddMed = () => {
    const trimmed = medName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (selectedTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const newId = Date.now().toString();
    setMedications((prev) => [
      ...prev,
      { id: newId, name: trimmed, times: selectedTimes },
    ]);
    setMedName('');
    setSelectedTimes([]);
    // 백그라운드에서 식약처 정보 조회 (null = 정보 없음)
    searchMfdsInfo(trimmed).then((drugInfo) => {
      setMedications((prev) => prev.map((m) =>
        m.id === newId ? { ...m, drugInfo: drugInfo ?? null } : m
      ));
    });
  };

  const handleDeleteMed = (id: string) => {
    setMedications((prev) => prev.filter((m) => m.id !== id));
  };

  const handleEditStart = (med: Medication) => {
    setEditingMedId(med.id);
    setEditName(med.name);
    setEditTimes([...med.times]);
  };

  const handleEditSave = () => {
    const trimmed = editName.trim();
    if (!trimmed) { Alert.alert('', '약 이름을 입력해주세요.'); return; }
    if (editTimes.length === 0) { Alert.alert('', '복용 시간대를 하나 이상 선택해주세요.'); return; }
    const savedId = editingMedId;
    // 이름 변경 시 drugInfo 초기화 후 재조회
    setMedications((prev) =>
      prev.map((m) =>
        m.id === savedId ? { ...m, name: trimmed, times: editTimes, drugInfo: undefined } : m
      )
    );
    setEditingMedId(null);
    setEditName('');
    setEditTimes([]);
    // 백그라운드에서 식약처 정보 재조회
    searchMfdsInfo(trimmed).then((drugInfo) => {
      setMedications((prev) =>
        prev.map((m) => m.id === savedId ? { ...m, drugInfo: drugInfo ?? null } : m)
      );
    });
  };

  const handleEditCancel = () => {
    setEditingMedId(null);
    setEditName('');
    setEditTimes([]);
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
              <TextInput
                style={styles.medInput}
                value={medName}
                onChangeText={setMedName}
                placeholder="약 이름 입력 (예: 시네메트)"
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
              />

              <Text style={styles.inputLabel}>복용 시간대</Text>
              <View style={styles.timeRow}>
                {TIME_SLOTS.map((t) => {
                  const selected = selectedTimes.includes(t.key);
                  return (
                    <TouchableOpacity
                      key={t.key}
                      style={[styles.timeBtn, selected && styles.timeBtnSelected]}
                      onPress={() => toggleTime(t.key)}
                      activeOpacity={0.85}
                    >
                      <Text style={styles.timeEmoji}>{t.emoji}</Text>
                      <Text style={[styles.timeText, selected && styles.timeTextSelected]}>
                        {t.label}
                      </Text>
                    </TouchableOpacity>
                  );
                })}
              </View>

              <TouchableOpacity
                style={[styles.addBtn, (!medName.trim() || selectedTimes.length === 0) && styles.addBtnDisabled]}
                onPress={handleAddMed}
                activeOpacity={0.85}
              >
                <Text style={styles.addBtnText}>+ 추가</Text>
              </TouchableOpacity>
            </View>

            {/* 등록된 약 리스트 */}
            {medications.length > 0 && (
              <View style={styles.medList}>
                <Text style={styles.medListTitle}>등록된 약 ({medications.length}개)</Text>
                {medications.map((med) => {
                  const isEditing = editingMedId === med.id;

                  if (isEditing) {
                    // 인라인 편집 모드
                    return (
                      <View key={med.id} style={styles.medItemEditing}>
                        <TextInput
                          style={styles.editNameInput}
                          value={editName}
                          onChangeText={setEditName}
                          placeholder="약 이름"
                          placeholderTextColor={Colors.textHint}
                          returnKeyType="done"
                          autoFocus
                        />
                        <Text style={styles.inputLabel}>복용 시간대</Text>
                        <View style={styles.timeRow}>
                          {TIME_SLOTS.map((t) => {
                            const selected = editTimes.includes(t.key);
                            return (
                              <TouchableOpacity
                                key={t.key}
                                style={[styles.timeBtn, selected && styles.timeBtnSelected]}
                                onPress={() => toggleEditTime(t.key)}
                                activeOpacity={0.85}
                              >
                                <Text style={styles.timeEmoji}>{t.emoji}</Text>
                                <Text style={[styles.timeText, selected && styles.timeTextSelected]}>
                                  {t.label}
                                </Text>
                              </TouchableOpacity>
                            );
                          })}
                        </View>
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
                          <Text style={styles.medThumbnailEmoji}>💊</Text>
                        </View>
                      )}

                      {/* 중앙: 약 이름(탭→모달) + 복용시간 + 식약처 상태 */}
                      <View style={styles.medItemInfo}>
                        <TouchableOpacity
                          onPress={() => setSelectedDrug(med)}
                          activeOpacity={0.7}
                          style={styles.medNameRow}
                        >
                          <Text style={styles.medName}>{med.name}</Text>
                          <Text style={styles.medInfoIndicator}>ℹ️</Text>
                        </TouchableOpacity>
                        <Text style={styles.medTimes}>
                          {med.times.map((t) => TIME_SLOTS.find((s) => s.key === t)?.label).join(' · ')}
                        </Text>
                        {med.drugInfo === null && (
                          <Text style={styles.medNoInfoBadge}>⚠️ 식약처 정보 없음 · 이름 확인 필요</Text>
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
            <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
              <Text style={styles.closeBtnText}>닫기</Text>
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
            <Text style={styles.homeCardEmoji}>📷</Text>
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
            <Text style={styles.homeCardEmoji}>✍️</Text>
            <View>
              <Text style={styles.homeCardLabel}>직접 입력하기</Text>
              <Text style={styles.homeCardDesc}>약 이름과 복용 시간을 직접 입력해요</Text>
            </View>
          </TouchableOpacity>
        </View>
      </View>

      <View style={styles.bottomArea}>
        <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
          <Text style={styles.closeBtnText}>닫기</Text>
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

      {/* 약 상세 정보 모달 (home 모드에서도 가능하도록) */}
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
  homeCardEmoji: {
    fontSize: 40,
  },
  homeCardLabel: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 4,
  },
  homeCardDesc: {
    fontSize: 14,
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
  inputLabel: {
    fontSize: 16,
    fontWeight: '700',
    color: Colors.textSub,
    marginTop: 4,
  },
  timeRow: {
    flexDirection: 'row',
    gap: 10,
  },
  timeBtn: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    gap: 4,
    minHeight: 64,
    justifyContent: 'center',
  },
  timeBtnSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  timeEmoji: {
    fontSize: 20,
  },
  timeText: {
    fontSize: 14,
    fontWeight: '600',
    color: Colors.textSub,
  },
  timeTextSelected: {
    color: Colors.dark,
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
  medThumbnailEmoji: {
    fontSize: 24,
  },
  medItemInfo: {
    flex: 1,
  },
  medNameRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 4,
  },
  medName: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
  },
  medInfoIndicator: {
    fontSize: 16,
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
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#E3F2FD',
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
  },
  editBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1976D2',
  },
  deleteBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: '#FFEBEE',
    minHeight: 36,
    justifyContent: 'center',
    alignItems: 'center',
    minWidth: 44,
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
    minHeight: 52,
  },
  editCancelBtnText: {
    fontSize: 16,
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
    minHeight: 52,
  },
  editSaveBtnText: {
    fontSize: 16,
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
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
  },
});
