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
import { OverlaySheet } from './OverlaySheet';
import i18n from '../../i18n';
import {
  View,
  Text,
  StyleSheet,
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
import { isOverseasLocale, isKoreanLocale } from '../../i18n/detectLocale';
import { Colors } from '../../constants/colors';
import { useSwipeDownDismiss } from '../../hooks/useSwipeDownDismiss';
import { supabase } from '../../lib/supabase';

// 기기 공용 1회성 플래그(로그아웃해도 유지 — USER_SCOPED_STORAGE_KEYS 에 넣지 않음).
// 값에는 "마지막으로 '다시 보지 않기' 한 시점의 popup_version"(숫자 문자열)을 저장한다.
// (구버전은 '1' 을 저장했는데 popup_version 기본값이 1 이라 그대로 호환된다.)
export const DEV_LETTER_DISMISSED_KEY = 'dev_letter_dismissed_v1';

// 본문은 서버(dev_letter 테이블, parkinon.com/app/admin 에서 편집)에서 불러온다.
// (2026-08-10 웹사이트 정식 오픈으로 관리자 화면이 /app/admin 으로 이전됨. 주소창에
// 옛 /admin 을 입력해도 자동으로 넘어가지만, 새 코드에는 새 주소를 적을 것.)
// 아래 배열들은 서버 실패/빈 값일 때의 폴백(=마지막으로 알려진 원문)이다.
// 서버 본문은 "빈 줄(문단 사이)" 기준으로 문단이 나뉜다.
const splitParagraphs = (text: string): string[] =>
  (text || '').split(/\n\s*\n/).map((s) => s.trim()).filter(Boolean);

// 서버의 현재 강제-노출 버전을 읽는다. 실패 시 fallback 반환.
async function fetchPopupVersion(fallback: number): Promise<number> {
  try {
    const { data, error } = await (supabase as any)
      .from('dev_letter')
      .select('popup_version')
      .eq('id', 1)
      .single();
    if (error || !data || typeof data.popup_version !== 'number') return fallback;
    return data.popup_version;
  } catch {
    return fallback;
  }
}

// 개발자 일기 팝업을 이번에 띄울지 결정.
//  - 한국어 로케일이면 노출 안 함(2026-08-03 오너 결정).
//  - 한 번도 닫지 않았으면(저장값 없음) → 항상 노출(기존 동작 유지).
//  - '다시 보지 않기' 한 적이 있어도, 그 버전 < 서버 popup_version 이면 다시 노출
//    (= admin '강제 팝업 띄우기'). 이후 다시 '다시 보지 않기' 를 누르면 최신 버전이 저장돼 다시 숨겨진다.
//  - 서버 조회 실패 시엔 강제하지 않는다(닫은 사람은 계속 숨김).
export async function shouldShowDevLetter(): Promise<boolean> {
  if (isKoreanLocale()) return false;
  let stored: string | null = null;
  try {
    stored = await AsyncStorage.getItem(DEV_LETTER_DISMISSED_KEY);
  } catch {}
  if (stored === null) return true; // 한 번도 닫은 적 없음
  const dismissedVersion = parseInt(stored, 10) || 1;
  const serverVersion = await fetchPopupVersion(dismissedVersion);
  return dismissedVersion < serverVersion;
}

interface Props {
  visible: boolean;
  /** 어느 경로로 닫히든(닫기/다시 보지 않기/스와이프/딤 탭) 닫힘 애니메이션 후 호출 */
  onClose: () => void;
}

/** 편지 본문을 고를 언어. 지원 밖 언어는 영어로 떨어진다(앱 전체 폴백과 동일). */
function letterLang(): 'ko' | 'en' | 'fr' | 'ja' {
  const l = (i18n.language || 'en').split('-')[0];
  return (['ko', 'en', 'fr', 'ja'] as const).includes(l as never) ? (l as 'ko' | 'en' | 'fr' | 'ja') : 'en';
}

function DevLetterModalContent({ visible, onClose }: Props) {
  const { t } = useTranslation();
  const insets = useSafeAreaInsets();
  // 삼성 3버튼 nav bar 환경에서 insets.bottom 이 0으로 잡히는 경우 fallback
  const bottomInset = insets.bottom > 0 ? insets.bottom : 24;
  const overseas = isOverseasLocale();
  // 서버 본문을 우선 사용하되, 로드 전/실패 시엔 폴백(하드코딩 원문)을 그대로 보여준다.
  // 예비본은 번역 파일에서 꺼낸다. DB 조회가 성공하면 그 내용으로 갈아치운다.
  // 나라별로 문단 수가 다르다(한국어에만 있는 안내가 있음) — 그래서 한 덩어리로 두고 여기서 나눈다.
  const [paragraphs, setParagraphs] = React.useState<string[]>(
    () => splitParagraphs(i18n.t('devLetter.body'))
  );
  // 마지막 서명 줄도 서버(dev_letter.signature_ko/en)에서 불러온다. 앱은 항상 서명 스타일(styles.signature)로 렌더.
  // 로드 전/빈 값이면 i18n 폴백(마지막 알려진 값).
  const [signature, setSignature] = React.useState<string>(t('devLetter.signature'));
  // 닫을 때 저장할 현재 서버 버전(강제 재노출 기준). 조회 실패 시 기존 저장값을 유지하도록 null.
  const popupVersionRef = useRef<number | null>(null);

  React.useEffect(() => {
    let alive = true;
    // dev_letter 는 생성된 DB 타입에 아직 없어 any 캐스팅(런타임 조회엔 영향 없음).
    (supabase as any)
      .from('dev_letter')
      .select('body_ko, body_en, body_fr, body_ja, signature_ko, signature_en, signature_fr, signature_ja, popup_version')
      .eq('id', 1)
      .single()
      .then(({ data, error }: { data: any; error: any }) => {
        if (!alive || error || !data) return;
        const lang = letterLang();
        const parsed = splitParagraphs((data as any)[`body_${lang}`] ?? (data as any).body_en);
        if (parsed.length) setParagraphs(parsed);
        const sig = (data as any)[`signature_${lang}`] ?? (data as any).signature_en;
        if (typeof sig === 'string' && sig.trim()) setSignature(sig.trim());
        if (typeof (data as any).popup_version === 'number') {
          popupVersionRef.current = (data as any).popup_version;
        }
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
      // '다시 보지 않기': 현재 서버 버전을 저장한다. 조회 전이었다면 최소 1 을 저장(기존 동작 동일).
      const v = popupVersionRef.current ?? 1;
      AsyncStorage.setItem(DEV_LETTER_DISMISSED_KEY, String(v)).catch(() => {});
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
            <Text style={styles.signature}>{signature}</Text>
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
    <OverlaySheet visible={props.visible} onRequestClose={props.onClose} animationType="none">
      <SafeAreaProvider initialMetrics={initialWindowMetrics}>
        <DevLetterModalContent {...props} />
      </SafeAreaProvider>
    </OverlaySheet>
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
