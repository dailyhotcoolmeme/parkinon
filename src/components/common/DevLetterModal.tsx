/**
 * DevLetterModal — 개발자 편지 팝업 ("파킨온 앱을 출시하며")
 *
 * 온보딩 완료 사용자가 홈 첫 진입 시 1회 표시(다시 보지 않기 전까지 매 실행).
 * NotificationOnboardingModal 구조를 복제:
 * - Modal transparent + SafeAreaProvider 재주입(삼성 nav bar insets 0 이슈 대응)
 * - 상단 핸들 + ScrollView 본문(장문) + sticky 하단 버튼(스크롤 밖 고정)
 * - 딤 배경 + 슬라이드/페이드 애니메이션
 * - useSwipeDownDismiss 로 스와이프 다운 닫기(핸들 영역)
 *
 * 버튼:
 * - "닫기"(주, 초록 채움)     → 플래그 저장 안 함, 모달만 닫음
 * - "다시 보지 않기"(부, 외곽선) → dev_letter_dismissed_v1 저장 후 닫음
 * - 스와이프 다운/딤 탭          → "닫기"와 동일(저장 안 함)
 *
 * 어느 경로로 닫히든 onClose() 가 호출되어 후속 안내(가족 연동)를 이어갈 수 있다.
 *
 * SamsungOne 폰트 한글 ascender 클리핑 방지: lineHeight + includeFontPadding + textAlignVertical.
 */
import React, { useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  Animated,
  TouchableOpacity,
  ScrollView,
} from 'react-native';
import {
  SafeAreaProvider,
  useSafeAreaInsets,
  initialWindowMetrics,
} from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useTranslation } from 'react-i18next';
import { isOverseasLocale } from '../../i18n/detectLocale';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { supabase } from '../../lib/supabase';

// 기기 공용 1회성 플래그(로그아웃해도 유지 — USER_SCOPED_STORAGE_KEYS 에 넣지 않음).
export const DEV_LETTER_DISMISSED_KEY = 'dev_letter_dismissed_v1';

// 본문은 서버(dev_letter 테이블, parkinon.com/admin 에서 편집)에서 불러온다.
// 아래 배열들은 서버 실패/빈 값일 때의 폴백(=마지막으로 알려진 원문)이다.
// 서버 본문은 "빈 줄(문단 사이)" 기준으로 문단이 나뉜다.
const splitParagraphs = (text: string): string[] =>
  (text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

// 편지 본문(한글) — 원문 그대로(토씨/문단 구분 유지). 절대 임의 수정 금지.
const LETTER_PARAGRAPHS: string[] = [
  '안녕하세요 파킨온 앱 개발자입니다. 우선 이 앱을 다운 받으신 분들은 파킨슨 환자이거나 혹은 그 가족/지인들일겁니다. 네 그렇습니다. 저도 파킨슨 환자 가족입니다.',
  '처음 저희 장모님께서 파킨슨 진단을 받았던 날을 기억하면 온 가족들이 슬픔에 잠겨 있었는데... 어느덧 10여년이 흘렀습니다.',
  '아마 진단 받으신지 얼마 안되시는 분들도 계실테고, 저희처럼 혹은 저희보다 더 긴 시간 파킨슨과 함께하신 분들도 계실겁니다.',
  '사실 이 앱을 만든 이유는 저희 장모님과 저희 가족을 위해서였습니다. 매일 정해진 시간에 약을 잘 드셨는지, 혹시 잊어버리시진 않으셨는지 항상 신경이 쓰였습니다. 거기에 오늘은 몸상태, 기분상태가 어떠신지, \'오늘은 발음이 어눌하신데 괜찮으신지, 오늘은 발걸음이 좋아보이는데 다행이네\'와 같은 관심과 걱정들이 항상 우리 가족 모두의 마음속에 있었던 거 같습니다.',
  '하물며 저희 가족은 함께 거주하고 있어서 그나마 이렇게 관찰과 관심을 기울일 수 있다지만, 따로 떨어져 지내는 분들은 어떨지 생각해보았습니다.',
  '그래서 파킨슨이라는 같은 아픔을 겪고 있는 환자와 가족분들이 함께할 수 있는 앱을 만들면 좋겠다고 생각했습니다.',
  '이 앱은 환자 혼자서 복약/몸상태 기록하는 앱이 아닙니다. 가족이 함께 하는 앱입니다. 함께 거주하든 따로 거주하든 환자의 기록을 가족들이 함께 확인하고 응원하는 앱입니다. 환자 혼자 파킨슨 일기를 작성하는 게 아닌 보호자들이 함께 응원하며 기록을 덧붙이는 앱입니다. 성실한 기록들이 쌓이면 그 기록들을 모아서 시각화해서 보여드리는데, 그건 어쩌면 함께하는 가족분들을 위한 성적표일지도 모르겠습니다.',
  '희망컨대 저희 장모님의 담당 의사 선생님께 기회가 되면 이 앱의 기능들을 설명하면서 6개월치의 복약 기록과 몸상태, 기분상태 기록 그래프를 드려볼까 합니다. 그리고 의사 선생님께서 이 기록을 신뢰하셔서 다음 6개월치 약을 조절하실 때 참고가 된다면 개발자로서 더할나위 없이 기쁠 거 같습니다.',
  '파킨슨이라는 같은 아픔과 희망을 품고 살아가는 가족으로서 이 앱을 사용하는 환자들이 많이 생기지 않았으면 좋겠습니다. 그렇기에 이 앱으로 돈을 벌겠다는 생각도 없고 무료로 운영하려고 합니다. 다만 너무 많은 환자와 가족들이 적극적으로 사용하게 되는 불상사가(?) 생겨서, 부득이 운영비(서버 등)가 감당할 수 없게 된다면 그때는 사전에 공지를 드리겠습니다.',
  '마음 편히 사용하시고 불편한 점이 있으시다면 상단 카카오톡 이모티콘 누르면 오픈채팅방으로 연결되니 언제든지 의견 주십시오.',
  '*카카오톡 오픈채팅방은 오직 파킨온 앱 관련 불편사항 의견 받는 용도로만 운영됩니다',
];

// 편지 본문(영문) — 위 한글 원문의 번역. 아래 2곳은 한글 원문과 의도적으로 다르다(오너 지시, 2026-07-04):
//  1) 카카오톡 오픈채팅방 문단(해외엔 없는 기능) 제외 → 마무리 인사로 대체.
//  2) "무료로만 운영·수익화 계획 없음" 문단 제거 → 해외는 출시 즉시 구독/광고 수익화 예정이라
//     실제와 어긋남. 문맥이 끊기지 않게 "가족 곁에 계속 있고 싶다"는 취지로 보완.
const LETTER_PARAGRAPHS_EN: string[] = [
  "Hello, I'm the developer of the ParkinON app. If you've downloaded this app, you're likely a Parkinson's patient yourself, or a family member or friend of one. That's right — I'm a family member of a Parkinson's patient too.",
  "I still remember the day my mother-in-law was first diagnosed with Parkinson's — our whole family was overcome with sadness. Somehow, more than ten years have passed since then.",
  "Some of you may have been diagnosed only recently, while others may have been living with Parkinson's for as long as we have, or even longer.",
  "The truth is, I made this app for my mother-in-law and our family. I was always worried about whether she'd taken her medication on time, or whether she might have forgotten. On top of that, there was always a quiet concern in all our hearts about how she was feeling physically and emotionally that day — thoughts like 'her speech seems a little slurred today, I hope she's okay' or 'her steps look steadier today, that's a relief.'",
  "Since our family lives together, we're fortunate enough to be able to watch over her closely. But I found myself wondering what it must be like for families who live apart.",
  "So I thought it would be wonderful to build an app that patients and families going through the same struggle with Parkinson's could use together.",
  "This isn't an app for patients to track their medication and physical condition alone — it's an app for families to use together. Whether you live together or apart, it's an app where family members can check in on and encourage the patient's records together. Rather than a patient writing a Parkinson's journal alone, it's an app where caregivers join in with encouragement and add to the record. As faithful records build up over time, the app gathers and visualizes them — and in a way, that might become a kind of report card for the family who's been there together.",
  "I hope that, when the opportunity comes, I can show my mother-in-law's doctor how this app works, along with six months' worth of medication, physical condition, and mood record graphs. And if the doctor trusts these records enough to use them when adjusting her medication for the next six months, there would be no greater joy for me as a developer.",
  "As someone living with the same pain and hope as a family affected by Parkinson's, I hope the number of patients who ever need to use an app like this doesn't keep growing. Even so, for as long as families are going through this, I want ParkinON to be there for them — and I'll keep listening to your feedback and improving it for as long as it's needed.",
  'Thank you for using ParkinON. I sincerely hope it brings a little more comfort and connection to your family\'s journey with Parkinson\'s.',
];

interface Props {
  visible: boolean;
  /** 어느 경로로 닫히든(닫기/다시 보지 않기/스와이프/딤 탭) 닫힘 애니메이션 후 호출 */
  onClose: () => void;
}

function DevLetterModalContent({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // 삼성 3버튼 nav bar 환경에서 insets.bottom 이 0으로 잡히는 경우 fallback
  const bottomInset = insets.bottom > 0 ? insets.bottom : 24;
  const overseas = isOverseasLocale();
  // 서버 본문을 우선 사용하되, 로드 전/실패 시엔 폴백(하드코딩 원문)을 그대로 보여준다.
  const [paragraphs, setParagraphs] = React.useState<string[]>(
    overseas ? LETTER_PARAGRAPHS_EN : LETTER_PARAGRAPHS
  );

  React.useEffect(() => {
    let alive = true;
    // dev_letter 는 생성된 DB 타입에 아직 없어 any 캐스팅(런타임 조회엔 영향 없음).
    (supabase as any)
      .from('dev_letter')
      .select('body_ko, body_en')
      .eq('id', 1)
      .single()
      .then(({ data, error }: { data: any; error: any }) => {
        if (!alive || error || !data) return;
        const parsed = splitParagraphs(overseas ? (data as any).body_en : (data as any).body_ko);
        if (parsed.length) setParagraphs(parsed);
      });
    return () => {
      alive = false;
    };
  }, [overseas]);

  // 진입 애니메이션
  const fadeAnim = useRef(new Animated.Value(0)).current;
  const slideAnim = useRef(new Animated.Value(400)).current;

  // 스와이프 다운 닫기(저장 안 함) — 핸들 영역에만 부착해 본문 스크롤과 충돌 방지
  const finalize = (save: boolean) => {
    if (save) {
      AsyncStorage.setItem(DEV_LETTER_DISMISSED_KEY, '1').catch(() => {});
    }
    onClose();
  };

  const { translateY, panHandlers, resetPosition } = useSwipeDownDismiss(() => {
    // 스와이프로 닫힐 때 딤 배경도 함께 사라지게
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start();
    finalize(false);
  });

  React.useEffect(() => {
    if (visible) {
      fadeAnim.setValue(0);
      slideAnim.setValue(400);
      resetPosition();
      Animated.parallel([
        Animated.timing(fadeAnim, { toValue: 1, duration: 250, useNativeDriver: true }),
        Animated.spring(slideAnim, { toValue: 0, useNativeDriver: true, bounciness: 5 }),
      ]).start();
    }
  }, [visible]);

  const closeWithAnim = (save: boolean) => {
    Animated.parallel([
      Animated.timing(fadeAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
      Animated.timing(slideAnim, { toValue: 400, duration: 200, useNativeDriver: true }),
    ]).start(() => finalize(save));
  };

  // 딤 탭 = "닫기"와 동일(저장 안 함)
  const handleDimPress = () => closeWithAnim(false);
  const handleCloseBtn = () => closeWithAnim(false);
  const handleDontShowAgain = () => closeWithAnim(true);

  return (
    <Animated.View style={[styles.backdrop, { opacity: fadeAnim }]}>
      <TouchableOpacity style={StyleSheet.absoluteFill} activeOpacity={1} onPress={handleDimPress} />

      <Animated.View
        style={[
          styles.sheet,
          { transform: [{ translateY: slideAnim }, { translateY }] },
        ]}
      >
        {/* 핸들 영역 — 스와이프 다운 닫기(본문 스크롤과 충돌 방지 위해 여기에만 부착) */}
        <View style={styles.handleArea} {...panHandlers}>
          <View style={styles.handle} />
        </View>

        {/* 제목 영역 — ScrollView 밖 고정(핸들과 본문 사이) */}
        <View style={styles.headerArea}>
          <Text style={styles.title}>{t('devLetter.title')}</Text>
          <Text style={styles.subtitle}>{t('devLetter.subtitle')}</Text>
        </View>

        {/* 스크롤 본문 */}
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          showsVerticalScrollIndicator={true}
        >
          <View style={styles.bodyArea}>
            {paragraphs.map((p, i) => (
              <Text
                key={i}
                style={[styles.paragraph, p.startsWith('*') && styles.noteParagraph]}
              >
                {p}
              </Text>
            ))}
            <Text style={styles.signature}>{t('devLetter.signature')}</Text>
          </View>
        </ScrollView>

        {/* 하단 sticky 버튼 (ScrollView 밖 고정) */}
        <View
          style={[
            styles.buttonArea,
            { paddingBottom: Math.max(16, bottomInset + 16) },
          ]}
        >
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.confirmBtn}
            onPress={handleCloseBtn}
            accessibilityRole="button"
            accessibilityLabel={t('common.close')}
          >
            <Text style={styles.confirmBtnText}>{t('common.close')}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            activeOpacity={0.7}
            style={styles.laterBtn}
            onPress={handleDontShowAgain}
            accessibilityRole="button"
            accessibilityLabel={t('devLetter.dontShowAgain')}
          >
            <Text style={styles.laterBtnText}>{t('devLetter.dontShowAgain')}</Text>
          </TouchableOpacity>
        </View>
      </Animated.View>
    </Animated.View>
  );
}

export function DevLetterModal(props: Props) {
  return (
    <Modal
      visible={props.visible}
      transparent
      animationType="none"
      statusBarTranslucent={true}
      onRequestClose={props.onClose}
    >
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <DevLetterModalContent {...props} />
      </SafeAreaProvider>
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
    maxHeight: '90%',
  },
  handleArea: {
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: 6,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: Colors.border,
  },

  scrollView: {
    flexShrink: 1,
  },
  scrollContent: {
    paddingBottom: 8,
  },

  headerArea: {
    alignItems: 'center',
    paddingHorizontal: 24,
    paddingTop: 6,
    paddingBottom: 16,
    backgroundColor: Colors.white,
  },
  title: {
    fontFamily: 'NanumMyeongjo',
    fontSize: 22,
    fontWeight: 'bold',
    color: Colors.text,
    textAlign: 'center',
    marginBottom: 6,
    lineHeight: 32,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  subtitle: {
    fontFamily: 'NanumMyeongjo',
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 24,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },

  bodyArea: {
    paddingHorizontal: 22,
    paddingTop: 4,
  },
  paragraph: {
    fontFamily: 'NanumMyeongjo',
    fontSize: 18,
    color: Colors.text,
    lineHeight: 33,
    marginBottom: 26,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  noteParagraph: {
    fontSize: 15,
    color: Colors.textSub,
    lineHeight: 26,
    marginTop: -14,
  },
  signature: {
    fontFamily: 'NanumMyeongjo',
    fontSize: 18,
    color: Colors.text,
    fontWeight: '700',
    lineHeight: 30,
    marginTop: 10,
    marginBottom: 8,
    textAlign: 'center',
    includeFontPadding: true,
    textAlignVertical: 'center',
  },

  buttonArea: {
    paddingHorizontal: 20,
    paddingTop: 16,
    gap: 10,
    backgroundColor: Colors.white,
    borderTopWidth: 1,
    borderTopColor: Colors.border,
  },
  confirmBtn: {
    minHeight: 60,
    borderRadius: 16,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmBtnText: {
    fontSize: 20,
    fontWeight: 'bold',
    color: Colors.white,
    lineHeight: 28,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
  laterBtn: {
    minHeight: 56,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: Colors.border,
    backgroundColor: Colors.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
  laterBtnText: {
    fontSize: 17,
    color: Colors.textSub,
    fontWeight: '600',
    lineHeight: 24,
    includeFontPadding: true,
    textAlignVertical: 'center',
  },
});
