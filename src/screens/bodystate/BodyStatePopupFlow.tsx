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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { Colors } from '../../constants/colors';
import { ScoreSelector } from '../../components/common/ScoreSelector';
import { useDialog } from '../../context/DialogContext';

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
  onGoExercise?: () => void;
  showSleep?: boolean;
  showConstipation?: boolean;
  /**
   * showSleep/showConstipation 게이팅 값이 신뢰 가능한지(예: 오늘 로그 최소 1회 로드 완료).
   * false면 단계 구성 스냅샷을 미루고 실시간 prop 을 쓴다 → 콜드스타트로 todayLogs 가 아직
   * 비어 hasSleepToday=false 로 잘못 스냅샷돼 수면을 중복으로 묻는 문제 방지. 기본 true(하위호환).
   */
  gatingReady?: boolean;
  /** 'edit' 이면 각 단계에 기존 점수를 미리 선택한 상태로 연다(기록 수정용). */
  mode?: 'create' | 'edit';
  initialBody?: number | null;
  initialMood?: number | null;
  initialSleep?: number | null;
  initialConstipation?: boolean | null;
}

type Step = 'body' | 'mood' | 'sleep' | 'constipation';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

type StepKey = Exclude<Step, 'constipation'>;

// 화면 텍스트(title/desc/stepLabel)는 i18n 키로 보관하고 렌더 시 t()로 해석한다.
// 색·타입 등 비문자 설정은 그대로 유지(국내 회귀 0).
const STEP_CONFIG: Record<StepKey, {
  titleKey: string; descKey: string; type: 'body' | 'mood' | 'sleep';
  accentColor: string; bgColor: string; stepLabelKey: string;
}> = {
  body: {
    titleKey: 'bodystate.popup.bodyTitle',
    descKey: 'bodystate.popup.bodyDesc',
    type: 'body',
    accentColor: Colors.primary,
    bgColor: '#E8F5E9',
    stepLabelKey: 'bodystate.popup.bodyLabel',
  },
  mood: {
    titleKey: 'bodystate.popup.moodTitle',
    descKey: 'bodystate.popup.moodDesc',
    type: 'mood',
    accentColor: '#7C4DFF',
    bgColor: '#F3E8FF',
    stepLabelKey: 'bodystate.popup.moodLabel',
  },
  sleep: {
    titleKey: 'bodystate.popup.sleepTitle',
    descKey: 'bodystate.popup.sleepDesc',
    type: 'sleep',
    accentColor: '#1565C0',
    bgColor: '#E3F2FD',
    stepLabelKey: 'bodystate.popup.sleepLabel',
  },
};

export function BodyStatePopupFlow({
  visible,
  onClose,
  onSave,
  showSleep = false,
  showConstipation = false,
  gatingReady = true,
  mode = 'create',
  initialBody = null,
  initialMood = null,
  initialSleep = null,
  initialConstipation = null,
}: Props) {
  const isEdit = mode === 'edit';
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  const { t } = useTranslation();
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
      // 수정 모드: 기존 점수를 미리 선택. 입력 모드: 빈 값.
      setBodyScore(initialBody); bsRef.current = initialBody;
      setMoodScore(initialMood); msRef.current = initialMood;
      setSleepScore(initialSleep); ssRef.current = initialSleep;
      setConstipation(initialConstipation); cRef.current = initialConstipation;
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

  // 팝업이 열리는 "그 순간"의 단계 구성(수면·변비 노출 여부)을 스냅샷으로 고정한다.
  //   부모(BodyStateScreen)의 showSleep/showConstipation 은 activeLogs·displaySlots 재조회 등으로
  //   팝업이 열려 있는 동안에도 바뀔 수 있어, 그대로 쓰면 단계 카운터(1/3 → 2/2)와 흐름이 도중에
  //   흔들린다. 열림 전환 시점에 한 번 캡처해 흐름 내내 고정한다.
  //   단, 게이팅 값이 아직 신뢰 불가(gatingReady=false, 콜드스타트로 오늘 로그 미로드)면 스냅샷을
  //   미룬다 — 그 사이엔 실시간 prop 을 쓰고(수면/변비 단계는 body·mood 뒤라 아직 필요 없음),
  //   로드가 끝나(gatingReady=true) 정확한 값이 되면 그때 한 번 고정한다.
  //   (미루지 않으면 hasSleepToday=false 로 잘못 고정돼 이미 기록한 수면을 또 묻는다.)
  const openedRef = useRef(false);
  const stepShowRef = useRef<{ sleep: boolean; constipation: boolean }>({ sleep: showSleep, constipation: showConstipation });
  if (visible && gatingReady && !openedRef.current) {
    openedRef.current = true;
    stepShowRef.current = { sleep: showSleep, constipation: showConstipation };
  } else if (!visible && openedRef.current) {
    openedRef.current = false;
  }
  // 스냅샷 전(대기 중)엔 실시간 prop, 스냅샷 후엔 고정값을 쓴다.
  const stepSleep = openedRef.current ? stepShowRef.current.sleep : showSleep;
  const stepConstipation = openedRef.current ? stepShowRef.current.constipation : showConstipation;

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
      if (stepSleep) { setStep('sleep'); setTimeout(animateStepIn, 0); }
      else if (stepConstipation) { setStep('constipation'); setTimeout(animateStepIn, 0); }
      else tryFinalize(currentStep);
    } else if (currentStep === 'sleep') {
      if (stepConstipation) { setStep('constipation'); setTimeout(animateStepIn, 0); }
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
  if (stepSleep) orderedSteps.push('sleep');
  if (stepConstipation) orderedSteps.push('constipation');
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
                {t(isEdit ? 'bodystate.popup.stepBadgeEdit' : 'bodystate.popup.stepBadge', {
                  label: t('bodystate.popup.constipationLabel'),
                  current: currentIndex + 1,
                  total: orderedSteps.length,
                })}
              </Text>
              <Text style={styles.stepTitle}>{t('bodystate.popup.constipationTitle')}</Text>
            </View>
          </View>
          <Text style={styles.stepDesc}>{t('bodystate.popup.constipationDesc')}</Text>
          <View style={styles.constipationCol}>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === true && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(true)}
              activeOpacity={0.75}
            >
              <Text style={[styles.constipationLabel, constipation === true && styles.constipationLabelActive]}>
                {t('bodystate.popup.constipationYes')}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.constipationBtn, constipation === false && styles.constipationBtnActive]}
              onPress={() => handleConstipationSelect(false)}
              activeOpacity={0.75}
            >
              <Text style={[styles.constipationLabel, constipation === false && styles.constipationLabelActive]}>
                {t('bodystate.popup.constipationNo')}
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
              {t(isEdit ? 'bodystate.popup.stepBadgeEdit' : 'bodystate.popup.stepBadge', {
                label: t(cfg.stepLabelKey),
                current: currentIndex + 1,
                total: orderedSteps.length,
              })}
            </Text>
            <Text style={styles.stepTitle}>{t(cfg.titleKey)}</Text>
          </View>
        </View>
        <View style={styles.contentWrap}>
          <Text style={styles.stepDesc}>{t(cfg.descKey)}</Text>
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
  const handleTopClose = async () => {
    if (currentIndex === 0) {
      onClose();
      return;
    }
    const ok = await dialog.confirm({
      title: t('bodystate.popup.closeConfirmTitle'),
      message: t('bodystate.popup.closeConfirmMsg'),
      confirmText: t('bodystate.popup.close'),
      cancelText: t('common.cancel'),
      destructive: true,
    });
    if (!ok) return;
    onClose();
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
                <Text style={styles.navBtnOutlineText}>{t('bodystate.popup.prev')}</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.navBtnOutline} onPress={onClose} activeOpacity={0.75}>
                <Ionicons name="close-outline" size={20} color={Colors.textSub} />
                <Text style={styles.navBtnOutlineText}>{t('bodystate.popup.close')}</Text>
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
                  <Text style={styles.navBtnPrimaryText}>{isLastStep ? t('bodystate.popup.done') : t('bodystate.popup.next')}</Text>
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
