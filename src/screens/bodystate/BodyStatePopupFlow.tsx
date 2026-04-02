import React, { useRef, useEffect, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Animated,
  ScrollView,
  Dimensions,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { ScoreSelector } from '../../components/common/ScoreSelector';
import { PrimaryButton } from '../../components/common/PrimaryButton';

interface SaveData {
  bodyScore: number;
  moodScore: number;
  sleepScore?: number;
  constipation?: boolean;
}

interface Props {
  visible: boolean;
  onClose: () => void;
  onSave: (data: SaveData) => void;
  showSleep?: boolean;
  showConstipation?: boolean;
}

type Step = 'body' | 'mood' | 'sleep' | 'constipation' | 'exercise_suggest';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

export function BodyStatePopupFlow({
  visible,
  onClose,
  onSave,
  showSleep = false,
  showConstipation = false,
}: Props) {
  const [step, setStep] = useState<Step>('body');
  const [bodyScore, setBodyScore] = useState<number | null>(null);
  const [moodScore, setMoodScore] = useState<number | null>(null);
  const [sleepScore, setSleepScore] = useState<number | null>(null);
  const [constipation, setConstipation] = useState<boolean | null>(null);

  // useRef로 stale closure 문제 없이 항상 최신값 참조
  const bsRef = useRef<number | null>(null);
  const msRef = useRef<number | null>(null);
  const ssRef = useRef<number | null>(null);
  const cRef = useRef<boolean | null>(null);

  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;

  useEffect(() => {
    if (visible) {
      setStep('body');
      setBodyScore(null); bsRef.current = null;
      setMoodScore(null); msRef.current = null;
      setSleepScore(null); ssRef.current = null;
      setConstipation(null); cRef.current = null;
      slideAnim.setValue(80);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [visible]);

  const tryFinalize = (currentStep: Step) => {
    const bs = bsRef.current ?? 0;
    const ms = msRef.current ?? 0;
    const ss = ssRef.current ?? undefined;
    const c = cRef.current ?? undefined;
    const highScore = bs >= 4 || ms >= 4;
    if (highScore) {
      setStep('exercise_suggest');
    } else {
      onSave({ bodyScore: bs, moodScore: ms, sleepScore: ss, constipation: c });
    }
  };

  const advanceFrom = (currentStep: Step) => {
    if (currentStep === 'body') {
      setStep('mood');
    } else if (currentStep === 'mood') {
      if (showSleep) setStep('sleep');
      else if (showConstipation) setStep('constipation');
      else tryFinalize(currentStep);
    } else if (currentStep === 'sleep') {
      if (showConstipation) setStep('constipation');
      else tryFinalize(currentStep);
    } else if (currentStep === 'constipation') {
      tryFinalize(currentStep);
    }
  };

  const handleScoreSelect = (val: number, currentStep: Step) => {
    if (currentStep === 'body') { setBodyScore(val); bsRef.current = val; }
    else if (currentStep === 'mood') { setMoodScore(val); msRef.current = val; }
    else if (currentStep === 'sleep') { setSleepScore(val); ssRef.current = val; }
    setTimeout(() => advanceFrom(currentStep), 350);
  };

  const handleConstipationSelect = (val: boolean) => {
    setConstipation(val); cRef.current = val;
    setTimeout(() => advanceFrom('constipation'), 350);
  };

  const handleExerciseSave = () => {
    onSave({
      bodyScore: bsRef.current ?? 0,
      moodScore: msRef.current ?? 0,
      sleepScore: ssRef.current ?? undefined,
      constipation: cRef.current ?? undefined,
    });
  };

  const orderedSteps: Step[] = ['body', 'mood'];
  if (showSleep) orderedSteps.push('sleep');
  if (showConstipation) orderedSteps.push('constipation');
  const currentIndex = step === 'exercise_suggest' ? -1 : orderedSteps.indexOf(step);

  const scoreForStep = () => {
    if (step === 'body') return bodyScore;
    if (step === 'mood') return moodScore;
    if (step === 'sleep') return sleepScore;
    return null;
  };

  const STEP_CONFIG: Record<Exclude<Step, 'exercise_suggest' | 'constipation'>, { title: string; desc: string; type: 'body' | 'mood' | 'sleep' }> = {
    body: { title: '지금 몸 상태는\n어떠세요?', desc: '현재 몸 컨디션을 알려주세요', type: 'body' },
    mood: { title: '지금 기분은\n어떠세요?', desc: '마음 상태를 알려주세요', type: 'mood' },
    sleep: { title: '어젯밤 수면은\n어떠셨어요?', desc: '잠자리가 어떠셨는지 알려주세요', type: 'sleep' },
  };

  const renderContent = () => {
    if (step === 'exercise_suggest') {
      return (
        <View style={styles.exerciseWrap}>
          <View style={styles.exerciseIconCircle}>
            <Ionicons name="trophy-outline" size={52} color={Colors.primary} />
          </View>
          <Text style={styles.exerciseTitle}>몸 상태가{'\n'}좋으시네요!</Text>
          <Text style={styles.exerciseDesc}>
            컨디션이 좋을 때 가볍게 운동하면{'\n'}파킨슨 증상 완화에 도움이 돼요.
          </Text>
          <PrimaryButton title="운동하러 가기" onPress={handleExerciseSave} />
          <TouchableOpacity style={styles.skipBtn} onPress={handleExerciseSave}>
            <Text style={styles.skipText}>다음에 할게요</Text>
          </TouchableOpacity>
        </View>
      );
    }

    if (step === 'constipation') {
      return (
        <View style={styles.contentWrap}>
          <Text style={styles.stepTitle}>{'오늘 변비 증상이\n있으셨나요?'}</Text>
          <Text style={styles.stepDesc}>솔직하게 알려주세요</Text>
          <View style={styles.constipationCol}>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === true && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(true)}
              activeOpacity={0.75}
            >
              <Text style={styles.constipationEmoji}>😖</Text>
              <Text style={[styles.constipationLabel, constipation === true && styles.constipationLabelActive]}>
                네, 있었어요
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === false && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(false)}
              activeOpacity={0.75}
            >
              <Text style={styles.constipationEmoji}>😊</Text>
              <Text style={[styles.constipationLabel, constipation === false && styles.constipationLabelActive]}>
                아니요, 없었어요
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const cfg = STEP_CONFIG[step as Exclude<Step, 'exercise_suggest' | 'constipation'>];
    return (
      <View style={styles.contentWrap}>
        <Text style={styles.stepTitle}>{cfg.title}</Text>
        <Text style={styles.stepDesc}>{cfg.desc}</Text>
        <ScrollView showsVerticalScrollIndicator={false} style={styles.scoreScroll}>
          <ScoreSelector
            value={scoreForStep()}
            onChange={(v) => handleScoreSelect(v, step)}
            type={cfg.type}
          />
        </ScrollView>
      </View>
    );
  };

  const handleClose = () => {
    if (step === 'exercise_suggest') handleExerciseSave();
    else onClose();
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.sheet, { transform: [{ translateY: slideAnim }] }]}>
          {/* 헤더 */}
          <View style={styles.header}>
            {step !== 'exercise_suggest' && (
              <View style={styles.dotRow}>
                {orderedSteps.map((s, i) => (
                  <View key={s} style={[styles.dot, i === currentIndex && styles.dotActive]} />
                ))}
              </View>
            )}
            <TouchableOpacity style={styles.closeBtn} onPress={handleClose}>
              <Ionicons name="close" size={20} color={Colors.textSub} />
              <Text style={styles.closeBtnText}>닫기</Text>
            </TouchableOpacity>
          </View>

          {renderContent()}
        </Animated.View>
      </Animated.View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: Colors.white,
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    maxHeight: SCREEN_HEIGHT * 0.92,
    paddingBottom: 40,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    paddingHorizontal: 20,
    paddingBottom: 8,
    position: 'relative',
    minHeight: 56,
  },
  dotRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },
  dotActive: { backgroundColor: Colors.primary, width: 24 },
  closeBtn: {
    position: 'absolute', right: 16, top: 12,
    flexDirection: 'row', alignItems: 'center', gap: 4,
    paddingVertical: 8, paddingHorizontal: 14,
    backgroundColor: Colors.background,
    borderRadius: 20, borderWidth: 1.5, borderColor: Colors.border,
  },
  closeBtnText: { fontSize: 15, color: Colors.textSub, fontWeight: '700' },

  contentWrap: { paddingHorizontal: 20, paddingTop: 4 },
  stepTitle: {
    fontSize: 28, fontWeight: '800', color: Colors.text,
    lineHeight: 40, marginBottom: 6,
  },
  stepDesc: { fontSize: 17, color: Colors.textSub, marginBottom: 20, lineHeight: 24 },
  scoreScroll: { maxHeight: SCREEN_HEIGHT * 0.58 },

  constipationCol: { gap: 14, marginTop: 4, paddingBottom: 8 },
  constipationBtn: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 80, borderRadius: 18, borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.white, paddingHorizontal: 24, paddingVertical: 16, gap: 18,
  },
  constipationBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.light },
  constipationEmoji: { fontSize: 38 },
  constipationLabel: { fontSize: 22, fontWeight: '700', color: Colors.text },
  constipationLabelActive: { color: Colors.dark },

  exerciseWrap: { paddingHorizontal: 24, paddingTop: 12, alignItems: 'center' },
  exerciseIconCircle: {
    width: 100, height: 100, borderRadius: 50,
    backgroundColor: Colors.light, alignItems: 'center', justifyContent: 'center',
    marginBottom: 20,
  },
  exerciseTitle: {
    fontSize: 30, fontWeight: '800', color: Colors.text,
    textAlign: 'center', lineHeight: 42, marginBottom: 14,
  },
  exerciseDesc: {
    fontSize: 18, color: Colors.textSub, textAlign: 'center',
    lineHeight: 28, marginBottom: 32,
  },
  skipBtn: { marginTop: 14, paddingVertical: 14, paddingHorizontal: 24 },
  skipText: { fontSize: 18, color: Colors.textHint, fontWeight: '600', textAlign: 'center' },
});
