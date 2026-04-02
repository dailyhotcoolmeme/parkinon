import React, { useState } from 'react';
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
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

type Gender = 'male' | 'female';
type Cohabiting = 'together' | 'apart';

const BIRTH_YEARS = Array.from({ length: 60 }, (_, i) => 1930 + i);
const DIAGNOSIS_YEARS = Array.from({ length: 40 }, (_, i) => 1985 + i);
const RELATIONS = ['배우자', '자녀', '형제/자매', '기타'];

// 더미: 환자 역할
const IS_PATIENT = true;

export function ProfileEditScreen() {
  const navigation = useNavigation();

  const [name, setName] = useState('홍길동');
  const [birthYear, setBirthYear] = useState(1955);
  const [gender, setGender] = useState<Gender>('male');
  const [diagnosisYear, setDiagnosisYear] = useState(2020);
  const [relation, setRelation] = useState('배우자');
  const [cohabiting, setCohabiting] = useState<Cohabiting>('together');

  const [showBirthPicker, setShowBirthPicker] = useState(false);
  const [showDiagnosisPicker, setShowDiagnosisPicker] = useState(false);
  const [showRelationPicker, setShowRelationPicker] = useState(false);

  const handleSave = () => {
    if (!name.trim()) {
      Alert.alert('이름 확인', '이름을 입력해주세요.');
      return;
    }
    Alert.alert('저장 완료', '프로필이 저장됐어요.', [
      { text: '확인', onPress: () => navigation.goBack() },
    ]);
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="프로필 수정" showBack />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
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
        <Text style={styles.label}>출생연도</Text>
        <TouchableOpacity
          style={styles.picker}
          onPress={() => {
            setShowBirthPicker(!showBirthPicker);
            setShowDiagnosisPicker(false);
            setShowRelationPicker(false);
          }}
          activeOpacity={0.8}
        >
          <Text style={styles.pickerText}>{birthYear}년</Text>
          <Text style={styles.pickerChevron}>{showBirthPicker ? '▲' : '▼'}</Text>
        </TouchableOpacity>
        {showBirthPicker && (
          <ScrollView style={styles.pickerList} nestedScrollEnabled>
            {BIRTH_YEARS.map(y => (
              <TouchableOpacity
                key={y}
                style={[styles.pickerItem, birthYear === y && styles.pickerItemActive]}
                onPress={() => { setBirthYear(y); setShowBirthPicker(false); }}
              >
                <Text style={[styles.pickerItemText, birthYear === y && styles.pickerItemTextActive]}>
                  {y}년
                </Text>
              </TouchableOpacity>
            ))}
          </ScrollView>
        )}

        {/* 성별 */}
        <Text style={styles.label}>성별</Text>
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

        {/* 진단연도 (환자만) */}
        {IS_PATIENT && (
          <>
            <Text style={styles.label}>진단연도</Text>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => {
                setShowDiagnosisPicker(!showDiagnosisPicker);
                setShowBirthPicker(false);
                setShowRelationPicker(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerText}>{diagnosisYear}년</Text>
              <Text style={styles.pickerChevron}>{showDiagnosisPicker ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showDiagnosisPicker && (
              <ScrollView style={styles.pickerList} nestedScrollEnabled>
                {DIAGNOSIS_YEARS.map(y => (
                  <TouchableOpacity
                    key={y}
                    style={[styles.pickerItem, diagnosisYear === y && styles.pickerItemActive]}
                    onPress={() => { setDiagnosisYear(y); setShowDiagnosisPicker(false); }}
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
          </>
        )}

        {/* 관계 (보호자만) */}
        {!IS_PATIENT && (
          <>
            <Text style={styles.label}>관계</Text>
            <TouchableOpacity
              style={styles.picker}
              onPress={() => {
                setShowRelationPicker(!showRelationPicker);
                setShowBirthPicker(false);
                setShowDiagnosisPicker(false);
              }}
              activeOpacity={0.8}
            >
              <Text style={styles.pickerText}>{relation}</Text>
              <Text style={styles.pickerChevron}>{showRelationPicker ? '▲' : '▼'}</Text>
            </TouchableOpacity>
            {showRelationPicker && (
              <View style={styles.pickerList}>
                {RELATIONS.map(r => (
                  <TouchableOpacity
                    key={r}
                    style={[styles.pickerItem, relation === r && styles.pickerItemActive]}
                    onPress={() => { setRelation(r); setShowRelationPicker(false); }}
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

            {/* 거주 여부 (보호자만) */}
            <Text style={styles.label}>거주</Text>
            <View style={styles.segRow}>
              <TouchableOpacity
                style={[styles.segBtn, cohabiting === 'together' && styles.segBtnActive]}
                onPress={() => setCohabiting('together')}
                activeOpacity={0.8}
              >
                <Text style={[styles.segBtnText, cohabiting === 'together' && styles.segBtnTextActive]}>
                  함께
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.segBtn, cohabiting === 'apart' && styles.segBtnActive]}
                onPress={() => setCohabiting('apart')}
                activeOpacity={0.8}
              >
                <Text style={[styles.segBtnText, cohabiting === 'apart' && styles.segBtnTextActive]}>
                  따로
                </Text>
              </TouchableOpacity>
            </View>
          </>
        )}

        {/* 저장 버튼 */}
        <TouchableOpacity style={styles.saveBtn} onPress={handleSave} activeOpacity={0.85}>
          <Text style={styles.saveBtnText}>저장하기</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 20, paddingBottom: 60 },

  label: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 10,
    marginTop: 24,
  },

  input: {
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
    fontSize: 20,
    color: Colors.text,
    backgroundColor: Colors.white,
  },

  picker: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: Colors.border,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 18,
    backgroundColor: Colors.white,
  },
  pickerText: { flex: 1, fontSize: 20, color: Colors.text },
  pickerChevron: { fontSize: 16, color: Colors.textSub },

  pickerList: {
    maxHeight: 200,
    backgroundColor: Colors.white,
    borderWidth: 1,
    borderColor: Colors.border,
    borderRadius: 10,
    marginTop: 4,
  },
  pickerItem: {
    paddingHorizontal: 16,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  pickerItemActive: { backgroundColor: Colors.light },
  pickerItemText: { fontSize: 20, color: Colors.text },
  pickerItemTextActive: { color: Colors.dark, fontWeight: '700' },

  segRow: { flexDirection: 'row', gap: 12 },
  segBtn: {
    flex: 1,
    paddingVertical: 20,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  segBtnActive: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  segBtnText: { fontSize: 20, color: Colors.textSub, fontWeight: '600' },
  segBtnTextActive: { color: Colors.dark, fontWeight: '700' },

  saveBtn: {
    marginTop: 40,
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingVertical: 18,
    alignItems: 'center',
    minHeight: 56,
  },
  saveBtnText: { fontSize: 20, fontWeight: '700', color: Colors.white },
});
