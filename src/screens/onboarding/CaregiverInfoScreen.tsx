import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RouteProp } from '@react-navigation/native';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { Ionicons } from '@expo/vector-icons';

type Nav = StackNavigationProp<OnboardingStackParamList, 'CaregiverInfo'>;
type RouteType = RouteProp<OnboardingStackParamList, 'CaregiverInfo'>;

const BIRTH_YEARS = Array.from({ length: 2005 - 1940 + 1 }, (_, i) => String(1940 + i)).reverse();

const RELATIONS = [
  { key: 'spouse', label: '배우자' },
  { key: 'child', label: '자녀' },
  { key: 'sibling', label: '형제/자매' },
  { key: 'other', label: '기타' },
] as const;

const LIVING = [
  { key: 'together', label: '함께 살고 있어요' },
  { key: 'separate', label: '따로 살고 있어요' },
] as const;

type RelationKey = typeof RELATIONS[number]['key'];
type LivingKey = typeof LIVING[number]['key'];

const TOTAL_STEPS = 4;

export function CaregiverInfoScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteType>();
  const step = route.params?.step ?? 1;
  const { user, signOut } = useAuth();
  const { bottom: bottomInset } = useSafeAreaInsets();

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState('');
  const [gender, setGender] = useState<'male' | 'female' | null>(null);
  const [relation, setRelation] = useState<RelationKey | null>(null);
  const [living, setLiving] = useState<LivingKey | null>(null);
  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const birthPickerRef = useRef<FlatList<string>>(null);

  useEffect(() => {
    loadSavedData();
  }, []);

  const loadSavedData = async () => {
    const savedName = await AsyncStorage.getItem('onboarding_name');
    const savedBirth = await AsyncStorage.getItem('onboarding_birth_year');
    const savedGender = await AsyncStorage.getItem('onboarding_gender');
    const savedRelation = await AsyncStorage.getItem('onboarding_relation');
    const savedLiving = await AsyncStorage.getItem('onboarding_living');
    if (user?.name && user.name !== '사용자') setName(user.name);
    else if (savedName) setName(savedName);
    if (savedBirth) setBirthYear(savedBirth);
    if (savedGender) setGender(savedGender as 'male' | 'female');
    if (savedRelation) setRelation(savedRelation as RelationKey);
    if (savedLiving) setLiving(savedLiving as LivingKey);
  };

  const handleNext = async () => {
    if (step === 1) {
      if (!name.trim()) return;
      await AsyncStorage.setItem('onboarding_name', name.trim());
      navigation.push('CaregiverInfo', { step: 2 });
    } else if (step === 2) {
      if (!birthYear) return;
      await AsyncStorage.setItem('onboarding_birth_year', birthYear);
      navigation.push('CaregiverInfo', { step: 3 });
    } else if (step === 3) {
      if (!gender) return;
      await AsyncStorage.setItem('onboarding_gender', gender);
      navigation.push('CaregiverInfo', { step: 4 });
    } else if (step === 4) {
      if (!relation || !living) return;
      await AsyncStorage.setItem('onboarding_relation', relation);
      await AsyncStorage.setItem('onboarding_living', living);
      navigation.navigate('MedicationRegister');
    }
  };

  const canProceed = () => {
    if (step === 1) return name.trim().length > 0;
    if (step === 2) return birthYear !== '';
    if (step === 3) return gender !== null;
    if (step === 4) return relation !== null && living !== null;
    return false;
  };

  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
        {/* 헤더 */}
        <View style={styles.header}>
          <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
            <Text style={styles.backIcon}>←</Text>
            <Text style={styles.backText}>뒤로</Text>
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
              <Text style={styles.title}>성함이 어떻게 되세요?</Text>
              <TextInput
                style={styles.textInput}
                value={name}
                onChangeText={setName}
                placeholder="이름을 입력해주세요"
                placeholderTextColor={Colors.textHint}
                maxLength={20}
                autoFocus
                textAlign="center"
              />
            </View>
          )}

          {step === 2 && (
            <View>
              <Text style={styles.title}>출생연도를 알려주세요</Text>
              <Text style={styles.subtitle}>건강 정보 분석에 활용돼요</Text>
              <TouchableOpacity
                style={[styles.dropdownBtn, birthYear && styles.dropdownBtnFilled]}
                onPress={() => setShowBirthPicker(true)}
                activeOpacity={0.85}
              >
                <Text style={[styles.dropdownText, !birthYear && styles.dropdownPlaceholder]}>
                  {birthYear ? `${birthYear}년` : '출생연도 선택'}
                </Text>
                <Text style={styles.dropdownArrow}>▼</Text>
              </TouchableOpacity>
            </View>
          )}

          {step === 3 && (
            <View>
              <Text style={styles.title}>성별을 알려주세요</Text>
              <Text style={styles.subtitle}>건강 정보 분석에 활용돼요</Text>
              <View style={styles.genderRow}>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'male' && styles.genderBtnSelected]}
                  onPress={() => setGender('male')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.genderText, gender === 'male' && styles.genderTextSelected]}>남자</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.genderBtn, gender === 'female' && styles.genderBtnSelected]}
                  onPress={() => setGender('female')}
                  activeOpacity={0.85}
                >
                  <Text style={[styles.genderText, gender === 'female' && styles.genderTextSelected]}>여자</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {step === 4 && (
            <View>
              <Text style={styles.title}>환자분과 어떤{'\n'}관계이신가요?</Text>
              <Text style={styles.subtitle}>돌봄 방식을 맞춤으로 설정해드릴게요</Text>

              <View style={styles.relationGrid}>
                {RELATIONS.map((r) => (
                  <TouchableOpacity
                    key={r.key}
                    style={[styles.relationBtn, relation === r.key && styles.relationBtnSelected]}
                    onPress={() => setRelation(r.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.relationText, relation === r.key && styles.relationTextSelected]}>{r.label}</Text>
                  </TouchableOpacity>
                ))}
              </View>

              <View style={styles.sectionDivider} />
              <Text style={styles.sectionTitle}>현재 어디서 지내시나요?</Text>

              <View style={styles.livingArea}>
                {LIVING.map((l) => (
                  <TouchableOpacity
                    key={l.key}
                    style={[styles.livingBtn, living === l.key && styles.livingBtnSelected]}
                    onPress={() => setLiving(l.key)}
                    activeOpacity={0.85}
                  >
                    <Text style={[styles.livingText, living === l.key && styles.livingTextSelected]}>{l.label}</Text>
                    <View style={[styles.radioOuter, living === l.key && styles.radioOuterSelected]}>
                      {living === l.key && <View style={styles.radioInner} />}
                    </View>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}
        </ScrollView>

        <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
          <PrimaryButton title={step < TOTAL_STEPS ? '다음으로' : '완료'} onPress={handleNext} disabled={!canProceed()} />
          <TouchableOpacity style={styles.closeBtn} onPress={signOut}>
            <Text style={styles.closeBtnText}>닫기</Text>
          </TouchableOpacity>
        </View>

        {/* 출생연도 피커 모달 */}
        <Modal visible={showBirthPicker} transparent animationType="slide">
          <View style={pickerStyles.container}>
            <TouchableOpacity style={pickerStyles.overlay} onPress={() => setShowBirthPicker(false)} activeOpacity={1} />
            <View style={[pickerStyles.sheet, { paddingBottom: Math.max(40, bottomInset + 20) }]}>
              <View style={pickerStyles.handle} />
              <Text style={pickerStyles.sheetTitle}>출생연도 선택</Text>
              <FlatList
                ref={birthPickerRef}
                data={BIRTH_YEARS}
                keyExtractor={(item) => item}
                style={pickerStyles.list}
                getItemLayout={(_, index) => ({ length: 57, offset: 57 * index, index })}
                onLayout={() => {
                  if (birthYear) {
                    const idx = BIRTH_YEARS.findIndex(y => y === birthYear);
                    if (idx >= 0) {
                      birthPickerRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: 0.5 });
                    }
                  }
                }}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    style={[pickerStyles.yearItem, item === birthYear && pickerStyles.yearItemSelected]}
                    onPress={() => { setBirthYear(item); setShowBirthPicker(false); }}
                    activeOpacity={0.85}
                  >
                    <Text style={[pickerStyles.yearText, item === birthYear && pickerStyles.yearTextSelected]}>
                      {item}년
                    </Text>
                    {item === birthYear && <Ionicons name="checkmark" size={18} color="#4CAF50" />}
                  </TouchableOpacity>
                )}
              />
            </View>
          </View>
        </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
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
  scrollContent: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: 24, paddingTop: 24, paddingBottom: 60 },
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
  sectionDivider: { height: 1, backgroundColor: Colors.border, marginVertical: 28 },
  sectionTitle: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 16 },
  relationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  relationBtn: {
    width: '47%', alignItems: 'center', justifyContent: 'center',
    backgroundColor: Colors.white, borderRadius: 14, borderWidth: 2, borderColor: Colors.border,
    paddingVertical: 20, gap: 8, minHeight: 90,
  },
  relationBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.light },
  relationText: { fontSize: 16, fontWeight: '700', color: Colors.textSub },
  relationTextSelected: { color: Colors.dark },
  livingArea: { gap: 12 },
  livingBtn: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: Colors.white, borderRadius: 14, borderWidth: 2, borderColor: Colors.border,
    padding: 18, gap: 14, minHeight: 64,
  },
  livingBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.light },
  livingText: { flex: 1, fontSize: 18, fontWeight: '600', color: Colors.textSub },
  livingTextSelected: { color: Colors.dark },
  radioOuter: { width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center' },
  radioOuterSelected: { borderColor: Colors.primary },
  radioInner: { width: 12, height: 12, borderRadius: 6, backgroundColor: Colors.primary },
  bottomArea: { paddingHorizontal: 24, gap: 12 },
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
