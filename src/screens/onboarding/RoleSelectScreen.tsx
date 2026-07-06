import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from 'react-i18next';
import { useBottomSheetPadding } from '../../hooks/useBottomSheetPadding';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useNavigation } from '@react-navigation/native';
import type { StackNavigationProp } from '@react-navigation/stack';
import type { OnboardingStackParamList } from '../../navigation/OnboardingNavigator';
import { Colors } from '../../constants/colors';
import { PrimaryButton } from '../../components/common/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { useDialog } from '../../context/DialogContext';
import { supabase } from '../../lib/supabase';

type Nav = StackNavigationProp<OnboardingStackParamList, 'RoleSelect'>;
type RoleKey = 'patient' | 'caregiver';

const ROLES = [
  { key: 'patient', labelKey: 'roleSelect.patientLabel', descKey: 'roleSelect.patientDesc' },
  { key: 'caregiver', labelKey: 'roleSelect.caregiverLabel', descKey: 'roleSelect.caregiverDesc' },
] as const;

export function RoleSelectScreen() {
  const navigation = useNavigation<Nav>();
  const { t } = useTranslation();
  const { signOut } = useAuth();
  const dialog = useDialog();
  const [selectedRole, setSelectedRole] = useState<RoleKey | null>(null);
  const [loading, setLoading] = useState(false);
  const bottomPadding = useBottomSheetPadding(24);

  const handleConfirm = async () => {
    if (!selectedRole) return;
    setLoading(true);
    try {
      // 새 온보딩 시작 시 이전 세션의 잔류 데이터를 먼저 클리어
      // (같은 기기에서 다른 계정 온보딩 시 이전 값이 덮어쓰는 버그 방지)
      // NOTE: 'onboarding_invite_code'와 'onboarding_group_id'는 여기서 제거하지 않음.
      // FamilyCheckScreen에서 코드 입력 후 RoleSelect로 넘어오므로
      // 이 값들이 삭제되면 FamilyInviteScreen.handleFinish()에서 가족 연결이 안 됨.
      // (정리는 FamilyInviteScreen.handleFinish() 마지막 multiRemove에서 수행)
      await AsyncStorage.multiRemove([
        'onboarding_name',
        'onboarding_birth_year',
        'onboarding_gender',
        'onboarding_diag_year',
        'onboarding_medications',
        'onboarding_notifications',
        'onboarding_relation',
        'onboarding_living',
        'onboarding_invite_code_generated',
      ]);
      await AsyncStorage.setItem('onboarding_role', selectedRole);

      // 세션이 있으면 DB에도 role 중간 저장
      const { data: sessionData } = await supabase.auth.getSession();
      const userId = sessionData?.session?.user?.id;
      if (userId) {
        const { error } = await supabase
          .from('users')
          .update({ role: selectedRole })
          .eq('id', userId);
        if (error) {
          console.warn('[RoleSelect] role DB 저장 실패 (계속 진행):', error.message);
        }
      }

      if (selectedRole === 'patient') {
        navigation.navigate('PatientInfo', { step: 1 });
      } else {
        navigation.navigate('CaregiverInfo', { step: 1 });
      }
    } catch (e: any) {
      await dialog.alert({ title: t('common.error'), message: t('roleSelect.saveErrorMessage') + (e?.message ?? '') });
    } finally {
      setLoading(false);
    }
  };

  const handleClose = async () => {
    await signOut();
  };

  return (
    <SafeAreaView style={styles.container}>
      {/* 상단 뒤로가기 */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backBtn} onPress={() => navigation.goBack()} activeOpacity={0.7}>
          <Text style={styles.backIcon}>←</Text>
          <Text style={styles.backText}>{t('common.back')}</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.content}>
        <Text style={styles.title}>{t('roleSelect.title')}</Text>
        <Text style={styles.subtitle}>{t('roleSelect.subtitle')}</Text>

        <View style={styles.cardsArea}>
          {ROLES.map((role) => {
            const selected = selectedRole === role.key;
            return (
              <TouchableOpacity
                key={role.key}
                style={[styles.card, selected && styles.cardSelected]}
                onPress={() => setSelectedRole(role.key)}
                activeOpacity={0.85}
              >
                {/* 왼쪽 라디오 */}
                <View style={[styles.radioOuter, selected && styles.radioOuterSelected]}>
                  {selected && <View style={styles.radioInner} />}
                </View>

                {/* 중앙 콘텐츠 */}
                <View style={styles.cardCenter}>
                  <Text style={[styles.cardLabel, selected && styles.cardLabelSelected]}>
                    {t(role.labelKey)}
                  </Text>
                  <Text style={[styles.cardDesc, selected && styles.cardDescSelected]}>
                    {t(role.descKey)}
                  </Text>
                </View>

                {/* 우측 여백 (라디오 너비만큼 균형) */}
                <View style={{ width: 24 }} />
              </TouchableOpacity>
            );
          })}
        </View>
      </View>

      {/* 하단 버튼 영역 */}
      <View style={[styles.bottomArea, { paddingBottom: bottomPadding }]}>
        <PrimaryButton
          title={t('common.nextTo')}
          onPress={handleConfirm}
          disabled={!selectedRole}
          loading={loading}
        />
        <TouchableOpacity style={styles.closeBtn} onPress={handleClose} activeOpacity={0.7}>
          <Text style={styles.closeBtnText}>{t('common.close')}</Text>
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
  content: {
    flex: 1,
    paddingHorizontal: 24,
    paddingTop: 16,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: Colors.text,
    marginBottom: 8,
    textAlign: 'center',
  },
  subtitle: {
    fontSize: 18,
    color: Colors.textSub,
    marginBottom: 28,
    textAlign: 'center',
  },
  cardsArea: {
    flex: 1,
    gap: 16,
    paddingBottom: 24,
    justifyContent: 'center',
  },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: Colors.white,
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 20,
    borderWidth: 2,
    borderColor: Colors.border,
    gap: 8,
  },
  cardCenter: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  cardSelected: {
    borderColor: Colors.primary,
    backgroundColor: Colors.light,
  },
  cardLabel: {
    fontSize: 20,
    fontWeight: '700',
    color: Colors.text,
    textAlign: 'center',
    lineHeight: 28,
  },
  cardLabelSelected: {
    color: Colors.dark,
  },
  cardDesc: {
    fontSize: 16,
    color: Colors.textSub,
    textAlign: 'center',
    lineHeight: 24,
  },
  cardDescSelected: {
    color: Colors.dark,
  },
  radioOuter: {
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    borderColor: Colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  radioOuterSelected: {
    borderColor: Colors.primary,
  },
  radioInner: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: Colors.primary,
  },
  bottomArea: {
    paddingHorizontal: 24,
    paddingTop: 16,
    gap: 12,
  },
  closeBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 56,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: Colors.border,
    backgroundColor: Colors.white,
  },
  closeBtnText: {
    fontSize: 18,
    color: Colors.textSub,
    fontWeight: '600',
  },
});
