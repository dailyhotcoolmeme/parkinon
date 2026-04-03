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
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { StackNavigationProp } from '@react-navigation/stack';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { useExercise } from '../../hooks/useExercise';
import { DatePickerModal } from '../../components/common/DatePickerModal';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseMain'>;

const WINDOW_HEIGHT = Dimensions.get('window').height;
const TOP_BAR_H = 56;
const DATE_HEADER_H = 56;
const TAB_BAR_H = 68;


type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];

const MCI_ICONS: Record<string, MCIName> = {
  '걷기': 'walk',
  '스트레칭': 'yoga',
  '근력': 'dumbbell',       // ExerciseRecordScreen label과 일치
  '자전거': 'bike',
  '수영': 'swim',
  '댄스': 'music-note',
  '복싱': 'boxing-glove',
  '요가': 'meditation',
  '조깅': 'run',
};

const IONICONS_ICONS: Record<string, React.ComponentProps<typeof Ionicons>['name']> = {
  '균형': 'body-outline', // ExerciseRecordScreen label과 일치
};

function ExerciseTypeIcon({ type, size = 30, color = Colors.text }: { type: string; size?: number; color?: string }) {
  const mciName = MCI_ICONS[type];
  if (mciName) return <MaterialCommunityIcons name={mciName} size={size} color={color} />;
  const ionName = IONICONS_ICONS[type];
  if (ionName) return <Ionicons name={ionName} size={size} color={color} />;
  return <Ionicons name="fitness-outline" size={size} color={color} />;
}

function getDateLabel(date: Date): string {
  const month = date.getMonth() + 1;
  const day = date.getDate();
  const dayNames = ['일요일', '월요일', '화요일', '수요일', '목요일', '금요일', '토요일'];
  return `${month}월 ${day}일 ${dayNames[date.getDay()]}`;
}

export function ExerciseScreen() {
  const navigation = useNavigation<Nav>();
  const rootNavigation = useNavigation<StackNavigationProp<RootStackParamList>>();
  const { todayLogs, getTodayTotalMinutes } = useExercise();
  const insets = useSafeAreaInsets();
  const [selectedDate, setSelectedDate] = useState(new Date());
  const [showDatePicker, setShowDatePicker] = useState(false);

  const displayLogs = todayLogs;
  const totalMinutes = getTodayTotalMinutes();

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title="파킨온"
        showMenu
        onMenuPress={() => rootNavigation.navigate('Menu')}
      />

      {/* 날짜 헤더 */}
      <View style={styles.dateHeader}>
        <Text style={styles.dateText}>{getDateLabel(selectedDate)}</Text>
        <TouchableOpacity style={styles.calBtn} onPress={() => setShowDatePicker(true)}>
          <Ionicons name="calendar-outline" size={24} color={Colors.text} />
        </TouchableOpacity>
      </View>

      <ScrollView style={styles.scroll} showsVerticalScrollIndicator={false} contentContainerStyle={styles.scrollContent}>
        {/* 버튼 영역 */}
        <View style={styles.centerBlock}>
          <TouchableOpacity
            style={styles.primaryBtn}
            onPress={() => navigation.navigate('ExerciseRecord')}
            activeOpacity={0.85}
          >
            <View style={styles.primaryBtnInner}>
              <Ionicons name="fitness" size={40} color={Colors.white} />
              <Text style={styles.primaryBtnText}>운동 기록하기</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity
            style={styles.outlineBtn}
            onPress={() => navigation.navigate('ExerciseVideo')}
            activeOpacity={0.85}
          >
            <View style={styles.outlineBtnInner}>
              <Ionicons name="videocam-outline" size={24} color={Colors.primary} />
              <Text style={styles.outlineBtnText}>운동 영상 보기</Text>
            </View>
          </TouchableOpacity>
        </View>

        {/* 오늘 운동 기록 */}
        <View style={styles.records}>
          <View style={styles.sectionHeader}>
            <View style={styles.dividerLine} />
            <Text style={styles.sectionTitle}>오늘 운동 기록 · 총 {totalMinutes}분</Text>
            <View style={styles.dividerLine} />
          </View>

          {displayLogs.map((record) => (
            <View key={record.id} style={styles.recordCard}>
              <View style={styles.recordIconWrap}>
                <ExerciseTypeIcon type={record.exercise_type} size={30} color={Colors.primary} />
              </View>
              <View style={styles.recordInfo}>
                <Text style={styles.recordLabel}>
                  {record.exercise_type}  {record.duration_minutes}분
                </Text>
                <Text style={styles.recordTime}>
                  {new Date(record.logged_at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}
                </Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
      <DatePickerModal
        visible={showDatePicker}
        selectedDate={selectedDate}
        onSelect={setSelectedDate}
        onClose={() => setShowDatePicker(false)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },

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
    paddingTop: 20,
    paddingBottom: 32,
    gap: 14,
  },

  primaryBtn: {
    backgroundColor: Colors.primary,
    width: '100%',
    height: 220,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 6,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  primaryBtnInner: { alignItems: 'center', gap: 12 },
  primaryBtnText: { fontSize: 26, fontWeight: '800', color: Colors.white },

  outlineBtn: {
    backgroundColor: Colors.white,
    width: '100%',
    height: 70,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: Colors.primary,
  },
  outlineBtnInner: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  outlineBtnText: { fontSize: 18, fontWeight: '700', color: Colors.primary },

  records: { paddingHorizontal: 24, paddingBottom: 32 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  dividerLine: { flex: 1, height: 1, backgroundColor: Colors.border },
  sectionTitle: { fontSize: 17, fontWeight: '600', color: Colors.textSub, marginHorizontal: 12 },

  recordCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
  },
  recordIconWrap: { marginRight: 16, width: 46, alignItems: 'center' },
  recordInfo: { flex: 1 },
  recordLabel: { fontSize: 20, fontWeight: '600', color: Colors.text },
  recordTime: { fontSize: 17, color: Colors.textSub, marginTop: 4 },
});
