import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation, useRoute } from '@react-navigation/native';
import type { NativeStackNavigationProp, NativeStackScreenProps } from '@react-navigation/native-stack';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useExercise } from '../../hooks/useExercise';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseDuration'>;
type RouteProps = NativeStackScreenProps<ExerciseStackParamList, 'ExerciseDuration'>['route'];

const DURATION_GROUPS = [
  { label: '짧게', items: [10, 20, 30] },
  { label: '보통', items: [40, 50, 60] },
  { label: '길게', items: [90, 120, 150, 180] },
];

function formatDuration(min: number): string {
  if (min < 60) return `${min}분`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}시간 ${m}분` : `${h}시간`;
}

export function ExerciseDurationScreen() {
  const navigation = useNavigation<Nav>();
  const route = useRoute<RouteProps>();
  const { exerciseName } = route.params;
  const [selected, setSelected] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const { saveExercise } = useExercise();
  const { unreadCount } = useNotificationBadge();

  const handleSave = async () => {
    if (!selected) {
      Alert.alert('시간 선택', '운동 시간을 선택해주세요.');
      return;
    }
    setSaving(true);
    const success = await saveExercise(exerciseName, selected);
    setSaving(false);
    if (success) {
      Alert.alert(
        '저장 완료',
        `${exerciseName} ${formatDuration(selected)}을 기록했어요! 👏`,
        [{ text: '확인', onPress: () => navigation.popToTop() }],
      );
    } else {
      Alert.alert('오류', '기록 저장에 실패했어요. 다시 시도해주세요.');
    }
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        title="운동 시간"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.question}>얼마나 하셨나요?</Text>
        <Text style={styles.exerciseName}>{exerciseName}</Text>

        {DURATION_GROUPS.map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.row}>
              {group.items.map((dur) => (
                <TouchableOpacity
                  key={dur}
                  style={[styles.durBtn, selected === dur && styles.durBtnSelected]}
                  onPress={() => setSelected(dur)}
                  activeOpacity={0.7}
                >
                  <Text style={[styles.durText, selected === dur && styles.durTextSelected]}>
                    {formatDuration(dur)}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ))}
      </ScrollView>

      <View style={styles.bottom}>
        <PrimaryButton title={saving ? '저장 중...' : '저장하기'} onPress={handleSave} disabled={!selected || saving} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 16, paddingBottom: 24 },
  question: { fontSize: 26, fontWeight: '800', color: Colors.text, marginBottom: 6, marginTop: 4 },
  exerciseName: { fontSize: 18, color: Colors.primary, fontWeight: '700', marginBottom: 28 },

  group: { marginBottom: 20 },
  groupLabel: { fontSize: 15, fontWeight: '700', color: Colors.textSub, marginBottom: 10, letterSpacing: 0.3 },
  row: { flexDirection: 'row', gap: 12, flexWrap: 'wrap' },

  durBtn: {
    flex: 1, minWidth: '28%', minHeight: 72,
    backgroundColor: Colors.white, borderRadius: 14,
    borderWidth: 2, borderColor: Colors.border,
    alignItems: 'center', justifyContent: 'center',
    paddingVertical: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05, shadowRadius: 2, elevation: 1,
  },
  durBtnSelected: { borderColor: Colors.primary, backgroundColor: Colors.light },
  durText: { fontSize: 20, fontWeight: '700', color: Colors.textSub },
  durTextSelected: { color: Colors.dark, fontWeight: '800' },

  bottom: { paddingHorizontal: 16, paddingBottom: 32, paddingTop: 12, backgroundColor: Colors.background },
});
