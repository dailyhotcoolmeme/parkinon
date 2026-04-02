// 1~5점 선택 컴포넌트 (몸상태/기분/수면) - 고령자 최적화
// 세로 배치 큰 카드 형태 → 60대 이상 손가락으로 쉽게 탭 가능
import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { Colors } from '../../constants/colors';

interface Props {
  value: number | null;
  onChange: (v: number) => void;
  type?: 'body' | 'mood' | 'sleep';
}

const SCORE_DATA = {
  body: [
    { score: 5, emoji: '😄', label: '매우 좋아요', sub: '활기차고 컨디션 최고예요' },
    { score: 4, emoji: '🙂', label: '좋아요', sub: '편안하고 괜찮아요' },
    { score: 3, emoji: '😐', label: '보통이에요', sub: '특별히 좋지도 나쁘지도 않아요' },
    { score: 2, emoji: '😟', label: '좋지 않아요', sub: '몸이 좀 불편해요' },
    { score: 1, emoji: '😢', label: '매우 나빠요', sub: '몸이 많이 힘들어요' },
  ],
  mood: [
    { score: 5, emoji: '😄', label: '매우 좋아요', sub: '기분이 정말 좋아요' },
    { score: 4, emoji: '🙂', label: '좋아요', sub: '마음이 편안해요' },
    { score: 3, emoji: '😐', label: '보통이에요', sub: '그냥 그래요' },
    { score: 2, emoji: '😟', label: '좋지 않아요', sub: '기분이 좀 가라앉아요' },
    { score: 1, emoji: '😢', label: '매우 나빠요', sub: '많이 우울하고 힘들어요' },
  ],
  sleep: [
    { score: 5, emoji: '😄', label: '아주 잘 잤어요', sub: '깊이 자고 개운해요' },
    { score: 4, emoji: '🙂', label: '잘 잤어요', sub: '대체로 편안했어요' },
    { score: 3, emoji: '😐', label: '그저 그랬어요', sub: '자다 깬 것 같아요' },
    { score: 2, emoji: '😟', label: '잘 못 잤어요', sub: '자주 깼어요' },
    { score: 1, emoji: '😢', label: '거의 못 잤어요', sub: '밤새 힘들었어요' },
  ],
};

export function ScoreSelector({ value, onChange, type = 'body' }: Props) {
  const items = SCORE_DATA[type];
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
