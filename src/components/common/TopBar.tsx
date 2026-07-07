import React, { useEffect, useRef } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Image, Animated, Easing } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { Colors } from '../../constants/colors';
import { navigateTo } from '../../navigation/navigationRef';
import { isOverseasLocale } from '../../i18n/detectLocale';
import i18n from '../../i18n';

// 국내/해외 공통: 초록 배지 안 흰 심볼 회전. 텍스트만 로케일별(파킨온/ParkinON).
const SYMBOL_LOGO = require('../../../assets/parkinon-symbol-en.png');

function useBrandSpin(enabled: boolean) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (!enabled) return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(spin, { toValue: 1, duration: 6000, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.delay(3500),
        Animated.timing(spin, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [enabled]);
  return spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });
}

interface Props {
  title?: string;
  showBack?: boolean;
  showClose?: boolean;
  showParkinon?: boolean;
  rightIcon?: React.ReactNode;
  rightComponent?: React.ReactNode;
  /**
   * rightComponent가 아이콘 하나보다 넓은 텍스트 버튼 등일 때(예: "Mark all read")
   * true로 넘기면 우측 영역을 넓힌다. rightIconCount 기반 자동 확장은 showBell/
   * showDiary/showKakao 개수만 세므로 커스텀 rightComponent엔 적용되지 않아서 생긴 좁음.
   */
  rightWide?: boolean;
  showBell?: boolean;
  bellBadge?: number;
  onBellPress?: () => void;
  showDiary?: boolean;
  onDiaryPress?: () => void;
  showKakao?: boolean;
  onKakaoPress?: () => void;
}

export function TopBar({ title, showBack, showClose, showParkinon, rightIcon, rightComponent, rightWide, showBell, bellBadge, onBellPress, showDiary, onDiaryPress, showKakao, onKakaoPress }: Props) {
  const navigation = useNavigation();
  const spinDeg = useBrandSpin(!!showParkinon);
  // 카카오는 국내 전용 채널 — 호출부가 실수로 showKakao를 넘겨도 해외 로케일에선 항상 숨김.
  const kakaoVisible = !!showKakao && !isOverseasLocale();

  const badgeLabel = bellBadge && bellBadge > 0
    ? bellBadge > 99 ? '99+' : String(bellBadge)
    : null;

  const rightIconCount = (kakaoVisible ? 1 : 0) + (showDiary ? 1 : 0) + (showBell ? 1 : 0);

  return (
    <View style={styles.container}>
      <View style={styles.inner}>
        <View style={[styles.left, showParkinon && styles.leftExpanded]}>
          {showParkinon && (
            <TouchableOpacity
              onPress={() => navigateTo('Medication')}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}
            >
              <View style={styles.symbolBadge}>
                <Animated.Image
                  source={SYMBOL_LOGO}
                  style={{ width: 20, height: 20, transform: [{ rotate: spinDeg }] }}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.parkinonText}>{i18n.t('medication.brandTitle')}</Text>
            </TouchableOpacity>
          )}
          {showBack && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.backBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="arrow-back" size={24} color={Colors.textSub} />
              <Text style={styles.backText}>{i18n.t('common.back')}</Text>
            </TouchableOpacity>
          )}
          {showClose && (
            <TouchableOpacity
              onPress={() => navigation.goBack()}
              style={styles.closeBtn}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Ionicons name="close" size={24} color={Colors.textSub} />
              <Text style={styles.backText}>{i18n.t('common.close')}</Text>
            </TouchableOpacity>
          )}
        </View>
        {!showParkinon && !!title && <Text style={styles.title} numberOfLines={1}>{title}</Text>}
        <View style={[styles.right, (rightIconCount >= 2 || rightWide) && styles.rightWide, rightIconCount >= 3 && styles.rightWider]}>
          {rightComponent ?? rightIcon ?? (
            <View style={styles.rightIcons}>
              {kakaoVisible && (
                <TouchableOpacity
                  onPress={onKakaoPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.kakaoWrap}
                  accessibilityRole="button"
                  accessibilityLabel={i18n.t('common.a11yContact')}
                >
                  <Image
                    source={require('../../../assets/kakao_logo.png')}
                    style={{ width: 26, height: 26, borderRadius: 13 }}
                    resizeMode="cover"
                  />
                </TouchableOpacity>
              )}
              {showDiary && (
                <TouchableOpacity
                  onPress={onDiaryPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.diaryWrap}
                >
                  <MaterialCommunityIcons name="notebook-edit-outline" size={26} color={Colors.primary} />
                </TouchableOpacity>
              )}
              {showBell && (
                <TouchableOpacity
                  onPress={onBellPress}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.bellWrap}
                >
                  <Ionicons name="notifications-outline" size={26} color={Colors.textSub} />
                  {badgeLabel && (
                    <View style={styles.badge}>
                      <Text style={styles.badgeText}>{badgeLabel}</Text>
                    </View>
                  )}
                </TouchableOpacity>
              )}
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: Colors.white,
    borderBottomWidth: 1,
    borderBottomColor: Colors.border,
  },
  inner: {
    minHeight: 56,
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
  },
  symbolBadge: {
    width: 28,
    height: 28,
    borderRadius: 6,
    backgroundColor: '#4CAF50',
    alignItems: 'center',
    justifyContent: 'center',
  },
  left: { width: 76, alignItems: 'flex-start' },
  leftExpanded: { width: 'auto', flex: 1 },
  right: { width: 76, alignItems: 'flex-end' },
  rightWide: { width: 96 },
  rightWider: { width: 132 },
  rightIcons: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  kakaoWrap: { position: 'relative' },
  diaryWrap: { position: 'relative' },
  title: { flex: 1, fontSize: 20, fontWeight: '700', color: Colors.text, textAlign: 'center' },
  parkinonText: {
    fontSize: 20,
    fontWeight: '900',
    color: '#4CAF50',
    // fontWeight 는 이미 최대치('900')라 더 굵게 하려면 faux-bold(동일색 그림자로 획 두께 보강)
    textShadowColor: '#4CAF50',
    textShadowOffset: { width: 0, height: 0 },
    textShadowRadius: 0.8,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  backText: { fontSize: 18, color: Colors.textSub, fontWeight: '600' },
  closeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    padding: 8,
    justifyContent: 'center',
  },
  bellWrap: {
    position: 'relative',
  },
  badge: {
    position: 'absolute',
    top: -4,
    right: -6,
    minWidth: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#E53935',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
  },
});
