import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Share,
  Alert,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { useAuth } from '../../context/AuthContext';
import { supabase } from '../../lib/supabase';

type Nav = StackNavigationProp<OnboardingStackParamList, 'FamilyInvite'>;

function generateInviteCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

export function FamilyInviteScreen() {
  const navigation = useNavigation<Nav>();
  const { refreshUser, forceCompleteOnboarding } = useAuth();
  const [inviteCode, setInviteCode] = useState('');
  const [userName, setUserName] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    initCode();
  }, []);

  const initCode = async () => {
    let code = await AsyncStorage.getItem('onboarding_invite_code_generated');
    if (!code) {
      code = generateInviteCode();
      await AsyncStorage.setItem('onboarding_invite_code_generated', code);
    }
    setInviteCode(code);

    const name = await AsyncStorage.getItem('onboarding_name');
    if (name) setUserName(name);
  };

  const handleKakaoShare = async () => {
    try {
      await Share.share({
        message: `[파킨온] ${userName || '가족'}님이 파킨온에 초대했어요!\n\n초대 코드: ${inviteCode}\n\n파킨온 앱을 설치하고 초대 코드를 입력해주세요.`,
        title: '파킨온 가족 초대',
      });
    } catch {
      Alert.alert('', '공유하기에 실패했어요. 코드를 직접 전달해주세요.');
    }
  };

  const handleFinish = async () => {
    setIsSaving(true);
    try {
      // AsyncStorage에서 온보딩 데이터 읽기
      const [
        name,
        role,
        birthYearStr,
        gender,
        diagYearStr,
        medicationsJson,
        notificationsJson,
        caregiverRelation,
        caregiverLiving,
        joinGroupId,
      ] = await AsyncStorage.multiGet([
        'onboarding_name',
        'onboarding_role',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_diag_year',
        'onboarding_medications',
        'onboarding_notifications',
        'onboarding_relation',
        'onboarding_living',
        'onboarding_group_id',
      ]).then((pairs) => pairs.map(([, v]) => v));

      // 세션에서 userId / accessToken 획득
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      const accessToken = sessionData?.session?.access_token;

      if (!userId || !accessToken) {
        // 개발 모드 (devSignIn): 실제 세션 없음 → 로컬 상태만 업데이트
        forceCompleteOnboarding();
        return;
      }

      // supabase-js PostgREST가 React Native 새 아키텍처에서 hang하는 버그 우회
      // → 직접 fetch API 사용 (useAuth.ts의 dbFetch와 동일한 방식)
      const SUPABASE_URL = process.env.EXPO_PUBLIC_SUPABASE_URL!;
      const SUPABASE_ANON_KEY = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!;
      const baseHeaders = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json',
      };

      // users 테이블 업데이트 (보호자이면 caregiver_relation, residence_type 포함)
      const userUpdateData: Record<string, any> = {
        name: name || undefined,
        role: role || undefined,
        birth_year: birthYearStr ? parseInt(birthYearStr, 10) : undefined,
        gender: gender || undefined,
        diagnosis_year: diagYearStr ? parseInt(diagYearStr, 10) : undefined,
        onboarding_done: true,
        notification_enabled: true,
      };
      if (role === 'caregiver') {
        if (caregiverRelation) userUpdateData.caregiver_relation = caregiverRelation;
        if (caregiverLiving) userUpdateData.residence_type = caregiverLiving;
      }
      if (joinGroupId) {
        userUpdateData.patient_group_id = joinGroupId;
      }

      const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/users?id=eq.${userId}`, {
        method: 'PATCH',
        headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
        body: JSON.stringify(userUpdateData),
      });
      if (!updateRes.ok) {
        const errText = await updateRes.text();
        throw new Error(`users 업데이트 실패: ${updateRes.status} ${errText}`);
      }

      // DB 업데이트 성공 즉시 로컬 상태도 반영 (MenuScreen refreshUser 타이밍 문제 방지)
      forceCompleteOnboarding();

      // 초대 코드로 가입한 경우 → patient_group_members에도 추가
      if (joinGroupId && role) {
        const memberRes = await fetch(`${SUPABASE_URL}/rest/v1/patient_group_members`, {
          method: 'POST',
          headers: { ...baseHeaders, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
          body: JSON.stringify({ group_id: joinGroupId, user_id: userId, role }),
        });
        if (!memberRes.ok) {
          const errText = await memberRes.text();
          console.warn('[FamilyInviteScreen] patient_group_members 추가 오류 (계속 진행):', errText);
        }
      }

      // medications 저장 (환자 본인만 저장)
      if (medicationsJson && role === 'patient') {
        const meds: Array<{
          name: string;
          dosage?: string;
          times: string[];
          meal_schedules?: Record<string, string>;
          drugInfo?: { itemImage?: string };
        }> = JSON.parse(medicationsJson);

        if (meds.length > 0) {
          const medRes = await fetch(`${SUPABASE_URL}/rest/v1/medications`, {
            method: 'POST',
            headers: { ...baseHeaders, 'Prefer': 'return=minimal' },
            body: JSON.stringify(meds.map((med) => ({
              patient_id: userId,
              name: med.name,
              dosage: med.dosage ?? null,
              meal_times: med.times,
              meal_schedules: med.meal_schedules ?? {},
              scheduled_times: [],
              drug_code: null,
              drug_image_url: med.drugInfo?.itemImage || null,
              is_active: true,
            }))),
          });
          if (!medRes.ok) {
            const errText = await medRes.text();
            throw new Error(`medications 저장 실패: ${medRes.status} ${errText}`);
          }
        }
      }

      // refreshUser로 앱 상태 최종 갱신
      await refreshUser();

      // AsyncStorage 온보딩 키 정리
      await AsyncStorage.multiRemove([
        'onboarding_role',
        'onboarding_name',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_diag_year',
        'onboarding_medications',
        'onboarding_notifications',
        'onboarding_invite_code_generated',
        'onboarding_relation',
        'onboarding_living',
        'onboarding_invite_code',
        'onboarding_group_id',
      ]);
    } catch (e: any) {
      console.error('[FamilyInviteScreen] handleFinish 오류:', e);
      Alert.alert(
        '저장 오류',
        '정보 저장 중 문제가 발생했어요. 다시 시도해 주세요.\n\n' + (e?.message ?? ''),
        [{ text: '확인' }]
      );
    } finally {
      setIsSaving(false);
    }
  };

  const codeChars = inviteCode.split('');

  return (
    <SafeAreaView style={styles.container}>
      {/* 헤더 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>뒤로</Text>
        </TouchableOpacity>
      </View>

      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={styles.heroArea}>
          <Text style={styles.title}>가족을 초대해드릴게요</Text>
          <Text style={styles.subtitle}>
            초대 코드를 가족에게 전달하면{'\n'}서로 연결할 수 있어요
          </Text>
        </View>

        {/* 초대 코드 카드 */}
        <View style={styles.codeCard}>
          <Text style={styles.codeCardTitle}>초대 코드</Text>

          <View style={styles.codeRow}>
            {codeChars.map((char, i) => (
              <View key={i} style={styles.codeBox}>
                <Text style={styles.codeChar}>{char}</Text>
              </View>
            ))}
          </View>

          <Text style={styles.codeExpiry}>24시간 동안 유효해요</Text>
        </View>

        {/* 안내 */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>이렇게 사용해요</Text>
          <View style={styles.infoSteps}>
            <Text style={styles.infoStep}>1. 가족이 파킨온 앱을 설치해요</Text>
            <Text style={styles.infoStep}>2. 회원가입 후 초대 코드를 입력해요</Text>
            <Text style={styles.infoStep}>3. 서로의 건강 정보를 함께 볼 수 있어요</Text>
          </View>
        </View>
      </ScrollView>

      <View style={styles.bottomArea}>
        <TouchableOpacity
          style={[styles.kakaoBtn, isSaving && styles.disabledBtn]}
          onPress={handleKakaoShare}
          activeOpacity={0.85}
          disabled={isSaving}
        >
          <Text style={styles.kakaoBtnText}>카카오톡으로 공유하기</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={[styles.closeBtn, isSaving && styles.disabledBtn]}
          onPress={handleFinish}
          disabled={isSaving}
        >
          {isSaving ? (
            <ActivityIndicator size="small" color={Colors.white} />
          ) : (
            <Text style={styles.closeBtnText}>시작하기 →</Text>
          )}
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: Colors.background,
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingVertical: 8,
    paddingHorizontal: 4,
    alignSelf: 'flex-start',
  },
  backIcon: {
    fontSize: 22,
    color: Colors.text,
  },
  backText: {
    fontSize: 18,
    color: Colors.text,
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
    paddingVertical: 24,
  },
  heroArea: {
    alignItems: 'center',
    marginBottom: 32,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 10,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    lineHeight: 28,
    textAlign: 'center',
  },
  codeCard: {
    backgroundColor: Colors.white,
    borderRadius: 20,
    padding: 28,
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 2,
    borderColor: Colors.light,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 3,
  },
  codeCardTitle: {
    fontSize: 16,
    color: Colors.textSub,
    marginBottom: 20,
    fontWeight: '600',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginBottom: 16,
  },
  codeBox: {
    width: 46,
    height: 58,
    borderRadius: 10,
    backgroundColor: Colors.light,
    borderWidth: 2,
    borderColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  codeChar: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.dark,
    letterSpacing: 0,
  },
  codeExpiry: {
    fontSize: 14,
    color: Colors.textHint,
    marginTop: 4,
  },
  infoCard: {
    backgroundColor: Colors.white,
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: Colors.border,
  },
  infoTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 14,
  },
  infoSteps: {
    gap: 12,
  },
  infoStep: {
    fontSize: 16,
    color: Colors.textSub,
    lineHeight: 24,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingBottom: 40,
    gap: 12,
  },
  kakaoBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FEE500',
    borderRadius: 12,
    minHeight: 60,
    gap: 10,
  },
  kakaoBtnText: {
    fontSize: 18,
    fontWeight: '700',
    color: '#3C1E1E',
  },
  closeBtn: {
    minHeight: 60,
    borderRadius: 12,
    backgroundColor: Colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.white,
    fontWeight: '700',
  },
  disabledBtn: {
    opacity: 0.5,
  },
});
