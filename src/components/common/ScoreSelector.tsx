// 1~5점 선택 컴포넌트 (몸상태/기분/수면) - 고령자 최적화
// 세로 배치 큰 카드 형태 → 60대 이상 손가락으로 쉽게 탭 가능
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';
import { useTranslation } from 'react-i18next';

interface Props {
  value: number | null;
  onChange: (v: number) => void;
  type?: 'body' | 'mood' | 'sleep';
}

function getScoreData(t: (key: string) => string) {
  return {
    body: [
      { score: 5, emoji: '😄', label: t('scoreSelector.bodyLabel5'), sub: t('scoreSelector.bodySub5') },
      { score: 4, emoji: '🙂', label: t('scoreSelector.bodyLabel4'), sub: t('scoreSelector.bodySub4') },
      { score: 3, emoji: '😐', label: t('scoreSelector.bodyLabel3'), sub: t('scoreSelector.bodySub3') },
      { score: 2, emoji: '😟', label: t('scoreSelector.bodyLabel2'), sub: t('scoreSelector.bodySub2') },
      { score: 1, emoji: '😢', label: t('scoreSelector.bodyLabel1'), sub: t('scoreSelector.bodySub1') },
    ],
    mood: [
      { score: 5, emoji: '😄', label: t('scoreSelector.bodyLabel5'), sub: t('scoreSelector.moodSub5') },
      { score: 4, emoji: '🙂', label: t('scoreSelector.bodyLabel4'), sub: t('scoreSelector.moodSub4') },
      { score: 3, emoji: '😐', label: t('scoreSelector.bodyLabel3'), sub: t('scoreSelector.moodSub3') },
      { score: 2, emoji: '😟', label: t('scoreSelector.bodyLabel2'), sub: t('scoreSelector.moodSub2') },
      { score: 1, emoji: '😢', label: t('scoreSelector.bodyLabel1'), sub: t('scoreSelector.moodSub1') },
    ],
    sleep: [
      { score: 5, emoji: '😄', label: t('scoreSelector.sleepLabel5'), sub: t('scoreSelector.sleepSub5') },
      { score: 4, emoji: '🙂', label: t('scoreSelector.sleepLabel4'), sub: t('scoreSelector.sleepSub4') },
      { score: 3, emoji: '😐', label: t('scoreSelector.sleepLabel3'), sub: t('scoreSelector.sleepSub3') },
      { score: 2, emoji: '😟', label: t('scoreSelector.sleepLabel2'), sub: t('scoreSelector.sleepSub2') },
      { score: 1, emoji: '😢', label: t('scoreSelector.sleepLabel1'), sub: t('scoreSelector.sleepSub1') },
    ],
  };
}

export function ScoreSelector({ value, onChange, type = 'body' }: Props) {
  const { t } = useTranslation();
  const items = getScoreData(t)[type];
  return (
    <View style={styles.container}>
      {items.map(({ score, emoji, label, sub }) => {
        const selected = value === score;
        return (
          <TouchableOpacity
            key={score}
            style={[styles.card, selected && styles.cardSelected]}
            onPress={() => onChange(score)}
            activeOpacity={0.7}
          >
            <Text style={styles.emoji}>{emoji}</Text>
            <View style={styles.textWrap}>
              <Text style={[styles.label, selected && styles.labelSelected]}>{label}</Text>
              <Text style={[styles.sub, selected && styles.subSelected]}>{sub}</Text>
            </View>
            <View style={[styles.radio, selected && styles.radioSelected]}>
              {selected && <View style={styles.radioDot} />}
            </View>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 10 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 72,
    borderRadius: 16,
    borderWidth: 2,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
    paddingHorizontal: 20,
    paddingVertical: 12,
    gap: 16,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  emoji: { fontSize: 36 },
  textWrap: { flex: 1 },
  label: { fontSize: 20, fontWeight: '700', color: Colors.text, marginBottom: 2 },
  labelSelected: { color: Colors.dark },
  sub: { fontSize: 15, color: Colors.textSub },
  subSelected: { color: Colors.textSub },
  radio: {
    width: 26,
    height: 26,
    borderRadius: 13,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioSelected: { borderColor: Colors.primary },
  radioDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: Colors.primary,
  },
});
