import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Modal,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect, useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';
import { MenuStackParamList } from '../../navigation/MenuNavigator';
import { useDialog } from '../../context/DialogContext';

type NavProp = StackNavigationProp<MenuStackParamList>;
type RouteType = RouteProp<{ MedicalRecordDetail: { recordId: string } }, 'MedicalRecordDetail'>;

const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;

interface MedMed {
  id: string;
  medication_name: string;
  dosage?: string;
  change_type: 'added' | 'changed' | 'unchanged' | 'removed';
}

interface RecordDetail {
  id: string;
  visit_date: string;
  hospital_name: string;
  doctor_name?: string;
  consult_result?: string;
  prescription_image_url?: string;
  medical_record_medications: MedMed[];
}

function formatDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일`;
}

const CHANGE_TYPE_CONFIG: Record<
  MedMed['change_type'],
  { label: string; color: string; bgColor: string; icon: string }
> = {
  added: { label: '추가된 약', color: '#1565C0', bgColor: '#E3F2FD', icon: '🟢' },
  changed: { label: '변경된 약', color: '#B71C1C', bgColor: '#FFEBEE', icon: '🔴' },
  unchanged: { label: '유지된 약', color: Colors.textSub, bgColor: '#F5F5F5', icon: '⚪' },
  removed: { label: '삭제된 약', color: '#616161', bgColor: '#EEEEEE', icon: '🗑️' },
};

export function MedicalRecordDetailScreen() {
  const navigation = useNavigation<NavProp>();
  const route = useRoute<RouteType>();
  const recordId = (route.params as any)?.recordId as string;
  const { user } = useAuth();
  const { unreadCount } = useNotificationBadge();
  const dialog = useDialog();

  const [record, setRecord] = useState<RecordDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [imageModalVisible, setImageModalVisible] = useState(false);

  const getToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    return session?.access_token ?? SUPABASE_ANON_KEY;
  };

  const fetchRecord = useCallback(async () => {
    if (!user || !recordId) return;
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}&select=*,medical_record_medications(*)`,
        {
          headers: {
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${token}`,
          },
        }
      );
      if (!res.ok) throw new Error('진료 기록을 불러오지 못했어요.');
      const data: RecordDetail[] = await res.json();
      if (data.length === 0) throw new Error('진료 기록을 찾을 수 없어요.');
      setRecord(data[0]);
    } catch (e: any) {
      setError(e.message ?? '오류가 발생했어요.');
    } finally {
      setLoading(false);
    }
  }, [user, recordId]);

  useFocusEffect(
    useCallback(() => {
      fetchRecord();
    }, [fetchRecord])
  );

  const handleDelete = async () => {
    const ok = await dialog.confirm({
      title: '진료 기록 삭제',
      message: '이 진료 기록을 삭제할까요?\n삭제한 기록은 복구할 수 없어요.',
      confirmText: '삭제',
      cancelText: '취소',
      destructive: true,
    });
    if (!ok) return;
    try {
      const token = await getToken();
      const headers = {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${token}`,
      };
      // 처방약 먼저 삭제
      await fetch(
        `${SUPABASE_URL}/rest/v1/medical_record_medications?record_id=eq.${recordId}`,
        { method: 'DELETE', headers }
      );
      // 본 기록 삭제
      const res = await fetch(
        `${SUPABASE_URL}/rest/v1/medical_records?id=eq.${recordId}`,
        { method: 'DELETE', headers }
      );
      if (!res.ok) throw new Error('삭제에 실패했어요.');
      await dialog.alert({
        title: '삭제 완료',
        message: '진료 기록이 삭제되었어요.',
      });
      navigation.goBack();
    } catch (e: any) {
      dialog.alert({ title: '오류', message: e.message ?? '삭제에 실패했어요.' });
    }
  };

  const meds = record?.medical_record_medications ?? [];
  const changeOrder: MedMed['change_type'][] = ['added', 'changed', 'unchanged', 'removed'];

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <TopBar
        title="진료 기록 상세"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color={Colors.primary} />
        </View>
      ) : error ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity style={styles.retryBtn} onPress={fetchRecord}>
            <Text style={styles.retryBtnText}>다시 시도</Text>
          </TouchableOpacity>
        </View>
      ) : record ? (
        <ScrollView contentContainerStyle={styles.scroll}>
          {/* 기본 정보 */}
          <View style={styles.infoCard}>
            <View style={styles.infoCardHeader}>
              <View style={styles.infoCardIconWrap}>
                <Ionicons name="clipboard-outline" size={28} color={Colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.dateText}>{formatDate(record.visit_date)}</Text>
                <Text style={styles.hospitalText}>{record.hospital_name}</Text>
                {record.doctor_name ? (
                  <Text style={styles.doctorText}>{record.doctor_name} 선생님</Text>
                ) : null}
              </View>
            </View>
          </View>

          {/* 상담 결과 */}
          {record.consult_result ? (
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="chatbubble-outline" size={22} color={Colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>상담 결과</Text>
              </View>
              <View style={styles.consultCard}>
                <Text style={styles.consultText}>{record.consult_result}</Text>
              </View>
            </View>
          ) : null}

          {/* 처방약 변화 */}
          {meds.length > 0 ? (
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="medical-outline" size={22} color={Colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>처방약 변화</Text>
              </View>
              {changeOrder.map(ct => {
                const group = meds.filter(m => m.change_type === ct);
                if (group.length === 0) return null;
                const cfg = CHANGE_TYPE_CONFIG[ct];
                return (
                  <View key={ct} style={styles.medGroup}>
                    <Text style={styles.medGroupTitle}>
                      {cfg.icon} {cfg.label}
                    </Text>
                    {group.map(m => (
                      <View key={m.id} style={[styles.medRow, { backgroundColor: cfg.bgColor }]}>
                        <Text style={[styles.medName, { color: cfg.color }]}>{m.medication_name}</Text>
                        {m.dosage ? (
                          <Text style={[styles.medDosage, { color: cfg.color }]}>{m.dosage}</Text>
                        ) : null}
                      </View>
                    ))}
                  </View>
                );
              })}
            </View>
          ) : null}

          {/* 처방전 사진 */}
          {record.prescription_image_url ? (
            <View style={styles.section}>
              <View style={styles.sectionTitleRow}>
                <Ionicons name="document-text-outline" size={22} color={Colors.primary} style={{ marginRight: 6 }} />
                <Text style={styles.sectionTitle}>처방전 사진</Text>
              </View>
              <TouchableOpacity
                onPress={() => setImageModalVisible(true)}
                activeOpacity={0.9}
              >
                <Image
                  source={{ uri: record.prescription_image_url }}
                  style={styles.prescriptionThumb}
                  resizeMode="cover"
                />
                <Text style={styles.imageHint}>탭하면 크게 볼 수 있어요</Text>
              </TouchableOpacity>
            </View>
          ) : null}

          {/* 수정 / 삭제 버튼 */}
          <View style={styles.actionRow}>
            <TouchableOpacity
              style={styles.editBtn}
              onPress={() => navigation.navigate('MedicalRecordWrite', { recordId: record.id } as any)}
              activeOpacity={0.8}
            >
              <Text style={styles.editBtnText}>수정</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.deleteBtn}
              onPress={handleDelete}
              activeOpacity={0.8}
            >
              <Text style={styles.deleteBtnText}>삭제</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : null}

      {/* 처방전 전체화면 모달 */}
      <Modal
        visible={imageModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setImageModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.imageModalOverlay}
          activeOpacity={1}
          onPress={() => setImageModalVisible(false)}
        >
          <Image
            source={{ uri: record?.prescription_image_url }}
            style={styles.imageModalFull}
            resizeMode="contain"
          />
          <Text style={styles.imageModalHint}>탭하면 닫혀요</Text>
        </TouchableOpacity>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: Colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  errorText: { fontSize: 18, color: Colors.danger, textAlign: 'center', marginBottom: 16 },
  retryBtn: {
    backgroundColor: Colors.primary,
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 14,
  },
  retryBtnText: { fontSize: 18, fontWeight: '700', color: Colors.white },
  scroll: { padding: 20, paddingBottom: 40 },

  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 6,
  },
  infoCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  infoCardIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: Colors.light,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 16,
    flexShrink: 0,
  },
  dateText: { fontSize: 22, fontWeight: '800', color: Colors.text, marginBottom: 8 },
  hospitalText: { fontSize: 20, color: Colors.text, marginBottom: 4 },
  doctorText: { fontSize: 18, color: Colors.textSub },

  section: { marginBottom: 24 },
  sectionTitleRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 18, fontWeight: '700', color: Colors.text, marginBottom: 0 },

  consultCard: {
    backgroundColor: Colors.white,
    borderRadius: 14,
    padding: 18,
    elevation: 1,
  },
  consultText: { fontSize: 18, color: Colors.text, lineHeight: 28 },

  medGroup: { marginBottom: 14 },
  medGroupTitle: { fontSize: 17, fontWeight: '700', color: Colors.text, marginBottom: 8 },
  medRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    marginBottom: 6,
  },
  medName: { fontSize: 17, fontWeight: '600', flex: 1 },
  medDosage: { fontSize: 16, marginLeft: 8 },

  prescriptionThumb: {
    width: '100%',
    height: 200,
    borderRadius: 12,
    backgroundColor: Colors.border,
  },
  imageHint: { fontSize: 14, color: Colors.textHint, textAlign: 'center', marginTop: 6 },

  actionRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 12,
  },
  editBtn: {
    flex: 1,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.primary,
    borderRadius: 14,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  deleteBtn: {
    flex: 1,
    backgroundColor: Colors.white,
    borderWidth: 1.5,
    borderColor: Colors.danger,
    borderRadius: 14,
    minHeight: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  deleteBtnText: { fontSize: 18, fontWeight: '700', color: Colors.danger },

  imageModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  imageModalFull: {
    width: '95%',
    height: '80%',
  },
  imageModalHint: { fontSize: 15, color: 'rgba(255,255,255,0.5)', marginTop: 16 },
});
