import React, { useEffect } from 'react';
import { View, Text, Image, StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  withRepeat,
  withSequence,
  withTiming,
  Easing,
} from 'react-native-reanimated';
import { useNavigation } from '@react-navigation/native';
import { useTranslation } from 'react-i18next';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';

const SYMBOL = require('../../../assets/parkinon-symbol-en.png');

type Nav = StackNavigationProp<OnboardingStackParamList, 'Splash'>;

export function SplashScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const spin = useSharedValue(0);

  useEffect(() => {
    // 한바퀴 ease로 돌고(0→1) → 잠깐 멈춤 → 리셋 → 반복 (국내/해외 공통)
    spin.value = withRepeat(
      withSequence(
        withTiming(1, { duration: 1500, easing: Easing.inOut(Easing.cubic) }),
        withTiming(1, { duration: 3500 }), // 멈춤(pause)
        withTiming(0, { duration: 0 }),   // 리셋
      ),
      -1,
    );
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigation.replace('OnboardingSlide');
    }, 2000);
    return () => clearTimeout(timer);
  }, []);

  const symbolStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${spin.value * 360}deg` }],
  }));

  return (
    <View style={styles.container}>
      <Animated.View style={[styles.symbolWrap, symbolStyle]}>
        <Image source={SYMBOL} style={styles.symbol} />
      </Animated.View>
      <Text style={styles.title}>{t('splash.appName')}</Text>
      <Text style={styles.desc}>{t('splash.tagline')}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  logo: { width: 105, height: 105, borderRadius: 26, marginBottom: 16 },
  symbolWrap: { width: 96, height: 96, marginBottom: 16, alignItems: 'center', justifyContent: 'center' },
  symbol: { width: 96, height: 96 },
  title: { fontSize: 36, fontWeight: '700', color: Colors.white, marginBottom: 4 },
  subtitle: { fontSize: 20, color: Colors.white, opacity: 0.8, marginBottom: 24 },
  desc: { fontSize: 18, color: Colors.white, textAlign: 'center', lineHeight: 28, opacity: 0.9 },
});
