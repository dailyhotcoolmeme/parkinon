import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  Dimensions,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { MealTimeModal } from './MealTimeModal';
import { BodyStatePopupModal } from '../../components/common/BodyStatePopupModal';
import { CaregiverConfirmModal } from '../../components/common/CaregiverConfirmModal';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useMedication } from '../../hooks/useMedication';
import { useAuth } from '../../context/AuthContext';

const DUMMY_PATIENT_NAME = '홍길동';
const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;

type MealTime = 'morning' | 'lunch' | 'dinner' | 'bedtime';

interface MedicationStatus {
  id: MealTime;
  label: string;
  time: string;
  taken: boolean;
  takenAt?: string;
}

const MEAL_TIME_LABELS: Record<MealTime, { label: string; time: string }> = {
  morning: { label: '아침', time: '오전 8:00' },
  lunch: { label: '점심', time: '오후 12:00' },
  dinner: { label: '저녁', time: '오후 6:00' },
  bedtime: { label: '취침', time: '오후 10:00' },
};

// 목업 복용 기록
const MOCK_TAKEN_LIST: MedicationStatus[] = [
  { id: 'morning', label: '아침', time: '오전 8:00', taken: true, takenAt: '오전 8:12' },
  { id: 'lunch', label: '점심', time: '오후 12:00', taken: true, takenAt: '오후 12:05' },
  { id: 'dinner', label: '저녁', time: '오후 6:00', taken: false },
  { id: 'bedtime', label: '취침', time: '오후 10:00', taken: false },
];

function getTodayLabel(): string {
  const now = new Date();
  const month = now.getMonth() + 1;
  const date = now.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${date}일 ${dayNames[now.getDay()]}`;
}

export function MedicationScreen() {
  const navigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { todayStatus, takeMedication } = useMedication();
  const insets = useSafeAreaInsets();

  const [showCaregiverConfirm, setShowCaregiverConfirm] = useState(false);
  const [showMealTimeModal, setShowMealTimeModal] = useState(false);
  const [showBodyStatePopup, setShowBodyStatePopup] = useState(false);

  const userRole = (user?.role === 'caregiver' ? 'caregiver_same' : 'patient') as
    'patient' | 'caregiver_same' | 'caregiver_separate';

  const handleMealTimeSelect = async (mealTime: MealTime) => {
    setShowMealTimeModal(false);
    await takeMedication(mealTime);
    setShowBodyStatePopup(true);
  };

  // 표시용 목업 데이터 (실제 연동 전)
  const displayList = MOCK_TAKEN_LIST;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar
        title="파킨온"
        showMenu
        onMenuPress={() => navigation.navigate('Menu')}
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getTodayLabel()}</Text>
        <TouchableOpacity style={styles.calBtn}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={[
              styles.mainButton,
              userRole === 'caregiver_separate' && styles.mainButtonDisabled,
            ]}
            onPress={() => {
              if (userRole === 'caregiver_separate') return;
              if (userRole === 'caregiver_same') {
                setShowCaregiverConfirm(true);
              } else {
                setShowMealTimeModal(true);
              }
            }}
            activeOpacity={0.85}
          >
            <View style={styles.mainButtonInner}>
              <Ionicons name="medkit" size={40} color={Colors.white} />
              <Text style={styles.mainButtonText}>약 먹었어요</Text>
            </View>
          </TouchableOpacity>

          {userRole === 'caregiver_separate' && (
            <Text style={styles.caregiverNotice}>같이 계신 경우에만 대신 입력할 수 있어요</Text>
          )}
        </View>

        {/* 오늘 복용 현황 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.divider} />
            <Text style={styles.sectionTitle}>오늘 복용 현황</Text>
            <View style={styles.divider} />
          </View>
          {displayList.map(item => (
            <View key={item.id} style={[styles.card, !item.taken && styles.cardIncomplete]}>
              <View style={[styles.sideBar, item.taken ? styles.sideBarDone : styles.sideBarPending]} />
              <Ionicons
                name={item.taken ? 'checkmark-circle' : 'time-outline'}
                size={28}
                color={item.taken ? Colors.primary : Colors.accent}
                style={styles.cardIcon}
              />
              <View style={styles.cardBody}>
                <Text style={styles.cardLabel}>{item.label} 약</Text>
                <Text style={styles.cardTime}>
                  {item.taken ? `${item.takenAt} 복용 완료` : `${item.time} 예정`}
                </Text>
              </View>
              <View style={[styles.cardBadge, !item.taken && styles.cardBadgeIncomplete]}>
                <Text style={[styles.cardBadgeText, !item.taken && styles.cardBadgeTextIncomplete]}>
                  {item.taken ? '완료' : '미완료'}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>

      <MealTimeModal
        visible={showMealTimeModal}
        onSelect={handleMealTimeSelect}
        onClose={() => setShowMealTimeModal(false)}
      />
      <CaregiverConfirmModal
        visible={showCaregiverConfirm}
        patientName={DUMMY_PATIENT_NAME}
        onConfirm={() => { setShowCaregiverConfirm(false); setShowMealTimeModal(true); }}
        onCancel={() => setShowCaregiverConfirm(false)}
      />
      <BodyStatePopupModal
        visible={showBodyStatePopup}
        prevBodyScore={3}
        onClose={() => setShowBodyStatePopup(false)}
        onSave={() => setShowBodyStatePopup(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },

  dateHeader: {
    height: DATE_HEADER_H,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: Colors.background,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
    paddingHorizontal: 20,
  },
  dateText: { fontSize: 26, fontWeight: '800', color: Colors.text },
  calBtn: { padding: 4 },

  scroll: { flex: 1 },
  scrollContent: { flexGrow: 1 },

  centerBlock: {
    justifyContent: 'flex-start',
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 40,
  },

  mainButton: {
    backgroundColor: Colors.primary,
    borderRadius: 16,
    width: '100%',
    height: 220,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 6,
  },
  mainButtonDisabled: { backgroundColor: Colors.border },
  mainButtonInner: { alignItems: 'center', gap: 12 },
  mainButtonText: { fontSize: 28, fontWeight: '800', color: Colors.white },

  caregiverNotice: {
    marginTop: 14,
    fontSize: 14,
    color: Colors.textSub,
    textAlign: 'center',
  },

  records: { paddingHorizontal: 24, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14, gap: 8 },
  divider: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, paddingHorizontal: 4 },

  card: {
    flexDirection: 'row',
    alignItems: 'center',
    borderRadius: 16,
    overflow: 'hidden',
    minHeight: 96,
    marginBottom: 10,
    backgroundColor: '#F1F8E9',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 3,
  },
  cardIncomplete: {
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.border,
    elevation: 1,
    shadowOpacity: 0.04,
  },
  sideBar: { width: 6, alignSelf: 'stretch' },
  sideBarDone: { backgroundColor: Colors.primary },
  sideBarPending: { backgroundColor: Colors.accent },
  cardIcon: { marginLeft: 14, marginRight: 14 },
  cardBody: { flex: 1 },
  cardLabel: { fontSize: 20, fontWeight: '600', color: Colors.text, marginBottom: 3 },
  cardTime: { fontSize: 17, color: Colors.textSub },
  cardBadge: { backgroundColor: Colors.primary, borderRadius: 8, paddingHorizontal: 14, paddingVertical: 6 },
  cardBadgeIncomplete: { backgroundColor: 'transparent', borderWidth: 1, borderColor: Colors.border },
  cardBadgeText: { fontSize: 16, fontWeight: '700', color: Colors.white },
  cardBadgeTextIncomplete: { color: Colors.textSub },
});
