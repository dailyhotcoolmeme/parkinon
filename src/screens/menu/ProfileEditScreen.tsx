import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { useFamilyLink } from '../../hooks/useFamilyLink';
import { supabase } from '../../lib/supabase';

type Gender = 'male' | 'female';
type Cohabiting = 'together' | 'apart';

const BIRTH_YEARS = Array.from({ length: 60 }, (_, i) => 1930 + i);
const DIAGNOSIS_YEARS = Array.from({ length: 40 }, (_, i) => 1985 + i);
const RELATIONS = ['배우자', '자녀', '형제/자매', '기타'];

export function ProfileEditScreen() {
  const navigation = useNavigation();
  const { user, refreshUser } = useAuth();
  const { getPatientForCaregiver } = useFamilyLink();
  const isPatient = user?.role === 'patient';

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState(1960);
  const [gender, setGender] = useState<Gender>('male');
  const [diagnosisYear, setDiagnosisYear] = useState(2020);
  const [relation, setRelation] = useState('배우자');
  const [cohabiting, setCohabiting] = useState<Cohabiting>('together');

  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const [showDiagnosisPicker, setShowDiagnosisPicker] = useState(false);
  const [showRelationPicker, setShowRelationPicker] = useState(false);

  const [patientName, setPatientName] = useState('');
  const [patientBirthYear, setPatientBirthYear] = useState(1955);
  const [patientGender, setPatientGender] = useState<Gender>('male');
  const [patientDiagnosisYear, setPatientDiagnosisYear] = useState(2020);
  const [showPatientBirthPicker, setShowPatientBirthPicker] = useState(false);
  const [showPatientDiagnosisPicker, setShowPatientDiagnosisPicker] = useState(false);

  const [saving, setSaving] = useState(false);
  const [patientId, setPatientId] = useState<string | null>(null);

  const relEngToKor: Record<string, string> = {
    spouse: '배우자', child: '자녀', sibling: '형제/자매', other: '기타',
  };
  const relKorToEng: Record<string, string> = {
    '배우자': 'spouse', '자녀': 'child', '형제/자매': 'sibling', '기타': 'other',
  };

  // 화면 진입 시마다 DB에서 직접 최신 데이터를 불러와 폼 초기화
  // useEffect([user]) 대신 useFocusEffect를 사용해
  // 저장 후 refreshUser()가 user를 갱신해도 폼이 리셋되지 않도록 함
  const loadedRef = useRef(false);

  const loadFormData = useCallback(async () => {
    if (!user) return;

    // DB에서 직접 최신 사용자 데이터 조회
    const { data: freshUser, error } = await supabase
      .from('users')
      .select('*')
      .eq('id', user.id)
      .single();

    if (error || !freshUser) {
      // DB 조회 실패 시 AuthContext user 값으로 폴백
      setName(user.name ?? '');
      setBirthYear(user.birth_year ?? 1960);
      setGender((user.gender as Gender) ?? 'male');
      setDiagnosisYear(user.diagnosis_year ?? 2020);
      setRelation(relEngToKor[user.caregiver_relation ?? ''] ?? '배우자');
      setCohabiting(user.residence_type === 'separate' ? 'apart' : 'together');
    } else {
      setName(freshUser.name ?? '');
      setBirthYear(freshUser.birth_year ?? 1960);
      setGender((freshUser.gender as Gender) ?? 'male');
      setDiagnosisYear(freshUser.diagnosis_year ?? 2020);
      setRelation(relEngToKor[freshUser.caregiver_relation ?? ''] ?? '배우자');
      setCohabiting(freshUser.residence_type === 'separate' ? 'apart' : 'together');
    }

    if (user.role === 'caregiver') {
      getPatientForCaregiver().then(patient => {
        if (patient) {
          setPatientId(patient.id);
          setPatientName(patient.name ?? '');
          setPatientBirthYear(patient.birth_year ?? 1955);
          setPatientGender((patient.gender as Gender) ?? 'male');
          setPatientDiagnosisYear(patient.diagnosis_year ?? 2020);
        }
      });
    }
  }, [user, getPatientForCaregiver]);

  // 화면에 포커스될 때마다 최신 데이터로 폼 초기화
  useFocusEffect(
    useCallback(() => {
      loadedRef.current = false;
      loadFormData();
      return () => {
        loadedRef.current = false;
      };
    }, [loadFormData])
  );

  // user가 null에서 실제 값으로 바뀌는 최초 로드 시에만 초기화 (useFocusEffect 보완)
  useEffect(() => {
    if (user && !loadedRef.current) {
      loadedRef.current = true;
      loadFormData();
    }
  }, [user, loadFormData]);

  const handleSave = async () => {
    if (!name.trim()) {
      Alert.alert('이름 확인', '이름을 입력해주세요.');
      return;
    }
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('users')
        .update({
          name: name.trim(),
          birth_year: birthYear,
          gender: gender,
          ...(isPatient
            ? { diagnosis_year: diagnosisYear }
            : {
                caregiver_relation: (relKorToEng[relation] ?? 'other') as 'spouse' | 'child' | 'sibling' | 'other',
                residence_type: cohabiting === 'together' ? 'together' : 'separate',
              }),
        })
        .eq('id', user.id);

      if (error) throw error;

      // 보호자이고 환자 정보도 수정한 경우
      if (!isPatient && patientId) {
        const { error: patientError } = await supabase
          .from('users')
          .update({
            name: patientName.trim(),
            birth_year: patientBirthYear,
            gender: patientGender,
            diagnosis_year: patientDiagnosisYear,
          })
          .eq('id', patientId);

        if (patientError) throw patientError;
      }

      // refreshUser는 Alert 확인 후 goBack 전에 호출하지 않고
      // goBack 직전에 호출해 user 변경이 현재 화면에 영향을 주지 않도록 함
      Alert.alert('저장 완료', '프로필이 저장됐어요.', [
        {
          text: '확인',
          onPress: async () => {
            await refreshUser();
            navigation.goBack();
          },
        },
      ]);
    } catch (e: any) {
      Alert.alert('오류', e.message ?? '저장 중 문제가 생겼어요. 다시 시도해주세요.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="프로필 수정" showBack />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        {/* Section 1: 내 정보 */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="person-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>내 정보</Text>
          </View>

          {/* 이름 */}
          <Text style={styles.label}>이름</Text>
          <TextInput
            style={styles.input}
            value={name}
            onChangeText={setName}
            placeholder="이름을 입력해주세요"
            placeholderTextColor={Colors.textHint}
            returnKeyType="done"
          />

          {/* 출생연도 */}
          <Text style={[styles.label, { marginTop: 20 }]}>출생연도</Text>
          <TouchableOpacity
            style={styles.pickerRow}
            onPress={() => {
              setShowBirthPicker(!showBirthPicker);
              setShowDiagnosisPicker(false);
              setShowRelationPicker(false);
            }}
            activeOpacity={0.8}
          >
            <Text style={styles.pickerText}>{birthYear}년</Text>
            <Ionicons
              name={showBirthPicker ? 'chevron-up' : 'chevron-down'}
              size={22}
              color={Colors.textSub}
            />
          </TouchableOpacity>
          {showBirthPicker && (
            <ScrollView style={styles.pickerList} nestedScrollEnabled>
              {BIRTH_YEARS.map(y => (
                <TouchableOpacity
                  key={y}
                  style={[styles.pickerItem, birthYear === y && styles.pickerItemActive]}
                  onPress={() => {
                    setBirthYear(y);
                    setShowBirthPicker(false);
                  }}
                >
                  <Text
                    style={[
                      styles.pickerItemText,
                      birthYear === y && styles.pickerItemTextActive,
                    ]}
                  >
                    {y}년
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
          )}
        </View>

        {/* Section 2: 성별 */}
        <View style={styles.card}>
          <View style={styles.sectionHeader}>
            <Ionicons name="male-female-outline" size={22} color={Colors.primary} />
            <Text style={styles.sectionTitle}>성별</Text>
          </View>

          <View style={styles.segRow}>
            <TouchableOpacity
              style={[styles.segBtn, gender === 'male' && styles.segBtnActive]}
              onPress={() => setGender('male')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segBtnText, gender === 'male' && styles.segBtnTextActive]}>
                남자
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.segBtn, gender === 'female' && styles.segBtnActive]}
              onPress={() => setGender('female')}
              activeOpacity={0.8}
            >
              <Text style={[styles.segBtnText, gender === 'female' && styles.segBtnTextActive]}>
                여자
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        {/* Section 3: 진단 정보 (환자만) */}
        {isPatient && (
          <View style={styles.card}>
            <View style={styles.sectionHeader}>
              <Ionicons name="medical-outline" size={22} color={Colors.primary} />
              <Text style={styles.sectionTitle}>진단 정보</Text>
            </View>

            <Text style={styles.label}>진단연도</Text>
            <TouchableOpacity
              style={styles.pickerRow}
              onPress={() => {
                setShowDiagnosisPicker(!showDiagnosisPicker);
                setShowBirthPicker(false);
                setShowRelationPicker(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerText}>{diagnosisYear}년</Text>
              <Ionicons
                name={showDiagnosisPicker ? 'chevron-up' : 'chevron-down'}
                size={22}
                color={Colors.textSub}
              />
            </TouchableOpacity>
            {showDiagnosisPicker && (
              <ScrollView style={styles.pickerList} nestedScrollEnabled>
                {DIAGNOSIS_YEARS.map(y => (
                  <TouchableOpacity
                    key={y}
                    style={[styles.pickerItem, diagnosisYear === y && styles.pickerItemActive]}
                    onPress={() => {
                      setDiagnosisYear(y);
                      setShowDiagnosisPicker(false);
                    }}
                  >
                    <Text
                      style={[
                        styles.pickerItemText,
                        diagnosisYear === y && styles.pickerItemTextActive,
                      ]}
                    >
                      {y}년
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            )}
          </View>
        )}

        {/* 보호자 전용: 관계 + 거주 */}
        {!isPatient && (
          <>
            {/* 관계 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="people-outline" size={22} color={Colors.primary} />
                <Text style={styles.sectionTitle}>관계</Text>
              </View>

              <Text style={styles.label}>관계</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  setShowRelationPicker(!showRelationPicker);
                  setShowBirthPicker(false);
                  setShowDiagnosisPicker(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{relation}</Text>
                <Ionicons
                  name={showRelationPicker ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={Colors.textSub}
                />
              </TouchableOpacity>
              {showRelationPicker && (
                <View style={styles.pickerList}>
                  {RELATIONS.map(r => (
                    <TouchableOpacity
                      key={r}
                      style={[styles.pickerItem, relation === r && styles.pickerItemActive]}
                      onPress={() => {
                        setRelation(r);
                        setShowRelationPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          relation === r && styles.pickerItemTextActive,
                        ]}
                      >
                        {r}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              )}
            </View>

            {/* 거주 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="home-outline" size={22} color={Colors.primary} />
                <Text style={styles.sectionTitle}>거주</Text>
              </View>

              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.segBtn, cohabiting === 'together' && styles.segBtnActive]}
                  onPress={() => setCohabiting('together')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      cohabiting === 'together' && styles.segBtnTextActive,
                    ]}
                  >
                    함께
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, cohabiting === 'apart' && styles.segBtnActive]}
                  onPress={() => setCohabiting('apart')}
                  activeOpacity={0.8}
                >
                  <Text
                    style={[
                      styles.segBtnText,
                      cohabiting === 'apart' && styles.segBtnTextActive,
                    ]}
                  >
                    따로
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            {/* 담당 환자 정보 카드 */}
            <View style={styles.card}>
              <View style={styles.sectionHeader}>
                <Ionicons name="person-outline" size={22} color={Colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.sectionTitle}>담당 환자 정보</Text>
                  <Text style={[styles.label, { marginTop: 2, marginBottom: 0 }]}>
                    가족 연동된 환자의 정보를 수정해요
                  </Text>
                </View>
              </View>

              {/* 환자 이름 */}
              <Text style={styles.label}>환자 이름</Text>
              <TextInput
                style={styles.input}
                value={patientName}
                onChangeText={setPatientName}
                placeholder="환자 이름을 입력해주세요"
                placeholderTextColor={Colors.textHint}
                returnKeyType="done"
              />

              {/* 환자 출생연도 */}
              <Text style={[styles.label, { marginTop: 20 }]}>환자 출생연도</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  setShowPatientBirthPicker(!showPatientBirthPicker);
                  setShowPatientDiagnosisPicker(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{patientBirthYear}년</Text>
                <Ionicons
                  name={showPatientBirthPicker ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={Colors.textSub}
                />
              </TouchableOpacity>
              {showPatientBirthPicker && (
                <ScrollView style={styles.pickerList} nestedScrollEnabled>
                  {BIRTH_YEARS.map(y => (
                    <TouchableOpacity
                      key={y}
                      style={[styles.pickerItem, patientBirthYear === y && styles.pickerItemActive]}
                      onPress={() => {
                        setPatientBirthYear(y);
                        setShowPatientBirthPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          patientBirthYear === y && styles.pickerItemTextActive,
                        ]}
                      >
                        {y}년
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}

              {/* 환자 성별 */}
              <Text style={[styles.label, { marginTop: 20 }]}>환자 성별</Text>
              <View style={styles.segRow}>
                <TouchableOpacity
                  style={[styles.segBtn, patientGender === 'male' && styles.segBtnActive]}
                  onPress={() => setPatientGender('male')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segBtnText, patientGender === 'male' && styles.segBtnTextActive]}>
                    남자
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.segBtn, patientGender === 'female' && styles.segBtnActive]}
                  onPress={() => setPatientGender('female')}
                  activeOpacity={0.8}
                >
                  <Text style={[styles.segBtnText, patientGender === 'female' && styles.segBtnTextActive]}>
                    여자
                  </Text>
                </TouchableOpacity>
              </View>

              {/* 진단 연도 */}
              <Text style={[styles.label, { marginTop: 20 }]}>진단 연도</Text>
              <TouchableOpacity
                style={styles.pickerRow}
                onPress={() => {
                  setShowPatientDiagnosisPicker(!showPatientDiagnosisPicker);
                  setShowPatientBirthPicker(false);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{patientDiagnosisYear}년</Text>
                <Ionicons
                  name={showPatientDiagnosisPicker ? 'chevron-up' : 'chevron-down'}
                  size={22}
                  color={Colors.textSub}
                />
              </TouchableOpacity>
              {showPatientDiagnosisPicker && (
                <ScrollView style={styles.pickerList} nestedScrollEnabled>
                  {DIAGNOSIS_YEARS.map(y => (
                    <TouchableOpacity
                      key={y}
                      style={[styles.pickerItem, patientDiagnosisYear === y && styles.pickerItemActive]}
                      onPress={() => {
                        setPatientDiagnosisYear(y);
                        setShowPatientDiagnosisPicker(false);
                      }}
                    >
                      <Text
                        style={[
                          styles.pickerItemText,
                          patientDiagnosisYear === y && styles.pickerItemTextActive,
                        ]}
                      >
                        {y}년
                      </Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              )}
            </View>
          </>
        )}

        {/* 저장 버튼 */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85} disabled={saving}>
          <Text style={styles.saveBtnText}>{saving ? '저장 중...' : '저장하기'}</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 80,
  },

  // Card
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  // Section header inside card
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },

  // Label
  label: {
    fontSize: 16,
    fontWeight: '600',
    color: Colors.textSub,
    marginBottom: 8,
  },

  // Text input
  input: {
    height: 60,
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    fontSize: 22,
    color: Colors.text,
    backgroundColor: Colors.white,
  },

  // Picker row (touchable)
  pickerRow: {
    height: 60,
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 12,
    paddingHorizontal: 16,
    backgroundColor: Colors.white,
  },
  pickerText: { flex: 1, fontSize: 22, color: Colors.text },

  // Picker dropdown list
  pickerList: {
    maxHeight: 200,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 12,
    marginTop: 4,
  },
  pickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerItemActive: { backgroundColor: Colors.light },
  pickerItemText: { fontSize: 20, color: Colors.text },
  pickerItemTextActive: { color: Colors.dark, fontWeight: '700' },

  // Gender / cohabiting segment buttons
  segRow: { flexDirection: 'row', gap: 12 },
  segBtn: {
    flex: 1,
    height: 64,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
    justifyContent: 'center',
  },
  segBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.primary,
  },
  segBtnText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  segBtnTextActive: { color: Colors.white },

  // Save button
  saveBtn: {
    marginTop: 32,
    height: 64,
    borderRadius: 16,
    backgroundColor: Colors.accent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnText: { fontSize: 22, fontWeight: '700', color: Colors.white },
});
