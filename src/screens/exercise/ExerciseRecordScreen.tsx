import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
  Alert,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';

type Nav = NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseRecord'>;
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Exercise {
  id: string;
  iconLib: 'MCI' | 'Ionicons';
  iconName: MCIName | IoniconName;
  label: string;
  desc: string;
}

const BASIC_EXERCISES: Exercise[] = [
  { id: 'walk',     iconLib: 'MCI',      iconName: 'walk',          label: '걷기',     desc: '산책, 실내외 걷기' },
  { id: 'strength', iconLib: 'MCI',      iconName: 'dumbbell',      label: '근력',     desc: '스쿼트, 팔굽혀펴기' },
  { id: 'balance',  iconLib: 'Ionicons', iconName: 'body-outline',  label: '균형',     desc: '한발 서기, 균형 훈련' },
  { id: 'stretch',  iconLib: 'MCI',      iconName: 'yoga',          label: '스트레칭', desc: '전신 스트레칭' },
];

const OTHER_EXERCISES: Exercise[] = [
  { id: 'bike',   iconLib: 'MCI',      iconName: 'bike',           label: '자전거',  desc: '실내·외 자전거' },
  { id: 'swim',   iconLib: 'MCI',      iconName: 'swim',           label: '수영',    desc: '수영, 아쿠아로빅' },
  { id: 'dance',  iconLib: 'MCI',      iconName: 'music-note',     label: '댄스',    desc: '댄스, 에어로빅' },
  { id: 'boxing', iconLib: 'MCI',      iconName: 'boxing-glove',   label: '복싱',    desc: '복싱, 권투 훈련' },
  { id: 'yoga',   iconLib: 'MCI',      iconName: 'meditation',     label: '요가',    desc: '요가, 필라테스' },
  { id: 'jog',    iconLib: 'MCI',      iconName: 'run',            label: '조깅',    desc: '가벼운 달리기' },
  { id: 'custom', iconLib: 'Ionicons', iconName: 'create-outline', label: '직접입력', desc: '다른 운동 입력하기' },
];

function ExerciseRow({ ex, selected, onPress }: { ex: Exercise; selected: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity
      style={[styles.row, selected && styles.rowSelected]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={[styles.iconCircle, selected && styles.iconCircleSelected]}>
        {ex.iconLib === 'MCI' ? (
          <MaterialCommunityIcons name={ex.iconName as MCIName} size={30} color={selected ? Colors.primary : Colors.textSub} />
        ) : (
          <Ionicons name={ex.iconName as IoniconName} size={30} color={selected ? Colors.primary : Colors.textSub} />
        )}
      </View>
      <View style={styles.rowText}>
        <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{ex.label}</Text>
        <Text style={styles.rowDesc}>{ex.desc}</Text>
      </View>
      <View style={[styles.radio, selected && styles.radioSelected]}>
        {selected && <View style={styles.radioDot} />}
      </View>
    </TouchableOpacity>
  );
}

export function ExerciseRecordScreen() {
  const navigation = useNavigation<Nav>();
  const { unreadCount } = useNotificationBadge();
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [showOther, setShowOther] = useState(false);

  const handleSelect = (id: string) => {
    setSelected(id);
    if (id === 'custom') return;
    setCustomText('');
    const found = [...BASIC_EXERCISES, ...OTHER_EXERCISES].find(e => e.id === id);
    setTimeout(() => {
      navigation.navigate('ExerciseDuration', { exerciseName: found?.label ?? '' });
    }, 300);
  };

  const handleCustomNext = () => {
    if (!customText.trim()) {
      Alert.alert('운동 입력', '운동 이름을 입력해주세요.');
      return;
    }
    navigation.navigate('ExerciseDuration', { exerciseName: customText.trim() });
  };

  return (
    <SafeAreaView style={styles.safe}>
      <TopBar
        title="운동 기록하기"
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.question}>어떤 운동을 하셨나요?</Text>

        <Text style={styles.groupLabel}>기본 운동</Text>
        <View style={styles.listCard}>
          {BASIC_EXERCISES.map((ex, i) => (
            <View key={ex.id}>
              <ExerciseRow ex={ex} selected={selected === ex.id} onPress={() => handleSelect(ex.id)} />
              {i < BASIC_EXERCISES.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.otherToggle} onPress={() => setShowOther(v => !v)} activeOpacity={0.7}>
          <Text style={styles.otherToggleText}>다른 운동 보기</Text>
          <Ionicons name={showOther ? 'chevron-up' : 'chevron-down'} size={22} color={Colors.primary} />
        </TouchableOpacity>

        {showOther && (
          <View style={styles.listCard}>
            {OTHER_EXERCISES.map((ex, i) => (
              <View key={ex.id}>
                <ExerciseRow ex={ex} selected={selected === ex.id} onPress={() => handleSelect(ex.id)} />
                {i < OTHER_EXERCISES.length - 1 && <View style={styles.divider} />}
              </View>
            ))}
          </View>
        )}

        {selected === 'custom' && (
          <View style={styles.customWrap}>
            <TextInput
              style={styles.customInput}
              placeholder="운동 이름을 입력해주세요"
              placeholderTextColor={Colors.textHint}
              value={customText}
              onChangeText={setCustomText}
              maxLength={20}
              autoFocus
            />
            <PrimaryButton title="다음으로" onPress={handleCustomNext} disabled={!customText.trim()} />
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: Colors.background },
  content: { padding: 20, paddingBottom: 48 },
  question: { fontSize: 26, fontWeight: '800', color: Colors.text, marginBottom: 24, marginTop: 4, lineHeight: 36 },
  groupLabel: { fontSize: 16, fontWeight: '700', color: Colors.textSub, marginBottom: 10, letterSpacing: 0.3 },
  listCard: {
    backgroundColor: Colors.white, borderRadius: 18, overflow: 'hidden', marginBottom: 16,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.07, shadowRadius: 4, elevation: 2,
  },
  row: {
    flexDirection: 'row', alignItems: 'center',
    paddingHorizontal: 16, paddingVertical: 16, minHeight: 76, gap: 16,
  },
  rowSelected: { backgroundColor: Colors.light },
  iconCircle: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: Colors.background,
    alignItems: 'center', justifyContent: 'center',
  },
  iconCircleSelected: { backgroundColor: '#E8F5E9' },
  rowText: { flex: 1 },
  rowLabel: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  rowLabelSelected: { color: Colors.dark },
  rowDesc: { fontSize: 15, color: Colors.textSub, lineHeight: 20 },
  radio: {
    width: 26, height: 26, borderRadius: 13,
    borderWidth: 2, borderColor: Colors.border, alignItems: 'center', justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: { width: 14, height: 14, borderRadius: 7, backgroundColor: Colors.primary },
  divider: { height: 1, backgroundColor: Colors.border, marginLeft: 88 },
  otherToggle: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    backgroundColor: Colors.white, borderRadius: 14,
    paddingHorizontal: 16, paddingVertical: 18, marginBottom: 12,
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.05, shadowRadius: 3, elevation: 1,
  },
  otherToggleText: { fontSize: 18, fontWeight: '700', color: Colors.primary },
  customWrap: { marginTop: 4, gap: 12 },
  customInput: {
    backgroundColor: Colors.white, borderRadius: 12, borderWidth: 2, borderColor: Colors.primary,
    padding: 16, fontSize: 20, color: Colors.text, minHeight: 60,
  },
});
