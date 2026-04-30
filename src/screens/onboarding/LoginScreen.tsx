import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Image,
  AppState,
  Linking,
  Alert,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import AsyncStorage from '@react-native-async-storage/async-storage';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { AntDesign } from '@expo/vector-icons';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

const TERMS_URL = 'https://parkinon-terms.dailyhotcoolmeme.workers.dev';
const PRIVACY_URL = 'https://parkinon-privacy.dailyhotcoolmeme.workers.dev';

type Nav = StackNavigationProp<OnboardingStackParamList, 'Login'>;

export function LoginScreen() {
  const navigation = useNavigation<Nav>();
  const { user, loading, signInWithKakao, signInWithGoogle, devSignIn } = useAuth();
  const [signing, setSigning] = useState(false);
  const oauthStarted = useRef(false);
  const { bottom: bottomInset } = useSafeAreaInsets();
  const kakaoStarted = oauthStarted; // 하위 호환
  const signingTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 앱이 포그라운드로 돌아올 때 카카오 인증 대기 중이면 세션 직접 확인
  // 카카오 앱 → 파킨온 앱으로 복귀 시 Linking 이벤트가 오지 않는 경우를 커버
  useEffect(() => {
    const sub = AppState.addEventListener('change', async (state) => {
      if (state === 'active' && kakaoStarted.current) {
        setSigning(true);
        // 딥링크 처리 시간 대기 후 세션 직접 확인 (Linking 이벤트가 먼저 처리될 수 있음)
        await new Promise(r => setTimeout(r, 1500));
        // kakaoStarted가 이미 완료된 경우(user 설정 후 false로 바뀐 경우) 스킵
        if (!kakaoStarted.current) return;
        try {
          const { data: { session } } = await supabase.auth.getSession();
          if (session?.user) {
            // 세션이 있으면 onAuthStateChange가 곧 발동하거나 이미 발동했을 것
            // 60초 타임아웃을 짧게(10초)로 줄여서 user 설정을 기다림
            console.log('[LoginScreen] AppState active: 세션 확인됨, user 대기 중');
            if (signingTimeoutRef.current) clearTimeout(signingTimeoutRef.current);
            signingTimeoutRef.current = setTimeout(() => {
              // 10초 후에도 user가 안 오면 스피너 해제 (비정상 상황)
              kakaoStarted.current = false;
              setSigning(false);
            }, 10000);
          } else {
            // 세션 없음: 딥링크가 조금 늦게 도착할 수 있으므로 즉시 해제하지 않음
            // signInWithKakao(openBrowserAsync)가 authReceived=false 반환 시 handleKakaoLogin이 해제함
            console.log('[LoginScreen] AppState active: 세션 없음, 딥링크 추가 대기 중...');
            if (signingTimeoutRef.current) clearTimeout(signingTimeoutRef.current);
            signingTimeoutRef.current = setTimeout(() => {
              if (!kakaoStarted.current) return;
              console.log('[LoginScreen] 최종 타임아웃: 로그인 취소 처리');
              kakaoStarted.current = false;
              setSigning(false);
            }, 25000);
          }
        } catch (e) {
          console.error('[LoginScreen] AppState active 세션 확인 오류:', e);
          // 오류 시 60초 타임아웃으로 자동 복구
          if (signingTimeoutRef.current) clearTimeout(signingTimeoutRef.current);
          signingTimeoutRef.current = setTimeout(() => {
            kakaoStarted.current = false;
            setSigning(false);
          }, 60000);
        }
      } else if (state === 'background') {
        // 백그라운드로 가면 타임아웃 취소 (아직 카카오 브라우저 중)
        if (signingTimeoutRef.current) {
          clearTimeout(signingTimeoutRef.current);
          signingTimeoutRef.current = null;
        }
      }
    });
    return () => {
      sub.remove();
      if (signingTimeoutRef.current) clearTimeout(signingTimeoutRef.current);
    };
  }, []);

  // 로그인 성공 시 다음 화면으로 이동 (onboarding_done이 true이면 RootNavigator가 Main으로 자동 전환)
  useEffect(() => {
    if (user && !loading) {
      kakaoStarted.current = false;
      setSigning(false);
      if (signingTimeoutRef.current) {
        clearTimeout(signingTimeoutRef.current);
        signingTimeoutRef.current = null;
      }
      if (!user.onboarding_done) {
        // 민감정보 동의 여부 확인: DB(계정 단위) 우선, 캐시(AsyncStorage) 보조
        // DB의 sensitive_info_consented는 UserProfile에 포함됨
        const dbConsented = (user as any).sensitive_info_consented === true;
        if (dbConsented) {
          // DB에서 이미 동의 확인 → AsyncStorage 캐시도 갱신
          AsyncStorage.setItem('sensitive_info_consented', 'true').catch(() => {});
          navigation.replace('FamilyCheck');
        } else {
          // DB에 없으면 AsyncStorage 캐시 확인 (오프라인 or 기존 사용자 호환)
          AsyncStorage.getItem('sensitive_info_consented').then((consented) => {
            if (consented === 'true') {
              navigation.replace('FamilyCheck');
            } else {
              navigation.replace('SensitiveInfoConsent');
            }
          });
        }
      }
    }
  }, [user, loading]);

  const handleKakaoLogin = async () => {
    oauthStarted.current = true;
    setSigning(true);
    const success = await signInWithKakao();
    if (!success) {
      oauthStarted.current = false;
      setSigning(false);
    }
    // success=true → onAuthStateChange → user 설정 → useEffect([user,loading])에서 처리
  };

  const handleGoogleLogin = async () => {
    oauthStarted.current = true;
    setSigning(true);
    await signInWithGoogle();
    oauthStarted.current = false;
    setSigning(false);
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        <Image source={require('../../../assets/parkinon-logo.png')} style={styles.logoImage} />
      </View>

      <View style={[styles.bottomArea, { paddingBottom: 40 + bottomInset }]}>
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
          style={[styles.googleBtn, signing && styles.kakaoBtnDisabled]}
          onPress={handleGoogleLogin}
          activeOpacity={0.85}
          disabled={signing}
        >
          {signing ? (
            <ActivityIndicator color="#444" />
          ) : (
            <>
              <AntDesign name="google" size={24} color="#DB4437" />
              <Text style={styles.googleText}>구글로 시작하기</Text>
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={styles.devButton}
          onPress={devSignIn}
        >
          <Text style={styles.devButtonText}>테스트로 둘러보기</Text>
        </TouchableOpacity>

        <Text style={styles.terms}>
          {'시작하면 '}
          <Text
            style={styles.termsLink}
            onPress={() => Linking.openURL(TERMS_URL)}
          >
            이용약관
          </Text>
          {' 및 '}
          <Text
            style={styles.termsLink}
            onPress={() => Linking.openURL(PRIVACY_URL)}
          >
            개인정보처리방침
          </Text>
          {'에 동의하게 됩니다.'}
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
  logoImage: {
    width: 220,
    height: 220,
    borderRadius: 54,
    marginVertical: 16,
  },
  title: {
    fontSize: 36,
    fontWeight: '700',
    color: Colors.white,
    marginBottom: 4,
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
  termsLink: {
    fontSize: 13,
    color: Colors.white,
    opacity: 1,
    textDecorationLine: 'underline',
  },
  googleBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: Colors.white,
    borderRadius: 12,
    minHeight: 60,
    gap: 10,
    marginBottom: 16,
  },
  googleText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#444444',
  },
  devButton: {
    marginTop: 4,
    padding: 12,
    alignItems: 'center',
  },
  devButtonText: {
    fontSize: 16,
    color: Colors.white,
    opacity: 0.5,
  },
});
