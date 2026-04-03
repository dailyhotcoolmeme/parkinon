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
    // TODO: 카카오 SDK 공유 연동 예정
    try {
      await Share.share({
        message: `[파킨온] ${userName || '가족'}님이 파킨온에 초대했어요!\n\n앱을 설치하고 초대 코드를 입력해주세요.\n\n초대 코드: ${inviteCode}\n\n파킨온 다운로드: https://parkinon.app`,
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

      // 세션에서 userId 획득
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (!userId) {
        // 개발 모드 (devSignIn): 실제 세션 없음 → 로컬 상태만 업데이트
        forceCompleteOnboarding();
        return;
      }

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
      // 초대 코드로 가입한 경우 → patient_group_id 연결
      if (joinGroupId) {
        userUpdateData.patient_group_id = joinGroupId;
      }
      const { error: updateError } = await supabase
        .from('users')
        .update(userUpdateData)
        .eq('id', userId);
      if (updateError) throw updateError;

      // 초대 코드로 가입한 경우 → patient_group_members에도 추가
      if (joinGroupId && role) {
        const { error: memberError } = await supabase
          .from('patient_group_members')
          .upsert(
            { group_id: joinGroupId, user_id: userId, role: role as 'patient' | 'caregiver' },
            { onConflict: 'group_id,user_id' }
          );
        if (memberError) {
          console.warn('[FamilyInviteScreen] patient_group_members 추가 오류 (계속 진행):', memberError.message);
        }
      }

      // medications 저장 (환자 본인만 저장 — 보호자는 환자 연결 후 별도 등록)
      if (medicationsJson && role === 'patient') {
        const meds: Array<{
          name: string;
          times: string[];
          drugInfo?: { itemImage?: string };
        }> = JSON.parse(medicationsJson);

        if (meds.length > 0) {
          const { error: medError } = await supabase.from('medications').insert(
            meds.map((med) => ({
              patient_id: userId,
              name: med.name,
              dosage: null,
              meal_times: med.times as any,
              scheduled_times: [] as string[],
              drug_code: null,
              drug_image_url: med.drugInfo?.itemImage || null,
              is_active: true,
            }))
          );
          if (medError) throw medError;
        }
      }

      // refreshUser로 앱 상태 갱신 (onboarding_done: true → 메인으로 이동)
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
          <Text style={styles.heroEmoji}>👨‍👩‍👧</Text>
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
            <Text style={styles.infoStep}>1️⃣  가족이 파킨온 앱을 설치해요</Text>
            <Text style={styles.infoStep}>2️⃣  회원가입 후 초대 코드를 입력해요</Text>
            <Text style={styles.infoStep}>3️⃣  서로의 건강 정보를 함께 볼 수 있어요</Text>
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
          <Text style={styles.kakaoIcon}>💛</Text>
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
  heroEmoji: {
    fontSize: 56,
    marginBottom: 16,
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
  kakaoIcon: {
    fontSize: 22,
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
