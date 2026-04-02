import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  ActivityIndicator,
  Image,
  AppState,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';

type Nav = StackNavigationProp<OnboardingStackParamList, 'Login'>;

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { user, loading, signInWithKakao, devSignIn } = useAuth();
  const [signing, setSigning] = useState(false);
  const kakaoStarted = useRef(false);

  // 앱이 포그라운드로 돌아올 때 카카오 인증 대기 중이면 로딩 유지
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active' && kakaoStarted.current) {
        setSigning(true);
      }
    });
    return () => sub.remove();
  }, []);

  // 로그인 성공 시 다음 화면으로 이동 (onboarding_done이 true이면 RootNavigator가 Main으로 자동 전환)
  useEffect(() => {
    if (user && !loading) {
      kakaoStarted.current = false;
      setSigning(false);
      if (!user.onboarding_done) {
        navigation.replace('RoleSelect');
      }
    }
  }, [user, loading]);

  const handleKakaoLogin = async () => {
    kakaoStarted.current = true;
    setSigning(true);
    await signInWithKakao();
    // Android: Linking.openURL은 즉시 리턴 → signing 유지 (AppState 핸들러가 처리)
    // iOS: openAuthSessionAsync는 auth 완료까지 대기 → 여기서 해제
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <View style={styles.logoArea}>
          <Text style={styles.logoEmoji}>💊</Text>
          <Text style={styles.title}>파킨온</Text>
          <Text style={styles.subtitle}>ParkinON</Text>
          <Text style={styles.desc}>
            파킨슨 환자와 가족을 위한{'\n'}케어 앱이에요
          </Text>
        </View>
      </View>

      <View style={styles.bottomArea}>
        <TouchableOpacity
          style={[styles.kakaoBtn, signing && styles.kakaoBtnDisabled]}
          onPress={handleKakaoLogin}
          activeOpacity={0.85}
          disabled={signing}
        >
          {signing ? (
            <ActivityIndicator color="#3C1E1E" />
          ) : (
            <>
              <Image source={require('../../../assets/kakao_logo.png')} style={styles.kakaoIcon} />
              <Text style={styles.kakaoText}>카카오로 시작하기</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.devButton}
          onPress={devSignIn}
        >
          <Text style={styles.devButtonText}>🛠 테스트로 둘러보기</Text>
        </TouchableOpacity>

        <Text style={styles.terms}>
          시작하면 이용약관 및 개인정보처리방침에 동의하게 됩니다.
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.primary,
  },
  content: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  logoArea: {
    alignItems: 'center',
  },
  logoEmoji: {
    fontSize: 72,
    marginBottom: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: Colors.white,
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 20,
    color: Colors.white,
    opacity: 0.8,
    marginBottom: 24,
  },
  desc: {
    fontSize: 18,
    color: Colors.white,
    textAlign: 'center',
    lineHeight: 28,
    opacity: 0.9,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 40,
  },
  kakaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    minHeight: 60,
    gap: 10,
    marginBottom: 16,
  },
  kakaoBtnDisabled: {
    opacity: 0.7,
  },
  kakaoIcon: {
    width: 44,
    height: 44,
    resizeMode: 'contain',
  },
  kakaoText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3C1E1E',
  },
  terms: {
    fontSize: 13,
    color: Colors.white,
    opacity: 0.6,
    textAlign: 'center',
    lineHeight: 20,
  },
  devButton: {
    marginTop: 16,
    padding: 12,
    alignItems: 'center',
  },
  devButtonText: {
    fontSize: 16,
    color: Colors.white,
    opacity: 0.5,
  },
});
