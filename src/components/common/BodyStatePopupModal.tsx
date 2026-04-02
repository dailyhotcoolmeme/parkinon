import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
} from 'react-native';
import { Colors } from '../../constants/colors';
import { ScoreSelector } from './ScoreSelector';

interface Props {
  visible: boolean;
  prevBodyScore?: number;
  onClose: () => void;
  onSave: (score: number) => void;
}

export function BodyStatePopupModal({ visible, onClose, onSave, prevBodyScore }: Props) {
  const [score, setScore] = useState<number | null>(null);

  const handleScoreSelect = (val: number) => {
    setScore(val);
    setTimeout(() => {
      onSave(val);
    }, 400);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.backdrop}>
        <View style={styles.centerModal}>
          <Text style={styles.title}>약을 드셨군요 😊</Text>
          <Text style={styles.subtitle}>지금 몸 상태는 어떠세요?</Text>
          
          {prevBodyScore !== undefined && (
            <Text style={styles.prevScore}>💡 이전 몸상태 기록: {prevBodyScore}점</Text>
          )}

          <View style={styles.selectorWrap}>
            <ScoreSelector value={score} onChange={handleScoreSelect} />
          </View>

          <TouchableOpacity style={styles.laterBtn} onPress={onClose}>
            <Text style={styles.laterText}>닫기</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  centerModal: {
    width: '100%',
    backgroundColor: Colors.white,
    borderRadius: 24,
    padding: 24,
    paddingTop: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    marginBottom: 16,
  },
  prevScore: {
    fontSize: 14,
    color: Colors.primary,
    fontWeight: '600',
    textAlign: 'center',
    marginBottom: 20,
    backgroundColor: Colors.light,
    paddingVertical: 8,
    borderRadius: 8,
  },
  selectorWrap: {
    marginBottom: 24,
  },
  laterBtn: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  laterText: {
    fontSize: 16,
    color: Colors.textHint,
    fontWeight: '600',
  },
});
