import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

interface Medication {
  id: string;
  name: string;
  dosage: string;
  schedule: string;
  imageUri?: string;
}

const DUMMY_MEDICATIONS: Medication[] = [
  {
    id: '1',
    name: '레보도파 250mg',
    dosage: '250mg',
    schedule: '아침, 점심, 저녁',
  },
  {
    id: '2',
    name: '미라펙스 0.5mg',
    dosage: '0.5mg',
    schedule: '아침, 저녁',
  },
  {
    id: '3',
    name: '콤탄 200mg',
    dosage: '200mg',
    schedule: '아침, 점심, 저녁, 취침',
  },
];

export function MedicationManageScreen() {
  const [medications, setMedications] = useState<Medication[]>(DUMMY_MEDICATIONS);

  const handlePrescriptionRegister = () => {
    Alert.alert('처방전 등록', '처방전 사진 등록 기능은 준비 중이에요.');
  };

  const handleEdit = (med: Medication) => {
    Alert.alert('약 수정', `${med.name} 수정 기능은 준비 중이에요.`);
  };

  const handleDelete = (med: Medication) => {
    Alert.alert(
      '약 삭제',
      `${med.name}을(를) 삭제할까요?\n삭제하면 복용 기록은 유지돼요.`,
      [
        { text: '취소', style: 'cancel' },
        {
          text: '삭제',
          style: 'destructive',
          onPress: () => setMedications(prev => prev.filter(m => m.id !== med.id)),
        },
      ],
    );
  };

  const handleAddManual = () => {
    Alert.alert('약 추가', '약 직접 추가 기능은 준비 중이에요.');
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="약 관리" showBack />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 처방전으로 등록 버튼 */}
        <TouchableOpacity
          style={styles.prescriptionBtn}
          onPress={handlePrescriptionRegister}
          activeOpacity={0.8}
        >
          <Text style={styles.prescriptionBtnIcon}>📷</Text>
          <Text style={styles.prescriptionBtnText}>처방전으로 등록하기</Text>
          <Text style={styles.prescriptionBtnChevron}>›</Text>
        </TouchableOpacity>

        {/* 등록된 약 목록 */}
        <Text style={styles.sectionTitle}>등록된 약</Text>

        {medications.length === 0 && (
          <View style={styles.emptyBox}>
            <Text style={styles.emptyText}>등록된 약이 없어요.</Text>
            <Text style={styles.emptySubText}>아래 버튼으로 약을 추가해보세요.</Text>
          </View>
        )}

        {medications.map(med => (
          <View key={med.id} style={styles.medCard}>
            {/* 약 이미지 */}
            <View style={styles.medImageBox}>
              <Text style={styles.medImagePlaceholder}>💊</Text>
            </View>

            {/* 약 정보 */}
            <View style={styles.medInfo}>
              <Text style={styles.medName}>{med.name}</Text>
              <Text style={styles.medSchedule}>{med.schedule}</Text>

              <View style={styles.medBtnRow}>
                <TouchableOpacity
                  style={styles.editBtn}
                  onPress={() => handleEdit(med)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.editBtnText}>수정</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={styles.deleteBtn}
                  onPress={() => handleDelete(med)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.deleteBtnText}>삭제</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        ))}

        {/* 직접 추가 버튼 */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddManual}
          activeOpacity={0.8}
        >
          <Text style={styles.addBtnText}>+ 약 직접 추가하기</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  prescriptionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 24,
    borderWidth: 2,
    borderColor: Colors.primary,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  prescriptionBtnIcon: { fontSize: 24, marginRight: 12 },
  prescriptionBtnText: {
    flex: 1,
    fontSize: 18,
    fontWeight: '600',
    color: Colors.primary,
  },
  prescriptionBtnChevron: { fontSize: 22, color: Colors.primary },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 14,
  },

  emptyBox: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 32,
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyText: { fontSize: 20, fontWeight: '600', color: Colors.textSub, marginBottom: 8 },
  emptySubText: { fontSize: 17, color: Colors.textHint },

  medCard: {
    flexDirection: 'row',
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  medImageBox: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
  },
  medImagePlaceholder: { fontSize: 36 },
  medInfo: { flex: 1 },
  medName: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 4 },
  medSchedule: { fontSize: 17, color: Colors.textSub, marginBottom: 12 },

  medBtnRow: { flexDirection: 'row', gap: 8 },
  editBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
  },
  editBtnText: { fontSize: 18, fontWeight: '600', color: Colors.primary },
  deleteBtn: {
    flex: 1,
    paddingVertical: 14,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    alignItems: 'center',
  },
  deleteBtnText: { fontSize: 18, fontWeight: '600', color: Colors.danger },

  addBtn: {
    marginTop: 8,
    paddingVertical: 18,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    alignItems: 'center',
  },
  addBtnText: { fontSize: 20, fontWeight: '600', color: Colors.textSub },
});
