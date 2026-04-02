import React, { useState } from 'react';
import {
  View,
  Text,
  Switch,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

interface NotificationItem {
  id: string;
  label: string;
  enabled: boolean;
  time?: string;
}

export function SettingsScreen() {
  const [medicationNotifs, setMedicationNotifs] = useState<NotificationItem[]>([
    { id: 'immediate', label: '복용 직후', enabled: true },
    { id: 'after30', label: '30분 후', enabled: true },
    { id: 'after2h', label: '2시간 후', enabled: true },
  ]);

  const [exerciseNotif, setExerciseNotif] = useState({ enabled: true, time: '오후 2:00' });

  // 보호자 역할인 경우 true (더미)
  const isCaregiver = false;
  const [caregiverNotifs, setCaregiverNotifs] = useState([
    { id: 'taken', label: '약 복용 시', enabled: true },
    { id: 'missed', label: '약 미복용 시', enabled: true },
    { id: 'exercise', label: '운동 완료 시', enabled: true },
  ]);

  const toggleMedNotif = (id: string) => {
    setMedicationNotifs(prev =>
      prev.map(n => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    );
  };

  const removeMedNotif = (id: string) => {
    Alert.alert('알림 삭제', '이 알림을 삭제할까요?', [
      { text: '취소', style: 'cancel' },
      {
        text: '삭제',
        style: 'destructive',
        onPress: () => setMedicationNotifs(prev => prev.filter(n => n.id !== id)),
      },
    ]);
  };

  const addMedNotif = () => {
    Alert.alert('알림 추가', '새 알림 시간 추가 기능은 준비 중이에요.');
  };

  const changeExerciseTime = () => {
    Alert.alert('운동 알림 시간', '시간 변경 기능은 준비 중이에요.');
  };

  const toggleCaregiverNotif = (id: string) => {
    setCaregiverNotifs(prev =>
      prev.map(n => (n.id === id ? { ...n, enabled: !n.enabled } : n)),
    );
  };

  return (
    <SafeAreaView style={styles.safeArea}>
      <TopBar title="설정" showBack />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* 약효 추적 알림 */}
        <Text style={styles.sectionTitle}>약효 추적 알림</Text>
        <View style={styles.card}>
          {medicationNotifs.map((notif, i) => (
            <View
              key={notif.id}
              style={[styles.row, i < medicationNotifs.length - 1 && styles.rowBorder]}
            >
              <Text style={styles.rowLabel}>{notif.label}</Text>
              <Switch
                value={notif.enabled}
                onValueChange={() => toggleMedNotif(notif.id)}
                trackColor={{ false: '#CCCCCC', true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>
          ))}
          <TouchableOpacity style={styles.addBtn} onPress={addMedNotif} activeOpacity={0.7}>
            <Text style={styles.addBtnText}>+ 추가하기</Text>
          </TouchableOpacity>
        </View>

        {/* 운동 알림 */}
        <Text style={styles.sectionTitle}>운동 알림</Text>
        <View style={styles.card}>
          <View style={[styles.row, styles.rowBorder]}>
            <Text style={styles.rowLabel}>운동 알림</Text>
            <Switch
              value={exerciseNotif.enabled}
              onValueChange={v => setExerciseNotif(prev => ({ ...prev, enabled: v }))}
              trackColor={{ false: '#CCCCCC', true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>
          <TouchableOpacity
            style={styles.row}
            onPress={changeExerciseTime}
            activeOpacity={0.7}
          >
            <Text style={styles.rowLabel}>시간</Text>
            <View style={styles.timeRow}>
              <Text style={styles.timeText}>{exerciseNotif.time}</Text>
              <Text style={styles.chevron}>›</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 보호자 알림 (보호자에게만 표시) */}
        {isCaregiver && (
          <>
            <Text style={styles.sectionTitle}>보호자 알림</Text>
            <View style={styles.card}>
              {caregiverNotifs.map((notif, i) => (
                <View
                  key={notif.id}
                  style={[
                    styles.row,
                    i < caregiverNotifs.length - 1 && styles.rowBorder,
                  ]}
                >
                  <Text style={styles.rowLabel}>{notif.label}</Text>
                  <Switch
                    value={notif.enabled}
                    onValueChange={() => toggleCaregiverNotif(notif.id)}
                    trackColor={{ false: '#CCCCCC', true: Colors.primary }}
                    thumbColor={Colors.white}
                  />
                </View>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: { padding: 16, paddingBottom: 40 },

  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.textSub,
    marginBottom: 10,
    marginTop: 16,
  },

  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 20,
    minHeight: 64,
  },
  rowBorder: { borderBottomWidth: 1, borderBottomColor: Colors.border },
  rowLabel: { flex: 1, fontSize: 20, color: Colors.text, fontWeight: '500' },

  timeRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  timeText: { fontSize: 18, color: Colors.primary, fontWeight: '600' },
  chevron: { fontSize: 20, color: Colors.textHint },

  addBtn: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addBtnText: { fontSize: 18, color: Colors.primary, fontWeight: '600' },
});
