import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  TextInput,
  StyleSheet,
  Alert,
  Modal,
  FlatList,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Gender = 'male' | 'female';
type Cohabiting = 'together' | 'apart';

const BIRTH_YEARS = Array.from({ length: 60 }, (_, i) => 1930 + i);
const DIAGNOSIS_YEARS = Array.from({ length: 40 }, (_, i) => 1985 + i);
const RELATIONS = ['배우자', '자녀', '형제/자매', '기타'];

export function ProfileEditScreen() {
  const navigation = useNavigation<any>();
  const { user, refreshUser } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const isPatient = user?.role === 'patient';

  const [name, setName] = useState('');
  const [birthYear, setBirthYear] = useState(1960);
  const [gender, setGender] = useState<Gender>('male');
  const [diagnosisYear, setDiagnosisYear] = useState(2020);
  const [relation, setRelation] = useState('배우자');
  const [relationOther, setRelationOther] = useState('');
  const [cohabiting, setCohabiting] = useState<Cohabiting>('together');

  type ActivePicker = 'myBirth' | 'myDiagnosis' | 'patientBirth' | 'patientDiagnosis' | null;
  const [activePicker, setActivePicker] = useState<ActivePicker>(null);
  const flatListRef = useRef<FlatList>(null);

  const [patientName, setPatientName] = useState('');
  const [patientBirthYear, setPatientBirthYear] = useState(1955);
  const [patientGender, setPatientGender] = useState<Gender>('male');
  const [patientDiagnosisYear, setPatientDiagnosisYear] = useState(2020);

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
      setRelationOther((freshUser as any).relation_note ?? '');
      setCohabiting(freshUser.residence_type === 'separate' ? 'apart' : 'together');
    }


    if (user.role === 'caregiver') {
      // patient_group_id 우선, 없으면 patient_group_members 직접 쿼리
      const groupId = freshUser?.patient_group_id ?? user.patient_group_id ?? null;
      let resolvedGroupId: string | null = groupId;

      if (!resolvedGroupId) {
        const { data: myMember } = await supabase
          .from('patient_group_members')
          .select('group_id')
          .eq('user_id', user.id)
          .maybeSingle();
        resolvedGroupId = myMember?.group_id ?? null;
      }

      if (resolvedGroupId) {
        const { data: patientMember } = await supabase
          .from('patient_group_members')
          .select('user_id')
          .eq('group_id', resolvedGroupId)
          .eq('role', 'patient')
          .single();

        if (patientMember?.user_id && patientMember.user_id !== user.id) {
          const { data: patient } = await supabase
            .from('users')
            .select('*')
            .eq('id', patientMember.user_id)
            .single();

          if (patient) {
            setPatientId(patient.id);
            setPatientName(patient.name ?? '');
            setPatientBirthYear(patient.birth_year ?? 1955);
            setPatientGender((patient.gender as Gender) ?? 'male');
            setPatientDiagnosisYear(patient.diagnosis_year ?? 2020);
          }
        }
      }
    }
  }, [user]);

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

  const activePickerYears =
    activePicker === 'myBirth' || activePicker === 'patientBirth' ? BIRTH_YEARS : DIAGNOSIS_YEARS;

  const activePickerValue =
    activePicker === 'myBirth' ? birthYear
    : activePicker === 'myDiagnosis' ? diagnosisYear
    : activePicker === 'patientBirth' ? patientBirthYear
    : patientDiagnosisYear;

  const setActivePickerValue = (y: number) => {
    if (activePicker === 'myBirth') setBirthYear(y);
    else if (activePicker === 'myDiagnosis') setDiagnosisYear(y);
    else if (activePicker === 'patientBirth') setPatientBirthYear(y);
    else if (activePicker === 'patientDiagnosis') setPatientDiagnosisYear(y);
  };

  const activePickerTitle =
    activePicker === 'myBirth' ? '출생연도'
    : activePicker === 'myDiagnosis' ? '진단연도'
    : activePicker === 'patientBirth' ? '환자 출생연도'
    : '진단 연도';

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
                relation_note: relation === '기타' ? relationOther.trim() : null,
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
      } else if (!isPatient && !patientId) {
        // 보호자인데 연동된 환자가 없으면 본인 정보는 저장됐음을 알리고 환자 미연동 안내
        Alert.alert(
          '저장 완료 (환자 미연동)',
          '내 정보는 저장됐어요.\n\n담당 환자가 연동되어 있지 않아 환자 정보는 저장할 수 없어요. 가족 연동 메뉴에서 환자를 먼저 연동해주세요.',
          [
            {
              text: '확인',
              onPress: async () => {
                await refreshUser();
                navigation.goBack();
              },
            },
          ]
        );
        setSaving(false);
        return;
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
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <TopBar
        title="프로필 수정"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

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
            onPress={() => setActivePicker('myBirth')}
            activeOpacity={0.8}
          >
            <Text style={styles.pickerText}>{birthYear}년</Text>
            <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
          </TouchableOpacity>
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
              onPress={() => setActivePicker('myDiagnosis')}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerText}>{diagnosisYear}년</Text>
              <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
            </TouchableOpacity>
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

              <View style={styles.relationGrid}>
                {RELATIONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.relBtn, relation === r && styles.relBtnActive]}
                    onPress={() => setRelation(r)}
                    activeOpacity={0.8}
                  >
                    <Text style={[styles.relBtnText, relation === r && styles.relBtnTextActive]}>
                      {r}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
              {relation === '기타' && (
                <>
                  <Text style={[styles.label, { marginTop: 16 }]}>어떤 관계인가요?</Text>
                  <TextInput
                    style={styles.input}
                    value={relationOther}
                    onChangeText={setRelationOther}
                    placeholder="예: 친구, 간병인, 이웃 등"
                    placeholderTextColor={Colors.textHint}
                    returnKeyType="done"
                    maxLength={30}
                  />
                </>
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

              {/* 환자 미연동 안내 배너 */}
              {!patientId && (
                <View style={styles.noPatientBanner}>
                  <Ionicons name="alert-circle-outline" size={20} color="#B45309" />
                  <Text style={styles.noPatientBannerText}>
                    연동된 환자가 없어요. 가족 연동 메뉴에서 환자를 먼저 연동해주세요.
                  </Text>
                </View>
              )}

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
                onPress={() => setActivePicker('patientBirth')}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{patientBirthYear}년</Text>
                <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
              </TouchableOpacity>

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
                onPress={() => setActivePicker('patientDiagnosis')}
                activeOpacity={0.8}
              >
                <Text style={styles.pickerText}>{patientDiagnosisYear}년</Text>
                <Ionicons name="chevron-down" size={22} color={Colors.textSub} />
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 공용 연도 선택 Modal */}
        <Modal
          visible={activePicker !== null}
          transparent
          animationType="fade"
          onRequestClose={() => setActivePicker(null)}
        >
          <TouchableOpacity
            style={styles.modalOverlay}
            activeOpacity={1}
            onPress={() => setActivePicker(null)}
          >
            <View style={styles.modalSheet}>
              <Text style={styles.modalTitle}>{activePickerTitle}</Text>
              <FlatList
                ref={flatListRef}
                data={activePickerYears}
                keyExtractor={y => String(y)}
                initialScrollIndex={Math.max(0, activePickerYears.indexOf(activePickerValue))}
                renderItem={({ item: y }) => (
                  <TouchableOpacity
                    style={[styles.pickerItem, activePickerValue === y && styles.pickerItemActive]}
                    onPress={() => {
                      setActivePickerValue(y);
                      setActivePicker(null);
                    }}
                  >
                    <Text style={[styles.pickerItemText, activePickerValue === y && styles.pickerItemTextActive]}>
                      {y}년
                    </Text>
                  </TouchableOpacity>
                )}
                onLayout={() => {
                  setTimeout(() => {
                    const idx = activePickerYears.indexOf(activePickerValue);
                    if (idx >= 0) {
                      const viewPos = (activePicker === 'patientBirth' || activePicker === 'patientDiagnosis') ? -0.1 : -0.5;
                      flatListRef.current?.scrollToIndex({ index: idx, animated: false, viewPosition: viewPos });
                    }
                  }, 50);
                }}
                getItemLayout={(_, index) => ({ length: 56, offset: 56 * index, index })}
                onScrollToIndexFailed={() => {}}
                scrollEventThrottle={16}
              />
            </View>
          </TouchableOpacity>
        </Modal>

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

  // Modal overlay & sheet
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalSheet: {
    width: '80%',
    maxHeight: 320,
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
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

  // Relation grid
  relationGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  relBtn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    minWidth: 80,
    alignItems: 'center',
  },
  relBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  relBtnText: { fontSize: 18, fontWeight: '600', color: Colors.textSub },
  relBtnTextActive: { color: Colors.dark },

  // No patient banner
  noPatientBanner: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    backgroundColor: '#FEF3C7',
    borderRadius: 10,
    padding: 12,
    marginBottom: 16,
  },
  noPatientBannerText: {
    flex: 1,
    fontSize: 16,
    color: '#92400E',
    lineHeight: 22,
  },

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
