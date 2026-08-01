import React, { useState, useEffect, useRef } from 'react';
import { OverlaySheet } from '../../components/common/OverlaySheet';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

type Nav = StackNavigationProp<OnboardingStackParamList, 'PatientInfo'>;
type RouteType = RouteProp<OnboardingStackParamList, 'PatientInfo'>;

const BIRTH_YEARS = Array.from({ length: 2005 - 1940 + 1 }, (_, i) => String(1940 + i)).reverse();
const DIAG_YEARS = Array.from({ length: 2026 - 1990 + 1 }, (_, i) => String(1990 + i)).reverse();
const TOTAL_STEPS = 4;

export function PatientInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteType>();
  const step = route.params?.step ?? 1;
  const { t } = useTranslation();
  const { user, signOut } = useAuth();
  const bottomPadding = useBottomSheetPadding(24);

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [diagYear, setDiagYear] = useState('');
  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const [showDiagPicker, setShowDiagPicker] = useState(false);

  useEffect(() => {
    loadSavedData();
  }, []);

  const loadSavedData = async () => {
    const savedName = await AsyncStorage.getItem('onboarding_name');
    const savedBirth = await AsyncStorage.getItem('onboarding_birth_year');
    const savedGender = await AsyncStorage.getItem('onboarding_gender');
    const savedDiag = await AsyncStorage.getItem('onboarding_diag_year');
    if (user?.name && user.name !== t('authHook.defaultUserName')) setName(user.name);
    else if (savedName) setName(savedName);
    if (savedBirth) setBirthYear(savedBirth);
    if (savedGender) setGender(savedGender as 'male' | 'female');
    if (savedDiag) setDiagYear(savedDiag);
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!name.trim()) return;
      await AsyncStorage.setItem('onboarding_name', name.trim());
      navigation.push('PatientInfo', { step: 2 });
    } else if (step === 2) {
      if (!birthYear) return;
      await AsyncStorage.setItem('onboarding_birth_year', birthYear);
      navigation.push('PatientInfo', { step: 3 });
    } else if (step === 3) {
      if (!gender) return;
      await AsyncStorage.setItem('onboarding_gender', gender);
      navigation.push('PatientInfo', { step: 4 });
    } else if (step === 4) {
      if (diagYear) await AsyncStorage.setItem('onboarding_diag_year', diagYear);
      // 복용 관리 통합 재설계 B차: 온보딩에서 약·시간대 등록 제거.
      // 기본정보 → 바로 가족 초대(완료)로. 약/시간대는 첫 로그인 후 통합 등록 유도에서.
      navigation.navigate('FamilyInvite');
    }
  };

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return birthYear !== '';
    if (step === 3) return gender !== null;
    return true; // step 4 선택사항
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>{t('common.back')}</Text>
          </TouchableOpacity>
        </View>

        {/* 진행 인디케이터 (점만) */}
        <View style={styles.progressArea}>
          {Array.from({ length: TOTAL_STEPS }, (_, i) => (
            <View key={i} style={[styles.progressDot, i < step && styles.progressDotActive]} />
          ))}
        </View>

        {/* 정중앙 정렬 컨텐츠 */}
        <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
          {step === 1 && (
            <View>
              <Text style={styles.title}>{t('patientInfo.nameTitle')}</Text>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder={t('patientInfo.namePlaceholder')}
                placeholderTextColor={Colors.textHint}
                maxLength={20}
                autoFocus
                textAlign="center"
              />
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.title}>{t('patientInfo.birthTitle')}</Text>
              <Text style={styles.subtitle}>{t('patientInfo.healthAnalysisNote')}</Text>
              <TouchableOpacity
                style={[styles.dropdownBtn, birthYear && styles.dropdownBtnFilled]}
                onPress={() => setShowBirthPicker(true)}
                activeOpacity={0.85}
              >
                <Text style={[styles.dropdownText, !birthYear && styles.dropdownPlaceholder]}>
                  {birthYear ? t('common.yearValue', { year: birthYear }) : t('patientInfo.birthSelect')}
                </Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 3 && (
            <View>
              <Text style={styles.title}>{t('patientInfo.genderTitle')}</Text>
              <Text style={styles.subtitle}>{t('patientInfo.healthAnalysisNote')}</Text>
              <View style={styles.genderRow}>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'male' && styles.genderBtnSelected]}
                  onPress={() => setGender('male')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.genderText, gender === 'male' && styles.genderTextSelected]}>{t('patientInfo.male')}</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'female' && styles.genderBtnSelected]}
                  onPress={() => setGender('female')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.genderText, gender === 'female' && styles.genderTextSelected]}>{t('patientInfo.female')}</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 4 && (
            <View>
              <Text style={styles.title}>{t('patientInfo.diagTitle')}</Text>
              <Text style={styles.subtitle}>{t('patientInfo.diagSubtitle')}</Text>
              <TouchableOpacity
                style={[styles.dropdownBtn, diagYear && styles.dropdownBtnFilled]}
                onPress={() => setShowDiagPicker(true)}
                activeOpacity={0.85}
              >
                <Text style={[styles.dropdownText, !diagYear && styles.dropdownPlaceholder]}>
                  {diagYear ? t('common.yearValue', { year: diagYear }) : t('patientInfo.diagSelect')}
                </Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
            </View>
          )}
        </ScrollView>

        {/* 하단 버튼 */}
        <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
          <PrimaryButton title={step < TOTAL_STEPS ? t('common.nextTo') : t('common.done')} onPress={handleNext} disabled={!canProceed()} />
          <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
            <Text style={styles.closeBtnText}>{t('common.close')}</Text>
          </TouchableOpacity>
        </View>

        <YearPickerModal
          visible={showBirthPicker}
          years={BIRTH_YEARS}
          selected={birthYear}
          onSelect={(y) => { setBirthYear(y); setShowBirthPicker(false); }}
          onClose={() => setShowBirthPicker(false)}
        />
        <YearPickerModal
          visible={showDiagPicker}
          years={DIAG_YEARS}
          selected={diagYear}
          onSelect={(y) => { setDiagYear(y); setShowDiagPicker(false); }}
          onClose={() => setShowDiagPicker(false)}
        />
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function YearPickerModal({ visible, years, selected, onSelect, onClose }: {
  visible: boolean;
  years: string[];
  selected: string;
  onSelect: (y: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const sheetPadding = useBottomSheetPadding(32);
  const flatListRef = useRef<FlatList<string>>(null);

  const handleLayout = () => {
    if (selected) {
      const selectedIndex = years.findIndex(y => y === selected);
      if (selectedIndex >= 0) {
        flatListRef.current?.scrollToIndex({ index: selectedIndex, animated: false, viewPosition: 0.5 });
      }
    }
  };

  return (
    <OverlaySheet visible={visible} animationType="slide">
      <View style={pickerStyles.container}>
        <TouchableOpacity style={pickerStyles.overlay} onPress={onClose} activeOpacity={1} />
        <View style={[pickerStyles.sheet, { paddingBottom: sheetPadding }]}>
          <View style={pickerStyles.handle} />
          <Text style={pickerStyles.sheetTitle}>{t('patientInfo.yearPickerTitle')}</Text>
          <FlatList
            ref={flatListRef}
            data={years}
            keyExtractor={(item) => item}
            style={pickerStyles.list}
            onLayout={handleLayout}
            getItemLayout={(_, index) => ({ length: 57, offset: 57 * index, index })}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[pickerStyles.yearItem, item === selected && pickerStyles.yearItemSelected]}
                onPress={() => onSelect(item)}
                activeOpacity={0.85}
              >
                <Text style={[pickerStyles.yearText, item === selected && pickerStyles.yearTextSelected]}>
                  {t('common.yearValue', { year: item })}
                </Text>
                {item === selected && <Ionicons name="checkmark-sharp" size={18} color="#4CAF50" />}
              </TouchableOpacity>
            )}
          />
        </View>
      </View>
    </OverlaySheet>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  header: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  backBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 8, paddingHorizontal: 4, alignSelf: 'flex-start' },
  backIcon: { fontSize: 22, color: Colors.text },
  backText: { fontSize: 18, color: Colors.text },
  progressArea: { flexDirection: 'row', gap: 8, paddingHorizontal: 24, paddingTop: 8, paddingBottom: 16 },
  progressDot: { flex: 1, height: 6, borderRadius: 3, backgroundColor: Colors.border },
  progressDotActive: { backgroundColor: Colors.primary },
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingVertical: 24 },
  title: { fontSize: 26, fontWeight: '700', color: Colors.text, marginBottom: 12, lineHeight: 38, textAlign: 'center' },
  subtitle: { fontSize: 18, color: Colors.textSub, marginBottom: 32, lineHeight: 28, textAlign: 'center' },
  textInput: {
    borderWidth: 2, borderColor: Colors.primary, borderRadius: 10,
    padding: 16, fontSize: 20, color: Colors.text, backgroundColor: Colors.white,
    minHeight: 56, textAlign: 'center', marginTop: 12,
  },
  dropdownBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    borderWidth: 2, borderColor: Colors.border, borderRadius: 10,
    padding: 16, backgroundColor: Colors.white, minHeight: 56,
  },
  dropdownBtnFilled: { borderColor: Colors.primary, backgroundColor: Colors.light },
  dropdownText: { fontSize: 18, color: Colors.text, fontWeight: '600' },
  dropdownPlaceholder: { color: Colors.textHint, fontWeight: '400' },
  dropdownArrow: { fontSize: 14, color: Colors.textSub },
  genderRow: { flexDirection: 'row', gap: 16, marginTop: 4 },
  genderBtn: {
    flex: 1, alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.white, borderRadius: 16, borderWidth: 2, borderColor: Colors.border,
    paddingVertical: 32, gap: 12, minHeight: 120,
  },
  genderBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.light },
  genderText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  genderTextSelected: { color: Colors.dark },
  bottomArea: { paddingHorizontal: 24, paddingTop: 16, gap: 12 },
  closeBtn: {
    minHeight: 56, borderRadius: 12, borderWidth: 1,
    borderColor: Colors.border, backgroundColor: Colors.white,
    alignItems: 'center', justifyContent: 'center',
  },
  closeBtnText: { fontSize: 18, color: Colors.textSub, fontWeight: '600' },
});

const pickerStyles = StyleSheet.create({
  container: { flex: 1, justifyContent: 'flex-end' },
  overlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 24, borderTopRightRadius: 24,
    paddingTop: 12, paddingHorizontal: 24, paddingBottom: 40,
    height: '60%',
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: Colors.border, alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 16, textAlign: 'center' },
  list: { flex: 1 },
  yearItem: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingVertical: 16, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: Colors.border,
  },
  yearItemSelected: { backgroundColor: '#E8F5E9', borderRadius: 8 },
  yearText: { fontSize: 18, color: Colors.text },
  yearTextSelected: { color: '#4CAF50', fontWeight: '700' },
});
