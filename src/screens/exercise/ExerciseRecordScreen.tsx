import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
  TextInput,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useNavigation } from '@react-navigation/native';
import type { CompositeNavigationProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { RootStackParamList } from '../../navigation/RootNavigator';
import { Ionicons } from '@expo/vector-icons';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { TopBar } from '../../components/common/TopBar';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import type { ExerciseStackParamList } from '../../navigation/ExerciseNavigator';
import { useNotificationBadge } from '../../context/NotificationBadgeContext';
import { useDialog } from '../../context/DialogContext';

// NotificationHistory 등 루트 스택 라우트로도 이동하므로 부모(Root) 네비게이션 타입과 합성한다.
type Nav = CompositeNavigationProp<
  NativeStackNavigationProp<ExerciseStackParamList, 'ExerciseRecord'>,
  StackNavigationProp<RootStackParamList>
>;
type MCIName = React.ComponentProps<typeof MaterialCommunityIcons>['name'];
type IoniconName = React.ComponentProps<typeof Ionicons>['name'];

interface Exercise {
  id: string;
  iconLib: 'MCI' | 'Ionicons';
  iconName: MCIName | IoniconName;
  labelKey: string;
  descKey: string;
}

const BASIC_EXERCISES: Exercise[] = [
  { id: 'walk',     iconLib: 'MCI',      iconName: 'walk',          labelKey: 'exercise.types.walkLabel',     descKey: 'exercise.types.walkDesc' },
  { id: 'strength', iconLib: 'MCI',      iconName: 'dumbbell',      labelKey: 'exercise.types.strengthLabel', descKey: 'exercise.types.strengthDesc' },
  { id: 'balance',  iconLib: 'Ionicons', iconName: 'body-outline',  labelKey: 'exercise.types.balanceLabel',  descKey: 'exercise.types.balanceDesc' },
  { id: 'stretch',  iconLib: 'MCI',      iconName: 'yoga',          labelKey: 'exercise.types.stretchLabel',  descKey: 'exercise.types.stretchDesc' },
];

const OTHER_EXERCISES: Exercise[] = [
  { id: 'bike',   iconLib: 'MCI',      iconName: 'bike',           labelKey: 'exercise.types.bikeLabel',   descKey: 'exercise.types.bikeDesc' },
  { id: 'swim',   iconLib: 'MCI',      iconName: 'swim',           labelKey: 'exercise.types.swimLabel',   descKey: 'exercise.types.swimDesc' },
  { id: 'dance',  iconLib: 'MCI',      iconName: 'music-note',     labelKey: 'exercise.types.danceLabel',  descKey: 'exercise.types.danceDesc' },
  { id: 'boxing', iconLib: 'MCI',      iconName: 'boxing-glove',   labelKey: 'exercise.types.boxingLabel', descKey: 'exercise.types.boxingDesc' },
  { id: 'yoga',   iconLib: 'MCI',      iconName: 'meditation',     labelKey: 'exercise.types.yogaLabel',   descKey: 'exercise.types.yogaDesc' },
  { id: 'jog',    iconLib: 'MCI',      iconName: 'run',            labelKey: 'exercise.types.jogLabel',    descKey: 'exercise.types.jogDesc' },
  { id: 'custom', iconLib: 'Ionicons', iconName: 'create-outline', labelKey: 'exercise.types.customLabel', descKey: 'exercise.types.customDesc' },
];

function ExerciseRow({ ex, selected, onPress }: { ex: Exercise; selected: boolean; onPress: () => void }) {
  const { t } = useTranslation();
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
        <Text style={[styles.rowLabel, selected && styles.rowLabelSelected]}>{t(ex.labelKey)}</Text>
        <Text style={styles.rowDesc}>{t(ex.descKey)}</Text>
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
  const dialog = useDialog();
  const { t } = useTranslation();
  const [selected, setSelected] = useState<string | null>(null);
  const [customText, setCustomText] = useState('');
  const [showOther, setShowOther] = useState(false);

  const handleSelect = (id: string) => {
    setSelected(id);
    if (id === 'custom') return;
    setCustomText('');
    const found = [...BASIC_EXERCISES, ...OTHER_EXERCISES].find(e => e.id === id);
    setTimeout(() => {
      navigation.navigate('ExerciseDuration', { exerciseName: found ? t(found.labelKey) : '', exerciseId: id });
    }, 300);
  };

  const handleCustomNext = () => {
    if (!customText.trim()) {
      dialog.alert({ title: t('exercise.customAlertTitle'), message: t('exercise.customAlertMsg') });
      return;
    }
    navigation.navigate('ExerciseDuration', { exerciseName: customText.trim(), exerciseId: null });
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <TopBar
        title={t('exercise.recordTitle')}
        showBack
        showBell
        bellBadge={unreadCount}
        onBellPress={() => navigation.navigate('NotificationHistory', { mode: 'all' })}
      />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <Text style={styles.question}>{t('exercise.question')}</Text>

        <Text style={styles.groupLabel}>{t('exercise.groupBasic')}</Text>
        <View style={styles.listCard}>
          {BASIC_EXERCISES.map((ex, i) => (
            <View key={ex.id}>
              <ExerciseRow ex={ex} selected={selected === ex.id} onPress={() => handleSelect(ex.id)} />
              {i < BASIC_EXERCISES.length - 1 && <View style={styles.divider} />}
            </View>
          ))}
        </View>

        <TouchableOpacity style={styles.otherToggle} onPress={() => setShowOther(v => !v)} activeOpacity={0.7}>
          <Text style={styles.otherToggleText}>{t('exercise.otherToggle')}</Text>
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
              placeholder={t('exercise.customPlaceholder')}
              placeholderTextColor={Colors.textHint}
              value={customText}
              onChangeText={setCustomText}
              maxLength={20}
              autoFocus
            />
            <PrimaryButton title={t('exercise.customNext')} onPress={handleCustomNext} disabled={!customText.trim()} />
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
