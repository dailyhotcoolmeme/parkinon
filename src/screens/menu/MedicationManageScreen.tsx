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
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

interface Medication {
  id: string;
  name: string;
  dosage: string;
  schedule: string;
}

const DUMMY_MEDICATIONS: Medication[] = [
  {
    id: '1',
    name: '레보도파 250mg',
    dosage: '250mg · 1정',
    schedule: '아침, 점심, 저녁',
  },
  {
    id: '2',
    name: '미라펙스 0.5mg',
    dosage: '0.5mg · 1정',
    schedule: '아침, 저녁',
  },
  {
    id: '3',
    name: '콤탄 200mg',
    dosage: '200mg · 1정',
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
          onPress: () =>
            setMedications(prev => prev.filter(m => m.id !== med.id)),
        },
      ],
    );
  };

  const handleAddManual = () => {
    Alert.alert('약 추가', '약 직접 추가 기능은 준비 중이에요.');
  };

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="약 관리" showBack />
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        {/* ── 처방전으로 등록하기 ── */}
        <TouchableOpacity
          style={styles.prescriptionBtn}
          onPress={handlePrescriptionRegister}
          activeOpacity={0.8}
        >
          <View style={styles.prescriptionIconCircle}>
            <Text style={styles.prescriptionIconEmoji}>📷</Text>
          </View>
          <View style={styles.prescriptionTextGroup}>
            <Text style={styles.prescriptionTitle}>처방전으로 등록하기</Text>
            <Text style={styles.prescriptionSub}>처방전 사진을 찍으면 자동으로 입력돼요</Text>
          </View>
          <Ionicons name="chevron-forward" size={24} color={Colors.primary} />
        </TouchableOpacity>

        {/* ── Add manual button ── */}
        <TouchableOpacity
          style={styles.addBtn}
          onPress={handleAddManual}
          activeOpacity={0.8}
        >
          <Ionicons name="add-circle-outline" size={24} color={Colors.primary} />
          <Text style={styles.addBtnText}>약 직접 추가하기</Text>
        </TouchableOpacity>

        {/* ── Section header ── */}
        <Text style={styles.sectionHeader}>
          {'💊 등록된 약 '}
          <Text style={styles.sectionHeaderCount}>({medications.length})</Text>
        </Text>

        {/* ── Empty state ── */}
        {medications.length === 0 && (
          <View style={styles.emptyCard}>
            <Ionicons name="medkit-outline" size={56} color={Colors.textHint} />
            <Text style={styles.emptyTitle}>등록된 약이 없어요</Text>
            <Text style={styles.emptyDesc}>
              {'처방전 등록 또는 아래 버튼으로\n약을 추가해보세요'}
            </Text>
          </View>
        )}

        {/* ── Medication cards ── */}
        {medications.map(med => (
          <View key={med.id} style={styles.medCard}>
            {/* Top row */}
            <View style={styles.medTopRow}>
              <View style={styles.medIconCircle}>
                <Text style={styles.medIconEmoji}>💊</Text>
              </View>
              <View style={styles.medInfoGroup}>
                <Text style={styles.medName}>{med.name}</Text>
                <Text style={styles.medSchedule}>{med.schedule}</Text>
                <Text style={styles.medDosage}>{med.dosage}</Text>
              </View>
            </View>

            {/* Bottom row: action buttons */}
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
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: Colors.white,
  },
  scroll: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },

  // ── Prescription button ──
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
    marginBottom: 20,
  },
  prescriptionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  prescriptionIconEmoji: {
    fontSize: 28,
  },
  prescriptionTextGroup: {
    flex: 1,
    marginHorizontal: 16,
  },
  prescriptionTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.primary,
  },
  prescriptionSub: {
    fontSize: 15,
    color: Colors.textSub,
    marginTop: 4,
  },

  // ── Section header ──
  sectionHeader: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
    marginTop: 8,
  },
  sectionHeaderCount: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
  },

  // ── Empty card ──
  emptyCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    alignItems: 'center',
    paddingVertical: 48,
    paddingHorizontal: 20,
  },
  emptyTitle: {
    fontSize: 20,
    color: Colors.textSub,
    marginTop: 16,
    fontWeight: '600',
  },
  emptyDesc: {
    fontSize: 16,
    color: Colors.textHint,
    textAlign: 'center',
    marginTop: 8,
    lineHeight: 24,
  },

  // ── Medication card ──
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
  medTopRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  medIconCircle: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#E8F5E9',
    alignItems: 'center',
    justifyContent: 'center',
  },
  medIconEmoji: {
    fontSize: 26,
  },
  medInfoGroup: {
    flex: 1,
    marginLeft: 16,
  },
  medName: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
  },
  medSchedule: {
    fontSize: 17,
    color: Colors.textSub,
    marginTop: 4,
  },
  medDosage: {
    fontSize: 15,
    color: Colors.textHint,
    marginTop: 2,
  },
  medBtnRow: {
    flexDirection: 'row',
    marginTop: 16,
    gap: 10,
  },
  editBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.primary,
  },
  deleteBtn: {
    flex: 1,
    height: 52,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.danger,
  },

  // ── Add manual button ──
  addBtn: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    height: 64,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
    gap: 8,
    marginBottom: 20,
  },
  addBtnText: {
    fontSize: 20,
    fontWeight: '600',
    color: Colors.primary,
  },
});
