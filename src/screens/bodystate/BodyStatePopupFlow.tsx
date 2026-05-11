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
  Alert,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Colors } from '../../constants/colors';
import { ScoreSelector } from '../../components/common/ScoreSelector';

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

type Step = 'body' | 'mood' | 'sleep' | 'constipation';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type StepKey = Exclude<Step, 'constipation'>;

const STEP_CONFIG: Record<StepKey, {
  title: string; desc: string; type: 'body' | 'mood' | 'sleep';
  accentColor: string; bgColor: string; stepLabel: string;
}> = {
  body: {
    title: '지금 몸 상태는 어떠세요?',
    desc: '현재 몸 컨디션을 알려주세요',
    type: 'body',
    accentColor: Colors.primary,
    bgColor: '#E8F5E9',
    stepLabel: '몸 상태',
  },
  mood: {
    title: '지금 기분은 어떠세요?',
    desc: '마음 상태를 알려주세요',
    type: 'mood',
    accentColor: '#7C4DFF',
    bgColor: '#F3E8FF',
    stepLabel: '기분 상태',
  },
  sleep: {
    title: '어젯밤 수면은 어떠셨어요?',
    desc: '잠자리가 어떠셨는지 알려주세요',
    type: 'sleep',
    accentColor: '#1565C0',
    bgColor: '#E3F2FD',
    stepLabel: '수면',
  },
};

export function BodyStatePopupFlow({
  visible,
  onClose,
  onSave,
  showSleep = false,
  showConstipation = false,
}: Props) {
  const insets = useSafeAreaInsets();
  const [step, setStep] = useState<Step>('body');
  const [bodyScore, setBodyScore] = useState<number | null>(null);
  const [moodScore, setMoodScore] = useState<number | null>(null);
  const [sleepScore, setSleepScore] = useState<number | null>(null);
  const [constipation, setConstipation] = useState<boolean | null>(null);

  const bsRef = useRef<number | null>(null);
  const msRef = useRef<number | null>(null);
  const ssRef = useRef<number | null>(null);
  const cRef = useRef<boolean | null>(null);

  // 시트 진입 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(80)).current;

  // 스텝 전환 애니메이션
  const contentSlide = useRef(new Animated.Value(0)).current;
  const contentOpacity = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (visible) {
      setStep('body');
      setBodyScore(null); bsRef.current = null;
      setMoodScore(null); msRef.current = null;
      setSleepScore(null); ssRef.current = null;
      setConstipation(null); cRef.current = null;
      slideAnim.setValue(80);
      contentSlide.setValue(0);
      contentOpacity.setValue(1);
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 220, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, tension: 70, friction: 12, useNativeDriver: true }),
      ]).start();
    } else {
      Animated.timing(fadeAnim, { toValue: 0, duration: 180, useNativeDriver: true }).start();
    }
  }, [visible]);

  const animateStepIn = () => {
    contentSlide.setValue(32);
    contentOpacity.setValue(0);
    Animated.parallel([
      Animated.spring(contentSlide, { toValue: 0, tension: 140, friction: 16, useNativeDriver: true }),
      Animated.timing(contentOpacity, { toValue: 1, duration: 230, useNativeDriver: true }),
    ]).start();
  };

  const tryFinalize = (currentStep: Step) => {
    const bs = bsRef.current ?? 0;
    const ms = msRef.current ?? 0;
    const ss = ssRef.current ?? undefined;
    const c = cRef.current ?? undefined;
    onSave({ bodyScore: bs, moodScore: ms, sleepScore: ss, constipation: c });
  };

  const advanceFrom = (currentStep: Step) => {
    if (currentStep === 'body') {
      setStep('mood'); setTimeout(animateStepIn, 0);
    } else if (currentStep === 'mood') {
      if (showSleep) { setStep('sleep'); setTimeout(animateStepIn, 0); }
      else if (showConstipation) { setStep('constipation'); setTimeout(animateStepIn, 0); }
      else tryFinalize(currentStep);
    } else if (currentStep === 'sleep') {
      if (showConstipation) { setStep('constipation'); setTimeout(animateStepIn, 0); }
      else tryFinalize(currentStep);
    } else if (currentStep === 'constipation') {
      tryFinalize(currentStep);
    }
  };

  const handleScoreSelect = (val: number, currentStep: Step) => {
    if (currentStep === 'body') { setBodyScore(val); bsRef.current = val; }
    else if (currentStep === 'mood') { setMoodScore(val); msRef.current = val; }
    else if (currentStep === 'sleep') { setSleepScore(val); ssRef.current = val; }
    // 자동 전환 제거 — 다음 버튼으로만 이동
  };

  const orderedSteps: Step[] = ['body', 'mood'];
  if (showSleep) orderedSteps.push('sleep');
  if (showConstipation) orderedSteps.push('constipation');
  const currentIndex = orderedSteps.indexOf(step);

  const handleNextPress = () => {
    advanceFrom(step);
  };

  const handlePrevPress = () => {
    if (currentIndex <= 0) return;
    const prevStep = orderedSteps[currentIndex - 1];
    setStep(prevStep);
    setTimeout(animateStepIn, 0);
  };

  const handleConstipationSelect = (val: boolean) => {
    // 즉시 저장 제거 — 선택만 강조, "완료" 버튼 탭 시 저장
    setConstipation(val); cRef.current = val;
  };

  const scoreForStep = () => {
    if (step === 'body') return bodyScore;
    if (step === 'mood') return moodScore;
    if (step === 'sleep') return sleepScore;
    return null;
  };

  const renderContent = () => {
    if (step === 'constipation') {
      return (
        <View style={styles.contentWrap}>
          <View style={[styles.stepBanner, { backgroundColor: '#FFF8E1' }]}>
            <View style={styles.stepBannerText}>
              <Text style={[styles.stepBannerLabel, { color: '#F57F17' }]}>
                변비  {currentIndex + 1}/{orderedSteps.length}단계
              </Text>
              <Text style={styles.stepTitle}>오늘 변비 증상이 있으셨나요?</Text>
            </View>
          </View>
          <Text style={styles.stepDesc}>솔직하게 알려주세요</Text>
          <View style={styles.constipationCol}>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === true && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(true)}
              activeOpacity={0.75}
            >
              <Text style={[styles.constipationLabel, constipation === true && styles.constipationLabelActive]}>
                네, 있었어요
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === false && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(false)}
              activeOpacity={0.75}
            >
              <Text style={[styles.constipationLabel, constipation === false && styles.constipationLabelActive]}>
                아니요, 없었어요
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    const cfg = STEP_CONFIG[step as StepKey];
    return (
      <View>
        {/* 스텝별 컬러 배너 */}
        <View style={[styles.stepBanner, { backgroundColor: cfg.bgColor }]}>
          <View style={styles.stepBannerText}>
            <Text style={[styles.stepBannerLabel, { color: cfg.accentColor }]}>
              {cfg.stepLabel}  {currentIndex + 1}/{orderedSteps.length}단계
            </Text>
            <Text style={styles.stepTitle}>{cfg.title}</Text>
          </View>
        </View>
        <View style={styles.contentWrap}>
          <Text style={styles.stepDesc}>{cfg.desc}</Text>
          <ScrollView showsVerticalScrollIndicator={false} style={styles.scoreScroll}>
            <ScoreSelector
              value={scoreForStep()}
              onChange={(v) => handleScoreSelect(v, step)}
              type={cfg.type}
            />
          </ScrollView>
        </View>
      </View>
    );
  };

  const handleClose = () => {
    onClose();
  };

  // 우상단 X — 1단계는 단순 닫기, 2단계 이후는 confirm
  const handleTopClose = () => {
    if (currentIndex === 0) {
      onClose();
      return;
    }
    Alert.alert(
      '기록을 닫을까요?',
      '기록 중인 내용이 있어요. 닫으면 저장되지 않아요.',
      [
        { text: '취소', style: 'cancel' },
        { text: '닫기', style: 'destructive', onPress: () => onClose() },
      ],
    );
  };

  return (
    <Modal visible={visible} transparent animationType="none" onRequestClose={handleClose}>
      <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
        <Animated.View style={[styles.sheet, { paddingBottom: Math.max(24, insets.bottom + 12), transform: [{ translateY: slideAnim }] }]}>
          {/* 진행 도트 + 우상단 닫기 */}
          <View style={styles.header}>
            <View style={styles.dotRow}>
              {orderedSteps.map((s, i) => (
                <View
                  key={s}
                  style={[
                    styles.dot,
                    i === currentIndex && {
                      backgroundColor: step in STEP_CONFIG
                        ? STEP_CONFIG[step as StepKey].accentColor
                        : Colors.primary,
                      width: 24,
                    },
                  ]}
                />
              ))}
            </View>
            <TouchableOpacity
              style={styles.topCloseBtn}
              onPress={handleTopClose}
              activeOpacity={0.7}
              hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
            >
              <Ionicons name="close" size={26} color={Colors.textSub} />
            </TouchableOpacity>
          </View>

          {/* 스텝 콘텐츠 (전환 애니메이션) */}
          <Animated.View style={{
            transform: [{ translateY: contentSlide }],
            opacity: contentOpacity,
          }}>
            {renderContent()}
          </Animated.View>

          {/* 하단 버튼 영역 */}
          <View style={styles.navRow}>
            {currentIndex > 0 ? (
              <TouchableOpacity style={styles.navBtnOutline} onPress={handlePrevPress} activeOpacity={0.75}>
                <Text style={styles.navBtnOutlineText}>이전</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.navBtnOutline} onPress={onClose} activeOpacity={0.75}>
                <Ionicons name="close-outline" size={20} color={Colors.textSub} />
                <Text style={styles.navBtnOutlineText}>닫기</Text>
              </TouchableOpacity>
            )}
            {(() => {
              const isLastStep = currentIndex === orderedSteps.length - 1;
              const hasSelection = step === 'constipation' ? constipation !== null : scoreForStep() !== null;
              const disabled = !hasSelection;
              return (
                <TouchableOpacity
                  style={[
                    styles.navBtnPrimary,
                    disabled && styles.navBtnPrimaryDisabled,
                  ]}
                  onPress={handleNextPress}
                  activeOpacity={0.8}
                  disabled={disabled}
                >
                  <Text style={styles.navBtnPrimaryText}>{isLastStep ? '완료' : '다음'}</Text>
                </TouchableOpacity>
              );
            })()}
          </View>
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
    paddingBottom: 24,
    overflow: 'hidden',
  },
  header: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 20,
    paddingBottom: 4,
    position: 'relative',
  },
  topCloseBtn: {
    position: 'absolute',
    right: 12,
    top: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.background,
    zIndex: 100,
    elevation: 100,
  },
  dotRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: Colors.border },

  // 스텝 배너
  stepBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 20,
    gap: 16,
  },
  stepBannerEmoji: { fontSize: 48 },
  stepBannerText: { flex: 1 },
  stepBannerLabel: { fontSize: 14, fontWeight: '700', marginBottom: 4, letterSpacing: 0.3 },
  stepTitle: { fontSize: 22, fontWeight: '800', color: Colors.text, lineHeight: 30 },

  contentWrap: { paddingHorizontal: 16, paddingTop: 12 },
  stepDesc: { fontSize: 17, color: Colors.textSub, marginBottom: 16, lineHeight: 24 },
  scoreScroll: { maxHeight: SCREEN_HEIGHT * 0.55 },

  constipationCol: { gap: 14, marginTop: 4, paddingBottom: 8 },
  constipationBtn: {
    flexDirection: 'row', alignItems: 'center',
    minHeight: 80, borderRadius: 18, borderWidth: 2, borderColor: Colors.border,
    backgroundColor: Colors.white, paddingHorizontal: 16, paddingVertical: 16, gap: 18,
  },
  constipationBtnActive: { borderColor: Colors.primary, backgroundColor: Colors.light },
  constipationEmoji: { fontSize: 38 },
  constipationLabel: { fontSize: 22, fontWeight: '700', color: Colors.text },
  constipationLabelActive: { color: Colors.dark },

  navRow: {
    flexDirection: 'row',
    gap: 12,
    marginHorizontal: 20,
    marginTop: 14,
  },
  navBtnOutline: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
  },
  navBtnOutlineText: { fontSize: 18, fontWeight: '700', color: Colors.textSub },
  navBtnPrimary: {
    flex: 2,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 14,
    backgroundColor: Colors.primary,
  },
  navBtnPrimaryDisabled: {
    backgroundColor: Colors.border,
  },
  navBtnPrimaryText: { fontSize: 18, fontWeight: '800', color: Colors.white },
});
