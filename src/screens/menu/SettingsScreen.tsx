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
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';

interface NotificationItem {
  id: string;
  label: string;
  sub: string;
  enabled: boolean;
  time?: string;
}

export function SettingsScreen() {
  const [medicationNotifs, setMedicationNotifs] = useState<NotificationItem[]>([
    { id: 'immediate', label: '복용 직후', sub: '약을 드신 직후 알림', enabled: true },
    { id: 'after30', label: '30분 후', sub: '복용 30분 뒤 알림', enabled: true },
    { id: 'after2h', label: '2시간 후', sub: '복용 2시간 뒤 알림', enabled: true },
  ]);

  const [exerciseNotif, setExerciseNotif] = useState({
    enabled: true,
    time: '오후 2:00',
  });

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
    <SafeAreaView style={styles.safeArea} edges={['top']}>
      <TopBar title="알림 설정" showBack />

      <ScrollView style={styles.scroll} contentContainerStyle={styles.scrollContent}>
        {/* Section 1: 약효 추적 알림 */}
        <View style={styles.card}>
          {/* Card header */}
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons name="notifications-outline" size={24} color={Colors.primary} />
              <View style={styles.cardHeaderTexts}>
                <Text style={styles.cardHeaderTitle}>약효 추적 알림</Text>
                <Text style={styles.cardHeaderDesc}>약 복용 후 컨디션을 기록해요</Text>
              </View>
            </View>
          </View>

          {/* Notification items */}
          {medicationNotifs.map(notif => (
            <View key={notif.id} style={styles.notifRow}>
              <View style={styles.notifTexts}>
                <Text style={styles.notifLabel}>{notif.label}</Text>
                <Text style={styles.notifSub}>{notif.sub}</Text>
              </View>
              <Switch
                value={notif.enabled}
                onValueChange={() => toggleMedNotif(notif.id)}
                trackColor={{ false: '#D0D0D0', true: Colors.primary }}
                thumbColor={Colors.white}
              />
            </View>
          ))}

          {/* Add button */}
          <TouchableOpacity style={styles.addRow} onPress={addMedNotif} activeOpacity={0.7}>
            <Ionicons name="add-circle-outline" size={22} color={Colors.accent} />
            <Text style={styles.addRowText}>알림 시간 추가하기</Text>
          </TouchableOpacity>
        </View>

        {/* Section 2: 운동 알림 */}
        <View style={styles.card}>
          {/* Card header */}
          <View style={styles.cardHeader}>
            <View style={styles.cardHeaderLeft}>
              <Ionicons name="fitness-outline" size={24} color={Colors.primary} />
              <View style={styles.cardHeaderTexts}>
                <Text style={styles.cardHeaderTitle}>운동 알림</Text>
                <Text style={styles.cardHeaderDesc}>매일 운동을 권장해드려요</Text>
              </View>
            </View>
          </View>

          {/* 운동 알림 토글 */}
          <View style={styles.notifRow}>
            <View style={styles.notifTexts}>
              <Text style={styles.notifLabel}>운동 알림</Text>
              <Text style={styles.notifSub}>설정한 시간에 알림을 보내드려요</Text>
            </View>
            <Switch
              value={exerciseNotif.enabled}
              onValueChange={v => setExerciseNotif(prev => ({ ...prev, enabled: v }))}
              trackColor={{ false: '#D0D0D0', true: Colors.primary }}
              thumbColor={Colors.white}
            />
          </View>

          {/* 알림 시간 */}
          <TouchableOpacity style={styles.notifRow} onPress={changeExerciseTime} activeOpacity={0.7}>
            <Text style={[styles.notifLabel, { flex: 1 }]}>알림 시간</Text>
            <View style={styles.timeChevronRow}>
              <Text style={styles.timeText}>{exerciseNotif.time}</Text>
              <Ionicons name="chevron-forward" size={22} color={Colors.textHint} />
            </View>
          </TouchableOpacity>
        </View>

        {/* Section 3: 보호자 알림 (보호자에게만 표시) */}
        {isCaregiver && (
          <View style={styles.card}>
            <View style={styles.cardHeader}>
              <View style={styles.cardHeaderLeft}>
                <Ionicons name="people-outline" size={24} color={Colors.primary} />
                <View style={styles.cardHeaderTexts}>
                  <Text style={styles.cardHeaderTitle}>보호자 알림</Text>
                  <Text style={styles.cardHeaderDesc}>환자 활동을 알려드려요</Text>
                </View>
              </View>
            </View>

            {caregiverNotifs.map(notif => (
              <View key={notif.id} style={styles.notifRow}>
                <Text style={[styles.notifLabel, { flex: 1 }]}>{notif.label}</Text>
                <Switch
                  value={notif.enabled}
                  onValueChange={() => toggleCaregiverNotif(notif.id)}
                  trackColor={{ false: '#D0D0D0', true: Colors.primary }}
                  thumbColor={Colors.white}
                />
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: Colors.background },
  scroll: { flex: 1 },
  scrollContent: {
    padding: 20,
    paddingBottom: 60,
  },

  // Card container
  card: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },

  // Card header (light background strip)
  cardHeader: {
    paddingHorizontal: 20,
    paddingVertical: 16,
    backgroundColor: Colors.light,
  },
  cardHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  cardHeaderTexts: {
    flex: 1,
  },
  cardHeaderTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 2,
  },
  cardHeaderDesc: {
    fontSize: 15,
    color: Colors.textSub,
  },

  // Notification row
  notifRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 20,
    minHeight: 72,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  notifTexts: {
    flex: 1,
    paddingVertical: 14,
  },
  notifLabel: {
    fontSize: 20,
    color: Colors.text,
    fontWeight: '500',
    marginBottom: 3,
  },
  notifSub: {
    fontSize: 15,
    color: Colors.textSub,
  },

  // Add button row at bottom of card
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  addRowText: {
    fontSize: 18,
    color: Colors.accent,
    fontWeight: '600',
  },

  // Exercise time row
  timeChevronRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeText: {
    fontSize: 20,
    color: Colors.primary,
    fontWeight: '600',
  },
});
